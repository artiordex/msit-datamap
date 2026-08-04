'use strict';

/**
 * 과학기술정보통신부 산하기관 공공데이터 크롤러
 *
 * data.go.kr 에서 53개 기관의 파일데이터 + 오픈API 목록을 수집하여
 * crawler/data_go_kr/datamap_YYMMDD.json 과 최신본 datamap.json 으로 저장
 *
 * 사용법:
 *   node crawler/crawler_api_과기부.js
 *   node crawler/crawler_api_과기부.js --headed             # 브라우저 화면 표시
 *   node crawler/crawler_api_과기부.js --slow 300           # 화면 테스트용 동작 지연(ms)
 *   node crawler/crawler_api_과기부.js --from 한국연구재단   # 특정 기관부터 재개
 *   node crawler/crawler_api_과기부.js --limit 3            # 처음 3개 기관만 (테스트)
 *   node crawler/crawler_api_과기부.js --max-items 2        # 유형별 상세 수집 개수 제한 (테스트)
 *   node crawler/crawler_api_과기부.js --output ./out.json  # 출력 경로 지정
 *   node crawler/crawler_api_과기부.js --fresh              # 기존 결과를 무시하고 새로 수집
 */

const { chromium } = require('playwright');
const cheerio      = require('cheerio');
const fs           = require('fs');
const path         = require('path');
const logger       = require('../utils/logger');

const BASE_URL   = 'https://www.data.go.kr';
const LIST_URL   = `${BASE_URL}/tcs/dss/selectDataSetList.do`;
const OUTPUT_DIR = path.join(__dirname, 'data_go_kr');
const TIMEOUT    = 60_000;
const UA         =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ORGS = [
  '과학기술정보통신부',
  '우정사업본부',
  '국립중앙과학관',
  '국립과천과학관',
  '국립전파연구원',
  '중앙전파관리소',
  '과학기술사업화진흥원',
  '우체국시설관리단',
  '한국여성과학기술인육성재단',
  '한국우편사업진흥원',
  '광주과학기술원',
  '국가과학기술연구회',
  '국립광주과학관',
  '국립대구과학관',
  '국립부산과학관',
  '기초과학연구원',
  '대구경북과학기술원',
  '연구개발특구진흥재단',
  '우체국금융개발원',
  '우체국물류지원단',
  '울산과학기술원',
  '정보통신산업진흥원',
  '한국건설기술연구원',
  '한국과학기술기획평가원',
  '한국과학기술연구원',
  '한국과학기술원',
  '한국과학기술정보연구원',
  '한국과학창의재단',
  '한국기계연구원',
  '한국기초과학지원연구원',
  '한국나노기술원',
  '한국데이터산업진흥원',
  '한국방송통신전파진흥원',
  '한국생명공학연구원',
  '한국생산기술연구원',
  '한국식품연구원',
  '한국에너지기술연구원',
  '한국연구재단',
  '한국원자력연구원',
  '한국원자력의학원',
  '한국인터넷진흥원',
  '한국전기연구원',
  '한국전자통신연구원',
  '한국지능정보사회진흥원',
  '한국지질자원연구원',
  '한국철도기술연구원',
  '한국표준과학연구원',
  '한국한의학연구원',
  '한국화학연구원',
  '한국식품연구원 부설 세계김치연구소',
  '정보통신기획평가원',
  '한국재료연구원',
  '한국핵융합에너지연구원',
];

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clean(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }

function todayStamp() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function cleanOldDatamapFiles(dir, maxAgeDays = 30) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(dir).filter(f => /^datamap_\d{6}\.json$/.test(f));
    for (const file of files) {
      const filePath = path.join(dir, file);
      const { mtimeMs } = fs.statSync(filePath);
      if (mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        logger.info({ file }, `${maxAgeDays}일 지난 크롤링 파일 삭제`);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, '오래된 파일 정리 중 오류 (무시)');
  }
}

function latestOutputFileFor(outputFile) {
  return path.join(path.dirname(outputFile), 'datamap.json');
}

function saveDatamap(outputFile, data) {
  const json = JSON.stringify(data, null, 2);
  const latestFile = latestOutputFileFor(outputFile);

  fs.writeFileSync(outputFile, json, 'utf-8');
  if (path.resolve(outputFile) !== path.resolve(latestFile)) {
    fs.writeFileSync(latestFile, json, 'utf-8');
  }
}

function isHeaded() { return process.argv.includes('--headed'); }

function slowMoMs() {
  const value = parseInt(getArg('--slow') ?? '0', 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function waitUi(ms = 0) {
  const delay = Math.max(ms, slowMoMs());
  if (delay > 0) await sleep(delay);
}

async function getCookieHeader(ctx) {
  const jar = await ctx.cookies(BASE_URL);
  return jar.map(c => `${c.name}=${c.value}`).join('; ');
}

async function fetchHtml(url, cookie, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Cookie: cookie },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(600 * attempt);
    }
  }
}

function parseDetailPage(html) {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const record = {};
  $('.line-box.type2 .info-ul li').each((_, el) => {
    const key = clean($(el).children('strong.key').first().text());
    const val = clean($(el).children('.value').first().text());
    if (key) record[key] = val;
  });
  return record;
}

// ── Playwright 헬퍼 ──────────────────────────────────────────────────────────

async function closeHomePopups(page) {
  const closeSelectors = [
    'button:has-text("오늘 하루 보지 않기")',
    'button:has-text("닫기")',
    'a:has-text("닫기")',
    '.main-pop-close',
    '.popup-close',
    '.modal-close',
  ];

  for (const selector of closeSelectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
        await button.click({ force: true }).catch(() => null);
        await sleep(150);
      }
    }
  }
}

async function goToDataSetList(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await closeHomePopups(page);
  await waitUi(300);

  const menuButton = page.locator('button[data-trigger="gnb"]').first();
  if (await menuButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await menuButton.click({ force: true }).catch(() => null);
    await waitUi(300);
  }

  const dataListLink = page.locator('a[onclick*="selectDataSetList.do"]').first();
  if (await dataListLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      dataListLink.click({ force: true }),
    ]).catch(() => null);
  }

  if (!page.url().includes('selectDataSetList')) {
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  }
  await page.waitForSelector('button[data-target="detail-search-modal"]', { timeout: TIMEOUT });
  await waitUi(500);
}

async function ensureOnListPage(page) {
  if (!page.url().includes('selectDataSetList')) {
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await waitUi(500);
  }

  const orgPopup = page.locator('.layer_instt_div .modal-dialog, .layer_instt_div #popupSearchKeyword3_sh');
  if (await orgPopup.first().isVisible({ timeout: 800 }).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => null);
    await page.locator('.layer_instt_div button:has-text("닫기")').click({ force: true }).catch(() => null);
    await page.evaluate(() => {
      document.querySelectorAll('.layer_instt_div, .modal-back').forEach(el => {
        el.style.display = 'none';
      });
    }).catch(() => null);
  }
}

async function openSearchModal(page) {
  const modal = page.locator('#detail-search-modal, [data-modal-id="detail-search-modal"]').first();
  if (!(await modal.isVisible({ timeout: 800 }).catch(() => false))) {
    await page.locator('button[data-target="detail-search-modal"]').first().click({ force: true });
  }
  await page.waitForSelector('#orgNm', { timeout: TIMEOUT });
  await waitUi(400);
}

async function pickDataType(page, dType) {
  const input = page.locator('#detail-search-form-d-type');
  const current = await input.inputValue().catch(() => '');
  if (current !== dType) {
    await page.locator(`.dTypeBtn[data-type="${dType}"]`).click({ force: true });
  }
  await waitUi(300);
}

async function selectOrg(page, orgName) {
  // 기관명 인풋 클릭 → 팝업 열기
  await page.locator('#orgNm').click();
  await page.waitForSelector('#popupSearchKeyword3_sh', { timeout: TIMEOUT });
  await waitUi(300);

  const keywords = [orgName];
  if (!orgName.startsWith('과학기술정보통신부')) {
    keywords.push(`과학기술정보통신부 ${orgName}`);
  }

  for (const keyword of keywords) {
    await page.selectOption('#popupSearchCondition4_sh', '1').catch(() => null);
    await page.click('#popupSearchKeyword3_sh');
    await page.fill('#popupSearchKeyword3_sh', keyword);
    await page.locator('button.btn-exec[onclick*="fn_searchInsttList"]').click({ force: true });
    await page
      .waitForFunction(() => {
        const layer = document.querySelector('.layer_instt_div');
        return layer && !layer.innerText.includes('검색조건을 입력하고 검색해주세요.');
      }, null, { timeout: 10_000 })
      .catch(() => null);
    await waitUi(800);

    const candidates = page.locator('.layer_instt_div span[onclick*="fn_selectInstt"], .layer_instt_div a[onclick*="fn_selectInstt"]');
    const count = await candidates.count();
    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);
      const text = clean(await candidate.textContent());
      if (text === orgName || text.endsWith(` ${orgName}`) || text === keyword) {
        await candidate.click({ force: true });
        await page.waitForFunction(
          expected => document.querySelector('#orgNm')?.value.includes(expected),
          orgName,
          { timeout: 10_000 }
        ).catch(() => null);
        await waitUi(800);
        return true;
      }
    }
  }

  logger.warn({ orgName }, '기관을 팝업에서 찾지 못했습니다');
  await page.keyboard.press('Escape').catch(() => null);
  await page.locator('.layer_instt_div button:has-text("닫기")').click({ force: true }).catch(() => null);
  await waitUi(500);
  return false;
}

async function submitSearch(page) {
  await page.locator('button.close-modal[onclick="eventFncObj.search()"]').click({ force: true });
  await page
    .waitForSelector('.apply-result-item, .no-result-area, .no-data', { timeout: TIMEOUT })
    .catch(() => null);
  await waitUi(800);
}

async function switchResultTab(page, dType) {
  const tab = page.locator(`a.one-depth-btn[data-type="${dType}"]`);
  if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tab.click({ force: true });
    await waitUi(800);
  }
}

async function getTotalPages(page) {
  try {
    const nums = await page.$$eval(
      '.krds-pagination .page-link:not(.link-dot)',
      els => els.map(e => parseInt(e.textContent ?? '')).filter(n => !isNaN(n))
    );
    return nums.length ? Math.max(...nums) : 1;
  } catch {
    return 1;
  }
}

async function getLinksOnPage(page, dType) {
  const suffix = dType === 'FILE' ? 'fileData.do' : 'openapi.do';
  return page.$$eval(
    `.apply-result-link a[href*="${suffix}"]`,
    els => els.map(el => ({
      href:  el.getAttribute('href'),
      title: (el.textContent ?? '').trim(),
    }))
  );
}

async function collectAllLinks(page, dType, maxItems = null) {
  const all = [];
  const seen = new Set();
  let pageNo = 1;

  while (true) {
    for (const link of await getLinksOnPage(page, dType)) {
      if (!seen.has(link.href)) {
        seen.add(link.href);
        all.push(link);
        if (maxItems && all.length >= maxItems) return all;
      }
    }

    const nextPage = await page.evaluate(() => {
      const current = parseInt(document.querySelector('.krds-pagination .page-link.active')?.textContent ?? '1', 10);
      const pageLinks = Array.from(document.querySelectorAll('.krds-pagination .page-link:not(.link-dot)'))
        .map(el => parseInt(el.textContent ?? '', 10))
        .filter(n => Number.isFinite(n));
      const directNext = pageLinks.find(n => n > current);
      if (directNext) return directNext;

      const nextGroup = document.querySelector('.krds-pagination .page-navi.next');
      const href = nextGroup?.getAttribute('href') ?? '';
      const match = href.match(/fn_page\((\d+)\)/);
      return match ? parseInt(match[1], 10) : null;
    });

    if (!nextPage || nextPage <= pageNo) break;
    pageNo = nextPage;
    await page.evaluate(n => fn_page(n), nextPage); // eslint-disable-line no-undef
    await page
      .waitForSelector('.apply-result-item, .no-result-area', { timeout: TIMEOUT })
      .catch(() => null);
    await waitUi(800);
    logger.info({ dType, page: pageNo, collected: all.length }, '페이지 수집');
  }

  return all;
}

async function scrapeAllDetails(links, cookie, dType) {
  const results = [];
  for (const { href, title } of links) {
    try {
      const html   = await fetchHtml(BASE_URL + href, cookie);
      const detail = parseDetailPage(html);
      results.push({ href, title: clean(title), type: dType, ...detail });
      logger.info({ title: clean(title).slice(0, 40), dType }, '상세 수집');
    } catch (err) {
      logger.warn({ href, err: err.message }, '상세 수집 실패');
      results.push({ href, title: clean(title), type: dType, error: err.message });
    }
    await sleep(200);
  }
  return results;
}

// ── 기관별 크롤링 ─────────────────────────────────────────────────────────────

async function crawlOrg(page, ctx, orgName) {
  const result = { org: orgName, file: [], api: [], errors: [] };
  const maxItems = parseInt(getArg('--max-items') ?? '0', 10) || null;

  for (const dType of ['FILE', 'API']) {
    try {
      await ensureOnListPage(page);
      await openSearchModal(page);
      await pickDataType(page, dType);

      const found = await selectOrg(page, orgName);
      if (!found) {
        result.errors.push(`${dType}: 기관 미발견`);
        continue;
      }

      await submitSearch(page);
      await switchResultTab(page, dType);

      const links = await collectAllLinks(page, dType, maxItems);
      logger.info({ orgName, dType, count: links.length }, '링크 수집 완료');

      const cookie  = await getCookieHeader(ctx);
      const details = await scrapeAllDetails(links, cookie, dType);

      if (dType === 'FILE') result.file = details;
      else result.api = details;
    } catch (err) {
      logger.error({ orgName, dType, err: err.message }, '수집 중 오류');
      result.errors.push(`${dType}: ${err.message}`);
    }
  }

  return result;
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

async function run() {
  const outputFile = getArg('--output') ?? path.join(OUTPUT_DIR, `datamap_${todayStamp()}.json`);
  const fromOrg    = getArg('--from');
  const limitCount = parseInt(getArg('--limit') ?? '0') || null;
  const fresh      = process.argv.includes('--fresh');

  const startIdx  = fromOrg ? Math.max(0, ORGS.indexOf(fromOrg)) : 0;
  const endIdx    = limitCount ? startIdx + limitCount : ORGS.length;
  const orgsToRun = ORGS.slice(startIdx, endIdx);

  if (orgsToRun.length === 0) {
    logger.error({ fromOrg }, '--from 에 지정한 기관명이 목록에 없습니다');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  // 30일 지난 datamap_*.json 자동 삭제
  cleanOldDatamapFiles(path.dirname(outputFile));

  // 이전 진행 상황 로드 (크래시 후 재개 지원)
  const out = { crawled_at: new Date().toISOString(), organizations: [] };
  if (!fresh && fs.existsSync(outputFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
      out.organizations = prev.organizations ?? [];
      logger.info({ count: out.organizations.length }, '이전 진행 상황 로드');
    } catch { /* 무시 */ }
  }
  const done = new Set(out.organizations.map(o => o.org));

  const headed = isHeaded();
  const browser = await chromium.launch({
    headless: !headed,
    args: headed ? ['--start-maximized'] : [],
  });
  const ctx     = await browser.newContext({
    userAgent: UA,
    ignoreHTTPSErrors: true,
    viewport: headed ? null : undefined,
  });
  const page    = await ctx.newPage();

  try {
    // 세션 쿠키 확립 및 실제 메뉴 경로 확인
    await goToDataSetList(page);

    for (const orgName of orgsToRun) {
      if (done.has(orgName)) {
        logger.info({ orgName }, '이미 수집됨 — 스킵');
        continue;
      }

      logger.info({ orgName }, '══ 기관 크롤링 시작');
      const result = await crawlOrg(page, ctx, orgName);
      out.organizations.push(result);

      // 기관 하나 완료 시 즉시 저장 (중간 장애 대비)
      saveDatamap(outputFile, out);
      logger.info(
        { orgName, file: result.file.length, api: result.api.length, errors: result.errors.length },
        '══ 기관 크롤링 완료'
      );
      await sleep(500);
    }
  } finally {
    await browser.close();
  }

  saveDatamap(outputFile, out);
  logger.info(
    { outputFile, latestFile: latestOutputFileFor(outputFile), total: out.organizations.length },
    '전체 크롤링 완료'
  );
}

run().catch(err => {
  logger.fatal({ err }, '크롤러 치명적 오류');
  process.exit(1);
});
