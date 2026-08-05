'use strict';

/**
 * 과학기술정보통신부 산하기관 공공데이터 크롤러
 *
 * data.go.kr 에서 53개 기관의 파일데이터 + 오픈API 목록을 수집하여
 * crawler/datamap_YYMMDD.json 과 최신본 datamap.json 으로 저장
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
const OUTPUT_DIR = __dirname;
const TIMEOUT    = 120_000;
const UA         =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TYPE_LABELS = {
  FILE: '파일데이터',
  API: 'API',
};
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

// 실행 옵션과 문자열을 정리하는 유틸 함수 영역임

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clean(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }

async function gotoWithRetry(page, url, options = {}) {
  const attempts = options.attempts ?? 3;
  const timeout = options.timeout ?? TIMEOUT;
  const waitUntil = options.waitUntil ?? 'commit';
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      logger.info({ url, attempt, attempts }, '페이지 이동을 시도함');
      return await page.goto(url, { waitUntil, timeout });
    } catch (err) {
      lastError = err;
      logger.warn(
        { url, attempt, attempts, err: { name: err.name, message: err.message } },
        '페이지 이동에 실패해 재시도함'
      );
      if (attempt < attempts) await sleep(5000 * attempt);
    }
  }

  throw lastError;
}

function typeLabel(dType) {
  return TYPE_LABELS[dType] ?? clean(dType);
}

function normalizeDataTypeLabel(value) {
  const text = clean(value).replace(/선택됨/g, '');
  if (/오픈\s*API|OPEN\s*API|\bAPI\b/i.test(text)) return 'API';
  if (/파일\s*데이터|파일데이터|FILE/i.test(text)) return '파일데이터';
  return '';
}

function overallTypeLabel(types) {
  const normalized = new Set([...types].map(normalizeDataTypeLabel).filter(Boolean));
  if (normalized.has('API') && normalized.has('파일데이터')) return 'API/파일데이터';
  if (normalized.has('API')) return 'API';
  if (normalized.has('파일데이터')) return '파일데이터';
  return '';
}

function inferOverallType(dType, detail = {}, cardData = {}) {
  const types = new Set([typeLabel(dType)]);
  const addTypes = value => {
    for (const part of String(value ?? '').split(/[,\n/]+/)) {
      const normalized = normalizeDataTypeLabel(part);
      if (normalized) types.add(normalized);
    }
  };

  addTypes(detail['유형']);
  addTypes(cardData['유형']);

  const formats = `${cardData.__formats ?? ''}`;
  if (/JSON\s*\+\s*XML|XML\s*\+\s*JSON|오픈\s*API|OPEN\s*API/i.test(formats)) {
    types.add('API');
  }
  if (/\b(CSV|XLSX?|PDF|HWP|ZIP|TXT|SHP|DOCX?|PPTX?)\b/i.test(formats)) {
    types.add('파일데이터');
  }

  return overallTypeLabel(types) || typeLabel(dType);
}

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

function extractDataId(href) {
  return clean(href).match(/\/data\/(\d+)\//)?.[1] ?? '';
}

function cacheKey(href, dType) {
  const normalizedHref = clean(href);
  if (!normalizedHref) return '';
  const id = extractDataId(normalizedHref);
  return id ? `${dType}:${id}` : `${dType}:${normalizedHref}`;
}

function datasetIdentity(item) {
  const href = item?.['링크'] ?? item?.href ?? '';
  return extractDataId(href) || clean(href) || clean(item?.['제목'] ?? item?.title);
}

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    logger.warn({ file, err: err.message }, '캐시 파일을 읽지 못해 무시함');
    return null;
  }
}

function buildDetailCache(outputFile) {
  const cache = new Map();
  const latestFile = latestOutputFileFor(outputFile);
  const sources = [latestFile, outputFile]
    .filter((file, index, files) => file && files.indexOf(file) === index)
    .map(readJsonFile)
    .filter(Boolean);

  const remember = (item, dType) => {
    const key = cacheKey(item['링크'] ?? item.href, dType);
    if (!key) return;
    if (isReusableCachedItem(item) || !cache.has(key)) cache.set(key, item);
  };

  for (const source of sources) {
    for (const org of source.organizations ?? []) {
      for (const item of org.file ?? []) {
        remember(item, 'FILE');
      }
      for (const item of org.api ?? []) {
        remember(item, 'API');
      }
    }
  }

  return cache;
}

function buildPreviousOrgMap(outputFile) {
  const latestFile = latestOutputFileFor(outputFile);
  const source = readJsonFile(latestFile) ?? readJsonFile(outputFile);
  const map = new Map();
  for (const org of source?.organizations ?? []) {
    if (org?.org) map.set(org.org, org);
  }
  return map;
}

function detectDeletedItems(previousOrg, currentOrg) {
  if (!previousOrg) return [];

  const currentIds = new Set([...currentOrg.file, ...currentOrg.api].map(datasetIdentity).filter(Boolean));
  const deleted = [];
  const seen = new Set();

  for (const item of [...(previousOrg.file ?? []), ...(previousOrg.api ?? [])]) {
    const id = datasetIdentity(item);
    if (!id || currentIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    deleted.push({
      링크: item['링크'] ?? item.href ?? '',
      제목: item['제목'] ?? item.title ?? '',
      유형: item['유형'] ?? typeLabel(item.type),
      삭제사유: '현재 data.go.kr 목록에서 확인되지 않아 최신 JSON에서 제외됨',
    });
  }

  return deleted;
}

function typedDetailLabel(dType) {
  return typeLabel(dType);
}

function cachedRevision(item, dType) {
  const detail = item?.['유형별 상세']?.[typedDetailLabel(dType)];
  return clean(detail?.['수정일'] ?? item?.['수정일']);
}

function isReusableCachedItem(item) {
  if (!item) return false;
  if ('href' in item || 'title' in item || 'type' in item) return false;
  if ('전체 유형' in item || '목록 제공형식' in item || '수집 탭' in item) return false;
  const type = clean(item['유형']);
  if (type !== 'API/파일데이터' && item['유형별 상세']) return false;
  return true;
}

function cleanMetric(value) {
  return clean(value).replace(/건$/, '').trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function updateCachedMetrics(cachedItem, link, dType, cardData) {
  const item = cloneJson(cachedItem);
  item['링크'] = link['링크'];
  item['제목'] = link['제목'];
  item['유형'] = link['유형'];

  const views = clean(cardData['조회수']);
  const modified = clean(cardData['수정일']);
  if (views) item['조회수'] = views;

  const detailLabel = typedDetailLabel(dType);
  const detail = item['유형별 상세']?.[detailLabel];
  if (detail && modified) detail['수정일'] = modified;
  if (!detail && modified) item['수정일'] = modified;

  if (dType === 'FILE') {
    const downloads = cleanMetric(cardData['다운로드']);
    if (detail && downloads) detail['다운로드(바로가기)'] = downloads;
    if (!detail && downloads) item['다운로드(바로가기)'] = downloads;
  }

  if (dType === 'API') {
    const applications = cleanMetric(cardData['활용신청']);
    if (detail && applications) detail['활용신청'] = applications;
    if (!detail && applications) item['활용신청'] = applications;
  }

  return item;
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

function extractInfoList($, root) {
  const record = {};
  root.find('.line-box.type2 .info-ul li').each((_, el) => {
    const key = clean($(el).children('strong.key').first().text());
    const val = clean($(el).children('.value').first().text());
    if (key) record[key] = val;
  });
  return record;
}

function extractReportAfterTitle($, titlePattern) {
  const title = $('.data-info-tit, .data-info-title, h3, h4')
    .filter((_, el) => titlePattern.test(clean($(el).text())))
    .first();
  if (!title.length) return {};

  const report = title.nextAll('.data-report').first();
  return report.length ? extractInfoList($, report) : {};
}

function extractLicenseInfo($) {
  return extractReportAfterTitle($, /이용\s*조건|라이선스/);
}

function findDetailRoot($, dType) {
  const panelId = dType === 'FILE' ? '#dataTabpanel01' : '#dataTabpanel02';
  const panel = $(panelId).first();
  if (panel.length) return panel;

  const titleKey = dType === 'FILE' ? '파일데이터명' : '오픈API명';
  const report = $('.data-report')
    .filter((_, el) => clean($(el).text()).includes(titleKey))
    .first();
  if (report.length) {
    const parentPanel = report.closest('[id^="dataTabpanel"], [role="tabpanel"]');
    return parentPanel.length ? parentPanel : report.add(report.nextAll('.data-report'));
  }

  return $.root();
}

function availableDetailTypes($) {
  const types = new Set();

  $('[role="tab"]').each((_, el) => {
    const normalized = normalizeDataTypeLabel($(el).text());
    const panelId = $(el).attr('aria-controls');
    if (panelId && $(`#${panelId}`).find('.info-ul li').length === 0) return;
    if (normalized) types.add(normalized);
  });

  $('strong.key').each((_, el) => {
    const key = clean($(el).text());
    if (key === '파일데이터명') types.add('파일데이터');
    if (key === '오픈API명') types.add('API');
  });

  return [...types];
}

function parseTypedDetails($, availableTypes, sharedInfo = {}) {
  const details = {};
  for (const dType of ['FILE', 'API']) {
    if (!availableTypes.includes(typeLabel(dType))) continue;
    const root = findDetailRoot($, dType);
    const record = { ...extractInfoList($, root), ...sharedInfo };
    if (Object.keys(record).length > 0) details[typeLabel(dType)] = record;
  }
  return details;
}

function parseDetailPage(html, dType) {
  const $ = cheerio.load(html);
  $('script, style').remove();

  const root = findDetailRoot($, dType);
  const licenseInfo = extractLicenseInfo($);
  const record = { ...extractInfoList($, root), ...licenseInfo };
  if (Object.keys(record).length === 0) {
    Object.assign(record, extractInfoList($, $.root()), licenseInfo);
  }

  const types = availableDetailTypes($);
  if (!types.length) types.push(typeLabel(dType));

  const typedDetails = parseTypedDetails($, types, licenseInfo);
  if (Object.keys(typedDetails).length > 0) {
    record['유형별 상세'] = typedDetails;
  }

  return record;
}

function buildOutputRecord({ href, title, dType, cardData, detail, error }) {
  const type = inferOverallType(dType, detail, { __formats: cardData.__formats, 유형: cardData['유형'] });
  const output = {
    링크: href,
    제목: clean(title),
    유형: type,
  };

  if (type === 'API/파일데이터') {
    const views = clean(cardData['조회수'] ?? detail['조회수']);
    const category = clean(detail['분류체계']);
    if (views) output['조회수'] = views;
    if (category) output['분류체계'] = category;
    if (detail['유형별 상세']) output['유형별 상세'] = detail['유형별 상세'];
  } else {
    const { '유형별 상세': _typedDetails, ...flatDetail } = detail;
    Object.assign(output, flatDetail);
    const views = clean(cardData['조회수'] ?? output['조회수']);
    if (views) output['조회수'] = views;
  }

  if (error) output.error = error;

  return output;
}

// 브라우저 화면에서 버튼을 누르고 검색 조건을 맞추는 함수 영역임

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
        // 홈 화면 팝업의 오늘 하루 보지 않기 또는 닫기 버튼을 누름
        await button.click({ force: true }).catch(() => null);
        await sleep(150);
      }
    }
  }
}

async function goToDataSetList(page) {
  await gotoWithRetry(page, LIST_URL);
  await page.waitForSelector('button[data-target="detail-search-modal"]', { timeout: TIMEOUT });
  await waitUi(500);
}

async function ensureOnListPage(page) {
  if (!page.url().includes('selectDataSetList')) {
    await gotoWithRetry(page, LIST_URL);
    await waitUi(500);
  }

  const orgPopup = page.locator('.layer_instt_div .modal-dialog, .layer_instt_div #popupSearchKeyword3_sh');
  if (await orgPopup.first().isVisible({ timeout: 800 }).catch(() => false)) {
    // 열려 있는 기관 선택 팝업을 닫기 위해 Escape 키를 누름
    await page.keyboard.press('Escape').catch(() => null);
    // 기관 선택 팝업의 닫기 버튼을 누름
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
    // 상세검색 모달 열기 버튼을 누름
    await page.locator('button[data-target="detail-search-modal"]').first().click({ force: true });
  }
  await page.waitForSelector('#orgNm', { timeout: TIMEOUT });
  await waitUi(400);
}

async function pickDataType(page, dType) {
  const input = page.locator('#detail-search-form-d-type');
  const current = await input.inputValue().catch(() => '');
  if (current !== dType) {
    // 상세검색 모달에서 파일데이터 또는 오픈API 유형 버튼을 누름
    await page.locator(`.dTypeBtn[data-type="${dType}"]`).click({ force: true });
  }
  await waitUi(300);
}

async function selectOrg(page, orgName) {
  // 기관명 입력칸을 눌러 기관 선택 팝업을 열게 함
  await page.locator('#orgNm').click();
  await page.waitForSelector('#popupSearchKeyword3_sh', { timeout: TIMEOUT });
  await waitUi(300);

  const keywords = [orgName];
  if (!orgName.startsWith('과학기술정보통신부')) {
    keywords.push(`과학기술정보통신부 ${orgName}`);
  }

  for (const keyword of keywords) {
    await page.selectOption('#popupSearchCondition4_sh', '1').catch(() => null);
    // 기관 검색어 입력칸을 누름
    await page.click('#popupSearchKeyword3_sh');
    await page.fill('#popupSearchKeyword3_sh', keyword);
    // 기관 검색 팝업의 검색 버튼을 누름
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
        // 검색 결과에서 대상 기관명을 누름
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
  // 기관 선택 실패 후 팝업을 닫기 위해 Escape 키를 누름
  await page.keyboard.press('Escape').catch(() => null);
  // 기관 선택 실패 후 팝업의 닫기 버튼을 누름
  await page.locator('.layer_instt_div button:has-text("닫기")').click({ force: true }).catch(() => null);
  await waitUi(500);
  return false;
}

async function submitSearch(page) {
  // 상세검색 모달의 검색 실행 버튼을 누름
  await page.locator('button.close-modal[onclick="eventFncObj.search()"]').click({ force: true });
  await page
    .waitForSelector('.apply-result-item, .no-result-area, .no-data', { timeout: TIMEOUT })
    .catch(() => null);
  await waitUi(800);
}

async function switchResultTab(page, dType) {
  const tab = page.locator(`a.one-depth-btn[data-type="${dType}"]`);
  if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 검색 결과 화면에서 파일데이터 또는 오픈API 결과 탭을 누름
    await tab.click({ force: true });
    await waitUi(800);
  }
}

async function getResultTabCounts(page) {
  return page.$$eval('a.one-depth-btn[data-type]', tabs => {
    const counts = {};
    for (const tab of tabs) {
      const type = tab.getAttribute('data-type');
      const spanText = tab.querySelector('span')?.textContent ?? '';
      const count = parseInt(spanText.replace(/[^\d]/g, ''), 10);
      if (type) counts[type] = Number.isFinite(count) ? count : 0;
    }
    return counts;
  }).catch(() => ({}));
}

function validateCollectedCounts(result, tabCounts, maxItems) {
  if (maxItems) return;

  const fileIds = new Set();
  const apiIds = new Set();
  const hybridIds = new Set();

  for (const item of [...result.file, ...result.api]) {
    const id = datasetId(item['링크']) || item['링크'] || item['제목'];
    if (!id) continue;
    if (item['유형'] === 'API') apiIds.add(id);
    else if (item['유형'] === 'API/파일데이터') {
      fileIds.add(id);
      hybridIds.add(id);
    } else {
      fileIds.add(id);
    }
  }

  const actualFile = fileIds.size;
  const actualApi = apiIds.size;
  const expectedFile = tabCounts.FILE;
  const expectedApi = tabCounts.API;

  result.counts.actual['파일데이터'] = actualFile;
  result.counts.actual.API = actualApi;
  result.counts.actual['API/파일데이터'] = hybridIds.size;

  validateTabCount(result, 'FILE', expectedFile, actualFile);
  validateTabCount(result, 'API', expectedApi, actualApi);
}

function validateTabCount(result, dType, expected, actual) {
  if (!Number.isFinite(expected)) return;
  if (expected === actual) return;

  const label = typeLabel(dType);
  const message = `${label}: 탭 표시 ${expected}건, 실제 수집 ${actual}건`;
  result.errors.push(message);
  logger.warn({ orgName: result.org, dType, expected, actual }, '탭 표시 건수와 수집 건수가 다름');
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
    '.apply-result-item',
    (items, { suffix, dType }) => {
      const results = [];
      for (const item of items) {
        const linkEl = item.querySelector(`.apply-result-link a[href*="${suffix}"]`);
        if (!linkEl) continue;
        const formats = Array.from(item.querySelectorAll('.apply-result-link .krds-badge'))
          .map(el => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        const hasApiFormat = formats.some(format => /JSON\s*\+\s*XML|XML\s*\+\s*JSON|오픈\s*API|OPEN\s*API/i.test(format));
        const hasFileFormat = formats.some(format => /\b(CSV|XLSX?|PDF|HWP|ZIP|TXT|SHP|DOCX?|PPTX?)\b/i.test(format));
        const collectionType = dType === 'API' ? 'API' : '파일데이터';
        const overallType = (hasApiFormat && (hasFileFormat || dType === 'FILE')) ||
          (hasFileFormat && dType === 'API')
            ? 'API/파일데이터'
            : collectionType;
        const data = {
          '링크': linkEl.getAttribute('href') ?? '',
          '제목': (linkEl.innerText ?? linkEl.textContent ?? '').replace(/\s+/g, ' ').trim(),
          '유형': overallType,
          __formats: formats.join(', '),
        };
        item.querySelectorAll('ul[role="none"] > li[role="none"]').forEach(li => {
          const strong = li.querySelector('strong');
          if (!strong) return;
          const key = strong.textContent.trim();
          const val = (li.innerText ?? li.textContent ?? '').replace(key, '').replace(/\s+/g, ' ').trim();
          if (key === '조회수' || key === '수정일') data[key] = val;
          if (dType === 'FILE' && key === '다운로드') data[key] = val;
          if (dType === 'API'  && key === '활용신청') data[key] = val;
        });
        results.push(data);
      }
      return results;
    },
    { suffix, dType }
  );
}

async function collectAllLinks(page, dType, maxItems = null) {
  const all = [];
  const seen = new Set();
  let pageNo = 1;

  while (true) {
    for (const link of await getLinksOnPage(page, dType)) {
      const linkHref = link.href ?? link['링크'];
      if (!seen.has(linkHref)) {
        seen.add(linkHref);
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
    // 페이지네이션에서 다음 결과 페이지 번호를 누름
    await page.evaluate(n => window.fn_page(n), nextPage);
    await page
      .waitForSelector('.apply-result-item, .no-result-area', { timeout: TIMEOUT })
      .catch(() => null);
    await waitUi(800);
    logger.info({ dType, page: pageNo, collected: all.length }, '페이지 수집');
  }

  return all;
}

async function scrapeAllDetails(links, cookie, dType, detailCache = new Map()) {
  const results = [];
  let skipped = 0;
  let fetched = 0;
  let failed = 0;
  for (const link of links) {
    const href = link.href ?? link['링크'];
    const title = link.title ?? link['제목'];
    const { href: _href, title: _title, __formats, ...cardData } = link;
    const key = cacheKey(href, dType);
    const cached = key ? detailCache.get(key) : null;
    const listRevision = clean(cardData['수정일']);
    if (isReusableCachedItem(cached) && listRevision && cachedRevision(cached, dType) === listRevision) {
      results.push(updateCachedMetrics(cached, link, dType, cardData));
      skipped += 1;
      logger.info({ title: clean(title).slice(0, 40), dType }, '수정일 동일로 상세 수집 생략함');
      await sleep(30);
      continue;
    }

    try {
      const html   = await fetchHtml(BASE_URL + href, cookie);
      const detail = parseDetailPage(html, dType);
      const cleanTitle = clean(title);
      results.push(buildOutputRecord({ href, title: cleanTitle, dType, cardData: { ...cardData, __formats }, detail }));
      fetched += 1;
      logger.info({ title: clean(title).slice(0, 40), dType }, '상세 수집함');
    } catch (err) {
      failed += 1;
      logger.warn({ href, err: err.message }, '상세 수집 실패');
      const cleanTitle = clean(title);
      results.push(buildOutputRecord({
        href,
        title: cleanTitle,
        dType,
        cardData: { ...cardData, __formats },
        detail: {},
        error: err.message,
      }));
    }
    await sleep(200);
  }
  logger.info({ dType, total: links.length, skipped, fetched, failed }, '상세 수집 단계 완료');
  return results;
}

// 기관별로 파일데이터와 API를 차례로 수집하는 함수 영역임

async function crawlOrg(page, ctx, orgName, detailCache, previousOrg = null) {
  const result = { org: orgName, file: [], api: [], counts: { expected: {}, actual: {} }, errors: [] };
  const maxItems = parseInt(getArg('--max-items') ?? '0', 10) || null;
  let tabCounts = {};

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
      tabCounts = Object.keys(tabCounts).length ? tabCounts : await getResultTabCounts(page);
      await switchResultTab(page, dType);

      const links = await collectAllLinks(page, dType, maxItems);
      result.counts.expected[typeLabel(dType)] = tabCounts[dType] ?? null;
      result.counts.actual[`${typeLabel(dType)} 탭 수집`] = links.length;
      logger.info({ orgName, dType, count: links.length }, '링크 수집 완료');

      const cookie  = await getCookieHeader(ctx);
      const details = await scrapeAllDetails(links, cookie, dType, detailCache);

      if (dType === 'FILE') result.file = details;
      else result.api = details;
    } catch (err) {
      logger.error({ orgName, dType, err: err.message }, '수집 중 오류');
      result.errors.push(`${dType}: ${err.message}`);
    }
  }

  validateCollectedCounts(result, tabCounts, maxItems);

  const collectedCount = result.file.length + result.api.length;
  const hasCountMismatch = result.errors.some(error => error.includes('탭 표시'));
  if (previousOrg && collectedCount > 0 && !hasCountMismatch) {
    const deleted = detectDeletedItems(previousOrg, result);
    if (deleted.length > 0) {
      result.deleted = deleted;
      logger.warn({ orgName, count: deleted.length }, '이전 JSON에는 있었지만 현재 목록에서 사라진 데이터를 기록함');
    }
  }

  return result;
}

// 크롤러 실행을 시작하고 결과 파일을 저장하는 함수 영역임

async function run() {
  const outputFile = getArg('--output') ?? path.join(OUTPUT_DIR, `datamap_${todayStamp()}.json`);
  const fromOrg    = getArg('--from');
  const limitCount = parseInt(getArg('--limit') ?? '0') || null;
  const fresh      = process.argv.includes('--fresh');
  const resume     = process.argv.includes('--resume');

  const startIdx  = fromOrg ? Math.max(0, ORGS.indexOf(fromOrg)) : 0;
  const endIdx    = limitCount ? startIdx + limitCount : ORGS.length;
  const orgsToRun = ORGS.slice(startIdx, endIdx);

  if (orgsToRun.length === 0) {
    logger.error({ fromOrg }, '--from 에 지정한 기관명이 목록에 없습니다');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  // 30일 지난 datamap_*.json 파일을 자동 삭제함
  cleanOldDatamapFiles(path.dirname(outputFile));

  // 이전 진행 상황을 로드해 크래시 후 재개를 지원함
  const out = { crawled_at: new Date().toISOString(), organizations: [] };
  const detailCache = fresh ? new Map() : buildDetailCache(outputFile);
  const previousOrgMap = fresh ? new Map() : buildPreviousOrgMap(outputFile);
  logger.info({ count: detailCache.size, fresh }, '기존 datamap 상세 캐시를 준비함');
  if (resume && !fresh && fs.existsSync(outputFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
      out.organizations = prev.organizations ?? [];
      logger.info({ count: out.organizations.length }, '이전 진행 상황 로드');
    } catch { /* 이전 결과 파일 파싱 실패를 무시함 */ }
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
    // 세션 쿠키를 확립하고 실제 메뉴 경로를 확인함
    await goToDataSetList(page);

    for (const orgName of orgsToRun) {
      if (done.has(orgName)) {
        logger.info({ orgName }, '이미 수집됨 — 스킵');
        continue;
      }

      logger.info({ orgName }, '══ 기관 크롤링 시작');
      const result = await crawlOrg(page, ctx, orgName, detailCache, previousOrgMap.get(orgName));
      out.organizations.push(result);

      // 기관 하나 완료 시 즉시 저장해 중간 장애에 대비함
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
