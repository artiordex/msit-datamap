import * as d3 from "d3";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

type KindFilter = "all" | DatasetKind;
type SortKey = "views" | "downloads" | "applications" | "name";
type DatasetKind = "file" | "api" | "hybrid";

type NamedCount = {
  name: string;
  count: number;
};

// ── 크롤러 raw 타입 ──────────────────────────────────────────────────────────

type RawDetail = Record<string, string | undefined>;
type RawTypeDetails = Record<string, RawDetail | undefined>;

type RawItem = {
  [key: string]: unknown;
  "링크"?: string;
  "제목"?: string;
  "유형"?: string;
  "전체 유형"?: string;
  "수집 탭"?: string;
  "제공 탭"?: string;
  "목록 제공형식"?: string;
  "유형별 상세"?: RawTypeDetails;
  "파일데이터명"?: string;
  "오픈API명"?: string;
  "분류체계"?: string;
  "제공기관"?: string;
  "관리부서명"?: string;
  "관리부서 전화번호"?: string;
  "업데이트 주기"?: string;
  "차기 등록 예정일"?: string;
  "설명"?: string;
  "매체유형"?: string;
  "확장자"?: string;
  "전체 행"?: string;
  "키워드"?: string;
  "등록일"?: string;
  "수정일"?: string;
  "다운로드(바로가기)"?: string;
  "조회수"?: string;
  "활용신청"?: string;
  "보유근거"?: string;
  "수집방법"?: string;
  "데이터 한계"?: string;
  "기타 유의사항"?: string;
  error?: string;
};

type RawOrg = {
  org: string;
  file: RawItem[];
  api: RawItem[];
  errors: string[];
};

type RawDatamap = {
  crawled_at: string;
  organizations: RawOrg[];
};

// ── UI용 정규화 레코드 ──────────────────────────────────────────────────────

type DatasetRecord = {
  id: string;
  kind: DatasetKind;
  portalPath: string;
  fileHref: string;
  apiHref: string;
  name: string;        // 기관명_ 제거한 데이터명
  원본제목: string;
  분류체계: string;    // "과학기술 - 과학기술진흥"
  제공기관: string;
  관리부서명: string;
  관리부서전화: string;
  업데이트주기: string;
  차기등록예정일: string;
  설명: string;
  매체유형: string;
  확장자: string;
  전체행: number;
  키워드: string[];
  등록일: string;
  수정일: string;
  조회수: number;
  다운로드수: number;
  활용신청수: number;
  보유근거: string;
  수집방법: string;
  데이터한계: string;
  기타유의사항: string;
};

const catalogUrl = "/data/datamap.json";

// ── raw → DatasetRecord 변환 ─────────────────────────────────────────────────

function cleanText(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function parseKorNum(value: unknown): number {
  return parseInt(cleanText(value).replace(/[^\d]/g, ""), 10) || 0;
}

function parseKeywords(value: unknown): string[] {
  return cleanText(value).split(",").map((k) => k.trim()).filter(Boolean);
}

function extractName(title: string): string {
  const idx = title.indexOf("_");
  return idx >= 0 ? title.slice(idx + 1).trim() : title.trim();
}

function extractId(href: string): string {
  return href.match(/\/data\/(\d+)\//)?.[1] ?? href;
}

function normalizeProviderName(name: string) {
  const normalized = cleanText(name);
  const prefix = "과학기술정보통신부 ";
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length).trim() : normalized;
}

function normalizeDatasetKind(value: unknown): DatasetKind | "" {
  const text = cleanText(value).replace(/\s+/g, "");
  if (!text) return "";
  if (text.includes("API") && (text.includes("파일") || text.includes("FILE"))) return "hybrid";
  if (text === "API" || text.includes("오픈API")) return "api";
  if (text === "FILE" || text.includes("파일데이터")) return "file";
  return "";
}

function rawItemKind(item: RawItem): DatasetKind {
  return (
    normalizeDatasetKind(item["전체 유형"]) ||
    normalizeDatasetKind(item["제공 탭"]) ||
    normalizeDatasetKind(item["유형"]) ||
    normalizeDatasetKind(item.type) ||
    "file"
  );
}

function sourceTypeLabel(item: RawItem) {
  const sourceKind =
    normalizeDatasetKind(item.type) ||
    normalizeDatasetKind(item["수집 탭"]) ||
    rawItemKind(item);
  return sourceKind === "api"
    ? "API"
    : "파일데이터";
}

function typedDetail(item: RawItem, label: "파일데이터" | "API"): RawDetail {
  const details = item["유형별 상세"];
  if (!details) return {};
  return details[label] ?? (label === "API" ? details["오픈 API"] : details.FILE) ?? {};
}

function detailValue(item: RawItem, detail: RawDetail, key: string) {
  return firstText(detail[key], item[key]);
}

function splitDelimited(value: unknown) {
  return cleanText(value)
    .split(/,|\s+\+\s+|\//)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function combineDelimited(...values: unknown[]) {
  return uniqueStrings(values.flatMap(splitDelimited)).join(", ");
}

function hrefForType(href: string, id: string, kind: "file" | "api") {
  const page = kind === "api" ? "openapi.do" : "fileData.do";
  if (href) return href.replace(/\/(?:fileData|openapi)\.do$/, `/${page}`);
  return id ? `/data/${id}/${page}` : "";
}

function mergeKind(left: DatasetKind, right: DatasetKind): DatasetKind {
  if (left === right) return left;
  return "hybrid";
}

function mergeRecord(left: DatasetRecord, right: DatasetRecord): DatasetRecord {
  const kind = mergeKind(left.kind, right.kind);
  const fileHref = firstText(left.fileHref, right.fileHref);
  const apiHref = firstText(left.apiHref, right.apiHref);
  const portalPath = kind === "api" ? firstText(apiHref, left.portalPath, right.portalPath) : firstText(fileHref, left.portalPath, right.portalPath, apiHref);

  return {
    id: firstText(left.id, right.id),
    kind,
    portalPath,
    fileHref,
    apiHref,
    name: firstText(left.name, right.name),
    원본제목: firstText(left.원본제목, right.원본제목),
    분류체계: firstText(left.분류체계, right.분류체계),
    제공기관: firstText(left.제공기관, right.제공기관),
    관리부서명: firstText(left.관리부서명, right.관리부서명),
    관리부서전화: firstText(left.관리부서전화, right.관리부서전화),
    업데이트주기: firstText(left.업데이트주기, right.업데이트주기),
    차기등록예정일: firstText(left.차기등록예정일, right.차기등록예정일),
    설명: firstText(left.설명, right.설명),
    매체유형: combineDelimited(left.매체유형, right.매체유형),
    확장자: combineDelimited(left.확장자, right.확장자),
    전체행: Math.max(left.전체행, right.전체행),
    키워드: uniqueStrings([...left.키워드, ...right.키워드]),
    등록일: firstText(left.등록일, right.등록일),
    수정일: firstText(left.수정일, right.수정일),
    조회수: Math.max(left.조회수, right.조회수),
    다운로드수: Math.max(left.다운로드수, right.다운로드수),
    활용신청수: Math.max(left.활용신청수, right.활용신청수),
    보유근거: firstText(left.보유근거, right.보유근거),
    수집방법: firstText(left.수집방법, right.수집방법),
    데이터한계: firstText(left.데이터한계, right.데이터한계),
    기타유의사항: firstText(left.기타유의사항, right.기타유의사항),
  };
}

function toRecord(item: RawItem, orgName: string): DatasetRecord {
  const kind = rawItemKind(item);
  const href = firstText(item.href, item["링크"]);
  const id = extractId(href);
  const sourceDetail = typedDetail(item, sourceTypeLabel(item));
  const fileDetail = typedDetail(item, "파일데이터");
  const apiDetail = typedDetail(item, "API");
  const read = (key: string) => detailValue(item, sourceDetail, key);
  const fileHref = kind === "api" ? "" : hrefForType(href, id, "file");
  const apiHref = kind === "file" ? "" : hrefForType(href, id, "api");
  const title = firstText(
    item.title,
    item["제목"],
    fileDetail["파일데이터명"],
    apiDetail["오픈API명"],
    item["파일데이터명"],
    item["오픈API명"],
  );
  const nameSource = firstText(item.title, item["제목"], title);

  return {
    id,
    kind,
    portalPath: kind === "api" ? apiHref || href : fileHref || apiHref || href,
    fileHref,
    apiHref,
    name: extractName(nameSource || title),
    원본제목: title,
    분류체계: read("분류체계"),
    제공기관: normalizeProviderName(firstText(read("제공기관"), orgName)),
    관리부서명: read("관리부서명"),
    관리부서전화: read("관리부서 전화번호"),
    업데이트주기: read("업데이트 주기"),
    차기등록예정일: read("차기 등록 예정일"),
    설명: read("설명"),
    매체유형: combineDelimited(fileDetail["매체유형"], apiDetail["매체유형"], read("매체유형")),
    확장자: combineDelimited(fileDetail["확장자"], apiDetail["확장자"], read("확장자")),
    전체행: parseKorNum(firstText(fileDetail["전체 행"], read("전체 행"))),
    키워드: uniqueStrings([
      ...parseKeywords(fileDetail["키워드"]),
      ...parseKeywords(apiDetail["키워드"]),
      ...parseKeywords(read("키워드")),
    ]),
    등록일: read("등록일"),
    수정일: read("수정일"),
    조회수: parseKorNum(read("조회수")),
    다운로드수: parseKorNum(firstText(fileDetail["다운로드(바로가기)"], read("다운로드(바로가기)"))),
    활용신청수: parseKorNum(firstText(apiDetail["활용신청"], read("활용신청"))),
    보유근거: read("보유근거"),
    수집방법: read("수집방법"),
    데이터한계: read("데이터 한계"),
    기타유의사항: read("기타 유의사항"),
  };
}

function datamapToRecords(raw: RawDatamap): DatasetRecord[] {
  const recordsById = new Map<string, DatasetRecord>();
  for (const org of raw.organizations) {
    for (const item of org.file) {
      if (!item.error) {
        const record = toRecord(item, org.org);
        const key = record.id || `${org.org}-${record.portalPath}-${record.name}`;
        recordsById.set(key, recordsById.has(key) ? mergeRecord(recordsById.get(key)!, record) : record);
      }
    }
    for (const item of org.api) {
      if (!item.error) {
        const record = toRecord(item, org.org);
        const key = record.id || `${org.org}-${record.portalPath}-${record.name}`;
        recordsById.set(key, recordsById.has(key) ? mergeRecord(recordsById.get(key)!, record) : record);
      }
    }
  }
  return [...recordsById.values()];
}

type CatalogSummary = {
  total: number;
  files: number;
  apis: number;
  hybrids: number;
  views: number;
  downloads: number;
  cumulativeDownloads: number;
  applications: number;
  byTheme: NamedCount[];
  byCategoryGroup: NamedCount[];
  byFormat: NamedCount[];
  topKeywords: NamedCount[];
};

type ThemeStat = {
  theme: string;
  count: number;
  files: number;
  apis: number;
  hybrids: number;
  views: number;
  downloads: number;
  applications: number;
  keywords: string[];
  color: string;
};

type RecordSummary = Pick<
  ThemeStat,
  "count" | "files" | "apis" | "views" | "downloads" | "applications" | "keywords"
  | "hybrids"
>;

type GraphNodeKind = "center" | "level1" | "level2" | "level3" | "record" | "overflow";

type GraphItem = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  countLabel: string;
  color: string;
  radius: number;
  tooltip?: string;
  parentId?: string;
  isEmpty?: boolean;
  theme?: string;
  categoryLevel2?: string;
  categoryLevel3?: string;
  recordId?: string;
};

type GraphControls = {
  fitAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

type GraphNode = d3.SimulationNodeDatum & {
  id: string;
  label: string;
  countLabel: string;
  color: string;
  radius: number;
  kind: GraphNodeKind;
  tooltip?: string;
  parentId?: string;
  targetX: number;
  targetY: number;
  angle: number;
  theme?: string;
  categoryLevel2?: string;
  recordId?: string;
  isCenter?: boolean;
  isEmpty?: boolean;
  labelLane?: number;
};

type GraphLink = {
  source: string;
  target: string;
  isEmpty?: boolean;
};

type IconName =
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp"
  | "chevronsLeft"
  | "chevronsRight"
  | "collapseView"
  | "fitView"
  | "help"
  | "home"
  | "minus"
  | "pause"
  | "play"
  | "plus"
  | "rotateCcw"
  | "search"
  | "x";

const palette = [
  "#3b82f6",
  "#8b5cf6",
  "#059669",
  "#f97316",
  "#4338ca",
  "#ec4899",
  "#eab308",
  "#14b8a6",
  "#ef4444",
  "#06b6d4",
  "#7c3aed",
  "#64748b",
];

const centerNodeColor = "#111827";
const branchNodeRadius = 62;
const level2NodeRadius = 46;
const level3NodeRadius = Math.round(branchNodeRadius * 0.44);
const recordDotRadius = 5;

const numberFormatter = new Intl.NumberFormat("ko-KR");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function dataGoKrUrl(record: DatasetRecord) {
  return record.portalPath ? `https://www.data.go.kr${record.portalPath}` : "";
}

function kindDisplay(record: DatasetRecord) {
  if (record.kind === "hybrid") return "API/파일데이터";
  return record.kind === "api" ? "API" : "파일데이터";
}

function kindBadgeLabel(record: DatasetRecord) {
  if (record.kind === "hybrid") return "API/파일";
  return record.kind === "api" ? "API" : "파일";
}

function kindColor(record: DatasetRecord) {
  if (record.kind === "hybrid") return "#0f766e";
  return record.kind === "api" ? "#2563eb" : "#4f7fe5";
}

function matchesKindFilter(record: DatasetRecord, kind: KindFilter) {
  return kind === "all" || record.kind === kind;
}

function formatRecordValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
  if (typeof value === "number") return formatNumber(value);
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function normalizeInfoRows(rows: Array<{ label: string; value: unknown }>) {
  return rows
    .map((row) => ({ ...row, value: formatRecordValue(row.value) }))
    .filter((row) => row.value !== "-");
}

function recordInfoRows(record: DatasetRecord) {
  return normalizeInfoRows([
    { label: "데이터명", value: record.name },
    { label: "데이터유형", value: kindDisplay(record) },
    { label: "제공기관", value: record.제공기관 },
    { label: "분류체계", value: record.분류체계 },
    { label: "확장자", value: record.확장자 },
    { label: "갱신주기", value: record.업데이트주기 },
    { label: "차기 등록 예정일", value: record.차기등록예정일 },
    { label: "매체유형", value: record.매체유형 },
    ...(record.kind !== "api" ? [{ label: "전체 행", value: record.전체행 }] : []),
    { label: "키워드", value: record.키워드 },
    { label: "등록일", value: record.등록일 },
    { label: "수정일", value: record.수정일 },
    { label: "관리부서명", value: record.관리부서명 },
    { label: "관리부서 전화", value: record.관리부서전화 },
    { label: "설명", value: record.설명 },
    { label: "보유근거", value: record.보유근거 },
    { label: "수집방법", value: record.수집방법 },
    { label: "데이터 한계", value: record.데이터한계 },
    { label: "기타 유의사항", value: record.기타유의사항 },
  ]);
}

function level1Label(record: DatasetRecord) {
  return record.분류체계.split(" - ")[0]?.trim() || "기타";
}

function level2Label(record: DatasetRecord) {
  const parts = record.분류체계.split(" - ");
  return parts[1]?.trim() || parts[0]?.trim() || "기타";
}

function extensionLabel(record: DatasetRecord) {
  return record.확장자 || "기타";
}

function level1NodeId(theme: string) {
  return `level1-${theme}`;
}

function level2NodeId(theme: string, category: string) {
  return `level2-${theme}-${category}`;
}

function dataMapSearchText(record: DatasetRecord) {
  return [record.name, record.설명, ...record.키워드].join(" ").toLowerCase();
}

function detailSearchText(record: DatasetRecord) {
  return [
    record.name,
    record.원본제목,
    record.분류체계,
    record.제공기관,
    record.확장자,
    record.업데이트주기,
    record.관리부서명,
    record.설명,
    record.등록일,
    record.수정일,
    record.id,
    ...record.키워드,
  ]
    .join(" ")
    .toLowerCase();
}

function matchesText(record: DatasetRecord, query: string, getText: (record: DatasetRecord) => string) {
  const normalized = query.trim().toLowerCase();
  return !normalized || getText(record).includes(normalized);
}

function matchesDataMapSearch(record: DatasetRecord, query: string) {
  return matchesText(record, query, dataMapSearchText);
}

function matchesDetailSearch(record: DatasetRecord, query: string) {
  return matchesText(record, query, detailSearchText);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightParts(value: string, query: string) {
  const term = query.trim();
  if (!term) return [{ text: value, isMatch: false }];

  const matcher = new RegExp(`(${escapeRegExp(term)})`, "gi");
  const normalizedTerm = term.toLowerCase();

  return value
    .split(matcher)
    .filter((part) => part !== "")
    .map((part) => ({
      text: part,
      isMatch: part.toLowerCase() === normalizedTerm,
    }));
}

function highlightSearchTerm(value: string, query: string) {
  return highlightParts(value, query).map((part, index) =>
    part.isMatch ? (
      <mark className="search-highlight" key={`${part.text}-${index}`}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

function compareRecords(sortKey: SortKey) {
  return (a: DatasetRecord, b: DatasetRecord) => {
    if (sortKey === "name") return a.name.localeCompare(b.name, "ko-KR");

    const left =
      sortKey === "downloads"
        ? a.다운로드수
        : sortKey === "applications"
          ? a.활용신청수
          : a.조회수;
    const right =
      sortKey === "downloads"
        ? b.다운로드수
        : sortKey === "applications"
          ? b.활용신청수
          : b.조회수;

    return right - left || a.name.localeCompare(b.name, "ko-KR");
  };
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = value.trim() || "기타";
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB, "ko-KR"))
    .map(([name, count]) => ({ name, count }));
}

function keywordPopularityScore(record: DatasetRecord) {
  return Math.max(record.다운로드수 + record.활용신청수, 1);
}

function keywordCounts(records: DatasetRecord[], limit: number) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const score = keywordPopularityScore(record);
    for (const keyword of record.키워드) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + score);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko-KR"))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function topKeywords(records: DatasetRecord[]) {
  return keywordCounts(records, 6).map(({ name }) => name);
}

function topKeywordsFromPopularRecords(records: DatasetRecord[], limit = 20) {
  const keywords: string[] = [];
  const seen = new Set<string>();

  const rankedRecords = [...records].sort(
    (a, b) => keywordPopularityScore(b) - keywordPopularityScore(a) || a.name.localeCompare(b.name, "ko-KR"),
  );

  for (const record of rankedRecords) {
    for (const keyword of record.키워드) {
      if (seen.has(keyword)) continue;

      seen.add(keyword);
      keywords.push(keyword);

      if (keywords.length >= limit) return keywords;
    }
  }

  return keywords;
}

function summarizeCatalog(records: DatasetRecord[]): CatalogSummary {
  return {
    total: records.length,
    files: records.filter((record) => record.kind === "file").length,
    apis: records.filter((record) => record.kind === "api").length,
    hybrids: records.filter((record) => record.kind === "hybrid").length,
    views: records.reduce((sum, record) => sum + record.조회수, 0),
    downloads: records.reduce((sum, record) => sum + record.다운로드수, 0),
    cumulativeDownloads: 0,
    applications: records.reduce((sum, record) => sum + record.활용신청수, 0),
    byTheme: countBy(records.map(level1Label)),
    byCategoryGroup: countBy(records.map(level2Label)),
    byFormat: countBy(records.map((record) => record.확장자 || "기타")),
    topKeywords: keywordCounts(records, 30),
  };
}

function summarizeRecords(records: DatasetRecord[]): RecordSummary {
  return {
    count: records.length,
    files: records.filter((record) => record.kind === "file").length,
    apis: records.filter((record) => record.kind === "api").length,
    hybrids: records.filter((record) => record.kind === "hybrid").length,
    views: records.reduce((sum, record) => sum + record.조회수, 0),
    downloads: records.reduce((sum, record) => sum + record.다운로드수, 0),
    applications: records.reduce((sum, record) => sum + record.활용신청수, 0),
    keywords: topKeywords(records),
  };
}

function summaryTooltip(label: string, summary: RecordSummary) {
  return [
    label,
    `데이터 ${formatNumber(summary.count)}건`,
    `파일 ${formatNumber(summary.files)} · API ${formatNumber(summary.apis)} · API/파일 ${formatNumber(summary.hybrids)}`,
    summary.keywords.length ? `대표 키워드 ${summary.keywords.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function recordTooltip(record: DatasetRecord) {
  return [
    record.name,
    kindDisplay(record),
    `${level1Label(record)} > ${level2Label(record)}`,
    `확장자 ${extensionLabel(record)}`,
    record.키워드.length ? `키워드 ${record.키워드.slice(0, 6).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function shortLabel(label: string, max = 12) {
  return label.length > max ? `${label.slice(0, max - 1)}...` : label;
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const iconProps = {
    "aria-hidden": true,
    className: "ui-icon",
    fill: "none",
    focusable: false,
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2.2,
    viewBox: "0 0 24 24",
    width: size,
  };

  switch (name) {
    case "chevronDown":
      return (
        <svg {...iconProps}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevronLeft":
      return (
        <svg {...iconProps}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case "chevronRight":
      return (
        <svg {...iconProps}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "chevronUp":
      return (
        <svg {...iconProps}>
          <path d="m18 15-6-6-6 6" />
        </svg>
      );
    case "chevronsLeft":
      return (
        <svg {...iconProps}>
          <path d="m11 17-5-5 5-5" />
          <path d="m18 17-5-5 5-5" />
        </svg>
      );
    case "chevronsRight":
      return (
        <svg {...iconProps}>
          <path d="m6 17 5-5-5-5" />
          <path d="m13 17 5-5-5-5" />
        </svg>
      );
    case "collapseView":
      return (
        <svg {...iconProps}>
          <path d="M9 3v6H3" />
          <path d="m3 3 6 6" />
          <path d="M15 3v6h6" />
          <path d="m21 3-6 6" />
          <path d="M9 21v-6H3" />
          <path d="m3 21 6-6" />
          <path d="M15 21v-6h6" />
          <path d="m21 21-6-6" />
        </svg>
      );
    case "fitView":
      return (
        <svg {...iconProps}>
          <path d="M8 4H4v4" />
          <path d="m4 4 6 6" />
          <path d="M16 4h4v4" />
          <path d="m20 4-6 6" />
          <path d="M4 16v4h4" />
          <path d="m4 20 6-6" />
          <path d="M20 16v4h-4" />
          <path d="m20 20-6-6" />
        </svg>
      );
    case "help":
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.75 9a2.35 2.35 0 0 1 4.5 1c0 1.5-1.5 2-2.25 2.75" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "home":
      return (
        <svg {...iconProps}>
          <path d="m3 10.5 9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case "minus":
      return (
        <svg {...iconProps}>
          <path d="M5 12h14" />
        </svg>
      );
    case "pause":
      return (
        <svg {...iconProps}>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
        </svg>
      );
    case "play":
      return (
        <svg {...iconProps} fill="currentColor" stroke="none">
          <path d="M8 5v14l11-7z" />
        </svg>
      );
    case "plus":
      return (
        <svg {...iconProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "rotateCcw":
      return (
        <svg {...iconProps}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      );
    case "search":
      return (
        <svg {...iconProps}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "x":
      return (
        <svg {...iconProps}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
  }
}

type GuideTargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type GuideStep = {
  id:
  | "kind"
  | "org"
  | "mapSearch"
  | "detailSearch"
  | "keyword"
  | "controls"
  | "level1Node"
  | "level2Node"
  | "dataList"
  | "portalLink";
  badge: string;
  label: string;
  title: string;
  body: string[];
  targetSelectors: string[];
  clickPoint: {
    x: number;
    y: number;
  };
  panelSide?: "left" | "right" | "top" | "bottom";
  substeps?: GuideSubStep[];
};

type GuideSubStep = {
  label: string;
  targetSelectors: string[];
  clickPoint: {
    x: number;
    y: number;
  };
};

const guideFixedKind: KindFilter = "hybrid";
const guideFixedOrg = "과학기술정보통신부";
const guideMapSearchTerm = "기술";
const guideDetailSearchTerm = "데이터";
const guideKeywordTerm = "과학기술연구";
const guideFanRecordLabels = [
  "과학기술 연구개발",
  "국가연구개발사업 조사분석",
  "연구개발비 통계",
  "기술무역 현황",
  "기업 연구개발 활동",
  "연구기관 현황",
  "기술수준 평가",
  "과학기술 인력",
  "ICT 연구성과",
  "기초연구 지원",
  "원천기술 개발",
  "첨단기술 동향",
  "과학기술 정책",
  "기술사업화",
  "국가전략기술",
  "연구장비 정보",
  "성과활용 통계",
  "과학문화 자료",
  "디지털 혁신",
  "AI 연구개발",
  "소프트웨어 기술",
  "정보통신 연구",
  "기술이전 현황",
  "산학연 협력",
  "지역 과학기술",
  "연구개발 과제",
  "국제 공동연구",
  "기술예측 조사",
  "과학기술 논문",
  "특허 성과",
  "연구윤리",
  "데이터 기반 연구",
  "융합연구",
  "과학기술 표준",
  "기술규제",
  "미래유망기술",
  "연구보안",
  "성과평가",
  "연구개발 예산",
  "실증사업",
  "공공기술 활용",
  "혁신성장 자료",
];

const guideSteps: GuideStep[] = [
  {
    id: "kind",
    badge: "1",
    label: "유형",
    title: "유형 선택",
    body: [
      "전체 유형 셀렉트 박스를 클릭해 제공 유형 목록을 엽니다.",
      "목록에서 API/파일데이터를 선택하는 모션과 실제 값 변경을 함께 보여줍니다.",
      "API/파일데이터 유형으로 바뀌면 중앙 데이터 수가 903건 기준으로 갱신됩니다.",
    ],
    targetSelectors: [".condition-select select"],
    clickPoint: { x: 0.68, y: 0.5 },
    panelSide: "right",
  },
  {
    id: "org",
    badge: "2",
    label: "기관",
    title: "기관 선택",
    body: [
      "전체 기관 버튼을 클릭해 기관 목록을 엽니다.",
      "기관 목록을 스크롤한 뒤 과학기술정보통신부 체크박스에 체크합니다.",
      "과학기술정보통신부 데이터만 지도와 목록에 남습니다.",
    ],
    targetSelectors: [".org-filter-option.guide-org-choice", ".org-filter-menu", ".org-filter-trigger"],
    clickPoint: { x: 0.55, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "mapSearch",
    badge: "3",
    label: "검색",
    title: "데이터맵 검색",
    body: [
      "데이터맵 검색창에 기술이 한 글자씩 입력됩니다.",
      "입력이 끝나면 검색 버튼까지 선택되며 기술 검색이 적용됩니다.",
      "검색 결과는 실제 데이터맵과 같은 노드와 목록으로 갱신됩니다.",
    ],
    targetSelectors: [".global-search-group"],
    clickPoint: { x: 0.44, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "detailSearch",
    badge: "4",
    label: "내검색",
    title: "결과 내 검색",
    body: [
      "결과 내 검색창에는 데이터가 한 글자씩 입력됩니다.",
      "이 검색은 현재 오른쪽 목록 안에서만 다시 찾습니다.",
      "목록이 길 때 데이터명이나 키워드 일부를 넣어 항목을 빠르게 찾습니다.",
    ],
    targetSelectors: [".result-search input", ".result-search"],
    clickPoint: { x: 0.32, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "keyword",
    badge: "5",
    label: "키워드",
    title: "과학기술연구 키워드 클릭",
    body: [
      "상단 추천 키워드에서 과학기술연구를 선택합니다.",
      "키워드는 다운로드와 활용신청이 많은 데이터에서 뽑아 보여줍니다.",
      "과학기술연구를 누르면 검색어가 적용되고 관련 데이터맵으로 전환됩니다.",
    ],
    targetSelectors: [".keyword-pager button.active", ".keyword-row"],
    clickPoint: { x: 0.55, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "controls",
    badge: "6",
    label: "조작",
    title: "화면 조작 버튼",
    body: [
      "전체 노드 펼치기, 확대, 축소, 초기화 버튼을 순서대로 소개합니다.",
      "각 버튼을 누르지는 않고, 어떤 기능인지 하나씩 가리켜 보여줍니다.",
      "전체 노드 버튼은 한 번 더 누르면 기본 화면 노드만 보이도록 접힙니다.",
    ],
    targetSelectors: [".canvas-map-controls .fit-view-button", ".canvas-map-controls"],
    clickPoint: { x: 0.5, y: 0.2 },
    panelSide: "right",
    substeps: [
      {
        label: "전체 노드",
        targetSelectors: [".canvas-map-controls .fit-view-button"],
        clickPoint: { x: 0.5, y: 0.5 },
      },
      {
        label: "확대",
        targetSelectors: [".canvas-map-controls button:nth-child(2)"],
        clickPoint: { x: 0.5, y: 0.5 },
      },
      {
        label: "축소",
        targetSelectors: [".canvas-map-controls button:nth-child(3)"],
        clickPoint: { x: 0.5, y: 0.5 },
      },
      {
        label: "초기화",
        targetSelectors: [".canvas-map-controls button:nth-child(4)"],
        clickPoint: { x: 0.5, y: 0.5 },
      },
    ],
  },
  {
    id: "level1Node",
    badge: "7",
    label: "1차노드",
    title: "1차 분류 노드 클릭",
    body: [
      "중앙 주변의 1차 분류 노드를 클릭해 큰 분류를 선택합니다.",
      "선택한 분류의 하위 노드가 펼쳐지고 오른쪽 목록도 함께 갱신됩니다.",
      "노드 색상과 연결선으로 현재 선택된 분류 위치를 확인합니다.",
    ],
    targetSelectors: [".d3-node.level1:not(.empty)", ".network-shell"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
  {
    id: "level2Node",
    badge: "8",
    label: "2차노드",
    title: "2차 분류 노드 클릭",
    body: [
      "1차 분류 아래에 열린 2차 노드를 클릭합니다.",
      "선택한 세부 분류 기준으로 데이터 점과 목록이 다시 좁혀집니다.",
      "선택한 2차 분류에 연결된 하위 데이터 노드가 모두 보이도록 펼쳐집니다.",
    ],
    targetSelectors: [".d3-node.level2.active", ".d3-node.level2", ".network-shell"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
  {
    id: "dataList",
    badge: "9",
    label: "목록",
    title: "데이터 목록 클릭",
    body: [
      "오른쪽 데이터 목록에서 원하는 항목 버튼을 클릭합니다.",
      "목록에는 파일, API, API/파일 유형 배지가 함께 표시됩니다.",
      "여성과학기술인력 데이터 항목을 누르는 모션 뒤 다음 단계에서 상세화면으로 전환됩니다.",
    ],
    targetSelectors: [".guide-list-click-target", ".dataset-list button", ".dataset-list-section", ".detail-panel"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
  {
    id: "portalLink",
    badge: "10",
    label: "바로가기",
    title: "공공데이터 바로가기",
    body: [
      "상세화면 하단의 공공데이터포털 바로가기 버튼을 확인합니다.",
      "이 버튼을 누르면 원문 상세 페이지로 이동해 다운로드와 활용신청을 진행할 수 있습니다.",
      "모달에서는 이동 흐름만 보여주고 실제 새 창은 열지 않습니다.",
    ],
    targetSelectors: [".data-portal-link", ".record-table-view", ".detail-panel"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
];

const emptyGuideRect: GuideTargetRect = {
  left: 24,
  top: 120,
  width: 360,
  height: 220,
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function findGuideTarget(selectors: string[], root?: HTMLElement | null): GuideTargetRect {
  for (const selector of selectors) {
    const element = root?.querySelector<Element>(selector) ?? document.querySelector<Element>(selector);
    if (!element) continue;

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  const fallback = root?.querySelector<HTMLElement>(".network-shell") ?? document.querySelector<HTMLElement>(".network-shell");
  if (!fallback) return emptyGuideRect;

  const rect = fallback.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function guideStepIndexOf(id: GuideStep["id"]) {
  return guideSteps.findIndex((item) => item.id === id);
}

function GuideDataMapPreview({
  crawledAt,
  datasets,
  detailQuery,
  mapQuery,
  stepIndex,
}: {
  crawledAt: string;
  datasets: DatasetRecord[];
  detailQuery: string;
  mapQuery: string;
  stepIndex: number;
}) {
  const step = guideSteps[stepIndex] ?? guideSteps[0];
  const hasKind = stepIndex >= guideStepIndexOf("kind");
  const hasOrg = stepIndex >= guideStepIndexOf("org");
  const hasMapSearch = stepIndex >= guideStepIndexOf("mapSearch");
  const hasDetailSearch = stepIndex >= guideStepIndexOf("detailSearch");
  const hasKeyword = stepIndex >= guideStepIndexOf("keyword");
  const hasLevel1 = stepIndex >= guideStepIndexOf("level1Node");
  const hasLevel2 = stepIndex >= guideStepIndexOf("level2Node");
  const hasListClick = stepIndex >= guideStepIndexOf("dataList");
  const hasPortal = stepIndex >= guideStepIndexOf("portalLink");
  const sortKey: SortKey = "views";
  const activeKind: KindFilter = hasKind ? guideFixedKind : "all";
  const selectedOrgs = hasOrg ? [guideFixedOrg] : [];
  const previewQuery = hasKeyword ? guideKeywordTerm : hasMapSearch ? mapQuery : "";
  const previewDetailQuery = hasDetailSearch ? detailQuery : "";
  const selectedTheme: string = previewQuery.trim() && (hasDetailSearch || hasKeyword || hasLevel1 || hasLevel2 || hasListClick || hasPortal)
    ? "과학기술"
    : "";
  const selectedCategoryLevel2: string = selectedTheme && (hasDetailSearch || hasKeyword || hasLevel2 || hasListClick || hasPortal)
    ? "과학기술진흥"
    : "";
  const detailsOpen = Boolean(selectedTheme || selectedCategoryLevel2 || previewDetailQuery || hasListClick || hasPortal);
  const showRecordDetail = hasPortal;
  const graphRevealLimit = selectedCategoryLevel2 ? 5000 : 50;
  const orgSelectionLabel =
    selectedOrgs.length === 0
      ? "전체 기관"
      : selectedOrgs.length === 1
        ? selectedOrgs[0]
        : `${selectedOrgs[0]} 외 ${formatNumber(selectedOrgs.length - 1)}`;

  const baseRecords = useMemo(() => {
    return datasets.filter((record) => {
      const kindMatch = matchesKindFilter(record, activeKind);
      const orgMatch = selectedOrgs.length === 0 || selectedOrgs.includes(record.제공기관);
      return kindMatch && orgMatch && matchesDataMapSearch(record, previewQuery);
    });
  }, [activeKind, datasets, previewQuery, selectedOrgs]);

  const catalogSummary = useMemo(() => summarizeCatalog(datasets), [datasets]);
  const themeOrder = useMemo(
    () => catalogSummary.byTheme.map((item) => item.name),
    [catalogSummary.byTheme],
  );
  const level1KiTaSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of datasets) {
      const theme = level1Label(record);
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count < 10).map(([theme]) => theme));
  }, [datasets]);

  const themeStats = useMemo<ThemeStat[]>(() => {
    const stats: ThemeStat[] = [];
    for (const [index, theme] of themeOrder.entries()) {
      if (level1KiTaSet.has(theme)) continue;
      const records = baseRecords.filter((record) => level1Label(record) === theme);
      stats.push({ theme, ...summarizeRecords(records), color: palette[index % palette.length] });
    }

    if (level1KiTaSet.size > 0) {
      const kiTaRecords = baseRecords.filter((record) => level1KiTaSet.has(level1Label(record)));
      stats.push({
        theme: "기타",
        ...summarizeRecords(kiTaRecords),
        color: palette[stats.length % palette.length],
      });
    }

    return stats;
  }, [baseRecords, level1KiTaSet, themeOrder]);

  const selectedScopeRecords = useMemo(() => {
    if (!selectedTheme) return baseRecords;
    return baseRecords.filter((record) => {
      const l1 = level1Label(record);
      if (selectedTheme === "기타") {
        if (!level1KiTaSet.has(l1)) return false;
        return !selectedCategoryLevel2 || l1 === selectedCategoryLevel2;
      }
      if (l1 !== selectedTheme) return false;
      if (!selectedCategoryLevel2) return true;
      return level2Label(record) === selectedCategoryLevel2;
    });
  }, [baseRecords, level1KiTaSet, selectedCategoryLevel2, selectedTheme]);

  const selectedRecords = useMemo(
    () => [...selectedScopeRecords].sort(compareRecords(sortKey)),
    [selectedScopeRecords, sortKey],
  );
  const detailRecords = useMemo(
    () => selectedRecords.filter((record) => matchesDetailSearch(record, previewDetailQuery)),
    [previewDetailQuery, selectedRecords],
  );
  const datasetPageSize = 10;
  const datasetPageCount = Math.max(Math.ceil(detailRecords.length / datasetPageSize), 1);
  const currentDatasetPage = 0;
  const visibleDetailRecords = detailRecords.slice(0, datasetPageSize);
  const visibleDatasetPages = Array.from(
    { length: Math.min(5, datasetPageCount) },
    (_, index) => index,
  );
  const currentScopeSummary = useMemo(() => summarizeRecords(detailRecords), [detailRecords]);
  const visibleTotals = useMemo(
    () => ({
      total: baseRecords.length,
      files: baseRecords.filter((record) => record.kind === "file").length,
      apis: baseRecords.filter((record) => record.kind === "api").length,
      hybrids: baseRecords.filter((record) => record.kind === "hybrid").length,
    }),
    [baseRecords],
  );
  const keywordSourceRecords = useMemo(() => {
    return datasets.filter((record) => {
      const kindMatch = matchesKindFilter(record, activeKind);
      const orgMatch = selectedOrgs.length === 0 || selectedOrgs.includes(record.제공기관);
      return kindMatch && orgMatch;
    });
  }, [activeKind, datasets, selectedOrgs]);
  const keywordOptions = useMemo(() => {
    const options = topKeywordsFromPopularRecords(keywordSourceRecords, 20);
    return [guideKeywordTerm, ...options.filter((keyword) => keyword !== guideKeywordTerm)].slice(0, 20);
  }, [keywordSourceRecords]);
  const selectedColor = selectedTheme
    ? (themeStats.find((stat) => stat.theme === selectedTheme)?.color ?? palette[0])
    : palette[0];
  const selectedRecord =
    detailRecords.find((record) => record.name.includes("여성과학기술인력_공공연구기관 직급별 승진현황")) ??
    detailRecords[0] ??
    selectedRecords[0] ??
    baseRecords[0];
  const selectedRecordRows = showRecordDetail && selectedRecord ? recordInfoRows(selectedRecord) : [];
  const selectedRecordIndex = selectedRecord
    ? detailRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const detailResultLabel = detailRecords.length
    ? `${formatNumber(Math.max(selectedRecordIndex, 0) + 1)}/${formatNumber(detailRecords.length)}`
    : "0/0";

  const graphData = useMemo<{
    center: GraphItem;
    items: GraphItem[];
  }>(() => {
    const center: GraphItem = {
      id: "__center",
      kind: "center",
      label: previewQuery.trim() || "데이터현황",
      countLabel: formatNumber(visibleTotals.total),
      color: centerNodeColor,
      radius: 72,
      tooltip: [
        previewQuery.trim() || "데이터현황",
        `데이터 ${formatNumber(visibleTotals.total)}건`,
        `파일 ${formatNumber(visibleTotals.files)} · API ${formatNumber(visibleTotals.apis)} · API/파일 ${formatNumber(visibleTotals.hybrids)}`,
      ].join("\n"),
    };
    const level1Items: GraphItem[] = themeStats.map((stat) => ({
      id: level1NodeId(stat.theme),
      kind: "level1",
      label: stat.theme,
      countLabel: stat.count ? formatNumber(stat.count) : "-",
      color: stat.color,
      radius: branchNodeRadius,
      tooltip: summaryTooltip(stat.theme, stat),
      isEmpty: stat.count === 0,
      theme: stat.theme,
    }));
    const items = [...level1Items];

    if (selectedTheme) {
      const level1Records =
        selectedTheme === "기타"
          ? baseRecords.filter((record) => level1KiTaSet.has(level1Label(record)))
          : baseRecords.filter((record) => level1Label(record) === selectedTheme);
      const themeIndex = Math.max(themeOrder.indexOf(selectedTheme), 0);
      const rawGroups = new Map<string, DatasetRecord[]>();

      for (const record of level1Records) {
        const category = selectedTheme === "기타" ? level1Label(record) : level2Label(record);
        const group = rawGroups.get(category) ?? [];
        group.push(record);
        rawGroups.set(category, group);
      }

      const categoryColorMap = new Map<string, string>();
      const sortedGroups = [...rawGroups.entries()].sort(([, a], [, b]) => b.length - a.length);
      const visibleGroups = sortedGroups.slice(0, graphRevealLimit);
      const hiddenGroupCount = Math.max(sortedGroups.length - graphRevealLimit, 0);

      items.push(
        ...visibleGroups.map<GraphItem>(([category, recordsInGroup], index) => {
          const color = palette[(themeIndex + index + 1) % palette.length];
          categoryColorMap.set(category, color);
          const summary = summarizeRecords(recordsInGroup);
          return {
            id: level2NodeId(selectedTheme, category),
            kind: "level2",
            label: category,
            countLabel: formatNumber(recordsInGroup.length),
            color,
            radius: level2NodeRadius,
            tooltip: summaryTooltip(`${selectedTheme} > ${category}`, summary),
            parentId: level1NodeId(selectedTheme),
            theme: selectedTheme,
            categoryLevel2: category,
          };
        }),
      );

      if (hiddenGroupCount > 0) {
        items.push({
          id: `overflow-${level1NodeId(selectedTheme)}`,
          kind: "overflow",
          label: "더보기",
          countLabel: `+${formatNumber(hiddenGroupCount)}`,
          color: selectedColor,
          radius: level2NodeRadius,
          tooltip: `${selectedTheme}\n더보기를 누르면 10개씩 추가 표시합니다.`,
          parentId: level1NodeId(selectedTheme),
          theme: selectedTheme,
        });
      }

      if (selectedCategoryLevel2) {
        const categoryRecords = [...(rawGroups.get(selectedCategoryLevel2) ?? [])].sort(
          compareRecords(sortKey),
        );
        const hasOverflow = categoryRecords.length > graphRevealLimit;
        const dotsToShow = hasOverflow ? categoryRecords.slice(0, graphRevealLimit) : categoryRecords;
        const dotColor =
          categoryColorMap.get(selectedCategoryLevel2) ?? palette[themeIndex % palette.length];

        items.push(
          ...dotsToShow.map<GraphItem>((record) => ({
            id: `record-${record.id}`,
            kind: "record",
            label: record.name,
            countLabel: record.kind === "file" ? record.확장자 || "FILE" : kindBadgeLabel(record),
            color: dotColor,
            radius: recordDotRadius,
            tooltip: recordTooltip(record),
            parentId: level2NodeId(selectedTheme, selectedCategoryLevel2),
            theme: selectedTheme,
            categoryLevel2: selectedCategoryLevel2,
            recordId: record.id,
          })),
        );

        if (hasOverflow) {
          items.push({
            id: `overflow-${level2NodeId(selectedTheme, selectedCategoryLevel2)}`,
            kind: "overflow",
            label: "더보기",
            countLabel: `+${formatNumber(categoryRecords.length - graphRevealLimit)}`,
            color: dotColor,
            radius: recordDotRadius + 7,
            tooltip: `${selectedCategoryLevel2}\n더보기를 누르면 10개씩 추가 표시합니다.`,
            parentId: level2NodeId(selectedTheme, selectedCategoryLevel2),
            theme: selectedTheme,
            categoryLevel2: selectedCategoryLevel2,
          });
        }
      }
    }

    return { center, items };
  }, [
    baseRecords,
    graphRevealLimit,
    level1KiTaSet,
    previewQuery,
    selectedCategoryLevel2,
    selectedColor,
    selectedTheme,
    sortKey,
    themeOrder,
    themeStats,
    visibleTotals.apis,
    visibleTotals.files,
    visibleTotals.hybrids,
    visibleTotals.total,
  ]);

  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of graphData.items) {
      if (item.kind === "level1" && item.theme) map.set(item.theme, item.color);
      if (item.kind === "level2" && item.categoryLevel2) map.set(item.categoryLevel2, item.color);
    }
    return map;
  }, [graphData.items]);
  const selectedGraphNodeId = step.id === "portalLink" && selectedRecord
    ? `record-${selectedRecord.id}`
    : step.id === "level1Node" && selectedTheme
      ? level1NodeId(selectedTheme)
      : selectedCategoryLevel2 && selectedTheme && (hasDetailSearch || hasKeyword || hasLevel2 || hasListClick)
      ? level2NodeId(selectedTheme, selectedCategoryLevel2)
      : selectedTheme && (hasLevel1 || hasDetailSearch || hasKeyword)
        ? level1NodeId(selectedTheme)
        : "";
  const handlePreviewNodeClick = useCallback(() => undefined, []);
  const registerPreviewControls = useCallback(() => undefined, []);
  const orgOptions = useMemo(() => {
    const options = [...new Set(datasets.map((record) => record.제공기관).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko-KR"));
    return [guideFixedOrg, ...options.filter((org) => org !== guideFixedOrg)].slice(0, 9);
  }, [datasets]);

  return (
    <section className="guide-preview-map" aria-label="실제 데이터맵 축소 화면">
      <header className="map-header guide-preview-header">
        <div className="brand-area">
          <span className="brand-mark" aria-hidden="true">
            <img src="/favicon.svg" alt="" />
          </span>
          <div>
            <h2>과학기술정보통신부 데이터맵</h2>
          </div>
        </div>
        <section className="search-panel" aria-label="가이드 데이터 검색">
          <div className="search-row">
            <label className="condition-select">
              <span>데이터유형</span>
              <select value={activeKind} onChange={() => undefined}>
                <option value="all">전체 유형</option>
                <option value="api">API</option>
                <option value="file">파일데이터</option>
                <option value="hybrid">API/파일데이터</option>
              </select>
            </label>
            <div className="org-filter">
              <button
                aria-expanded={step.id === "org"}
                aria-haspopup="listbox"
                className="org-filter-trigger"
                title={orgSelectionLabel}
                type="button"
              >
                <span>{orgSelectionLabel}</span>
                <Icon name={step.id === "org" ? "chevronUp" : "chevronDown"} size={16} />
              </button>
              {step.id === "org" ? (
                <div className="org-filter-menu" role="listbox" aria-label="기관 선택">
                  <label className="org-filter-option">
                    <input type="checkbox" checked={!hasOrg} readOnly />
                    <span>전체 기관</span>
                  </label>
                  {orgOptions.map((org) => (
                    <label
                      className={`org-filter-option${org === guideFixedOrg ? " guide-org-choice" : ""}`}
                      key={org}
                    >
                      <input type="checkbox" checked={hasOrg && org === guideFixedOrg} readOnly />
                      <span title={org}>{org}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="global-search-group">
              <label className="global-search">
                <span>데이터맵 검색</span>
                <input value={previewQuery} readOnly placeholder="데이터맵 검색" />
              </label>
              <button className="search-submit" type="button" aria-label="검색">
                <Icon name="search" size={18} />
              </button>
            </div>
            <label className="result-search">
              <span>결과 내 검색</span>
              <input value={previewDetailQuery} readOnly placeholder="결과 내 검색" />
              <span className="result-count">{detailResultLabel}</span>
              <button type="button" aria-label="이전 결과">
                <Icon name="chevronUp" size={16} />
              </button>
              <button type="button" aria-label="다음 결과">
                <Icon name="chevronDown" size={16} />
              </button>
              <button type="button" aria-label="결과 내 검색 지우기">
                <Icon name="x" size={15} />
              </button>
            </label>
            <div className="keyword-row" aria-label="추천 키워드">
              <button type="button" aria-label="이전 키워드">
                <Icon name="chevronLeft" size={15} />
              </button>
              <div className="keyword-pager">
                {keywordOptions.map((keyword) => (
                  <button className={previewQuery === keyword ? "active" : ""} key={keyword} type="button">
                    {keyword}
                  </button>
                ))}
              </div>
              <button type="button" aria-label="다음 키워드">
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </div>
        </section>
      </header>

      <section className={`map-workspace guide-preview-workspace${detailsOpen ? " with-detail" : ""}`}>
        <section className="network-shell" aria-label="공공데이터 네트워크 맵">
          <div className="network-toolbar">
            <button className="canvas-help-button" type="button" aria-label="가이드">
              <Icon name="help" size={17} />
            </button>
          </div>
          <NetworkGraph
            center={graphData.center}
            items={graphData.items}
            labelHighlightTerm={previewQuery}
            onNodeClick={handlePreviewNodeClick}
            registerControls={registerPreviewControls}
            selectedNodeId={selectedGraphNodeId}
            recordAngleStepPx={hasKeyword ? 9 : 11}
          />
          <div className="canvas-map-controls" aria-label="지도 확대 축소">
            <button className="fit-view-button" type="button" aria-label="전체 노드 펼치기">
              <Icon name="fitView" size={18} />
            </button>
            <button type="button" aria-label="확대">
              <Icon name="plus" size={18} />
            </button>
            <button type="button" aria-label="축소">
              <Icon name="minus" size={18} />
            </button>
            <button type="button" aria-label="검색 조건 초기화">
              <Icon name="rotateCcw" size={17} />
            </button>
          </div>
        </section>

        {detailsOpen ? (
          <aside className={`detail-panel ${showRecordDetail ? "record-mode" : "list-mode"}`}>
            <div className="panel-title">
              <strong>{showRecordDetail && selectedRecord ? selectedRecord.name : "데이터 목록"}</strong>
              <div className="panel-actions">
                {showRecordDetail ? (
                  <button type="button" aria-label="데이터 목록으로 돌아가기">
                    <Icon name="chevronLeft" size={17} />
                  </button>
                ) : null}
                <button type="button" aria-label="닫기">
                  <Icon name="x" size={17} />
                </button>
              </div>
            </div>

            <div className="detail-content" style={{ "--node-color": selectedColor } as CSSProperties}>
              {showRecordDetail && selectedRecord ? (
                <section className="record-table-view">
                  <table className="record-info-table">
                    <tbody>
                      {selectedRecordRows.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td>{highlightSearchTerm(row.value, previewDetailQuery)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="data-portal-link" type="button">
                    공공데이터 바로가기
                  </button>
                </section>
              ) : (
                <section className="dataset-list-section">
                  {detailRecords.length ? (
                    <>
                      <div className="dataset-list-summary">
                        <span>데이터 {formatNumber(currentScopeSummary.count)}</span>
                        <span>파일 {formatNumber(currentScopeSummary.files)}</span>
                        <span>API {formatNumber(currentScopeSummary.apis)}</span>
                        <span>API/파일 {formatNumber(currentScopeSummary.hybrids)}</span>
                      </div>
                      <ol className="dataset-list">
                        {visibleDetailRecords.map((record, index) => (
                          <li key={record.id}>
                            <button
                              className={record.id === selectedRecord?.id ? "guide-list-click-target" : ""}
                              type="button"
                            >
                              <span className="dataset-index">
                                {formatNumber(currentDatasetPage * datasetPageSize + index + 1)}
                              </span>
                              <span
                                className="dataset-dot"
                                style={
                                  {
                                    "--item-color":
                                      nodeColorMap.get(selectedCategoryLevel2) ??
                                      nodeColorMap.get(level1Label(record)) ??
                                      kindColor(record),
                                  } as CSSProperties
                                }
                                aria-hidden="true"
                              />
                              <span className="dataset-name">
                                {highlightSearchTerm(record.name, previewDetailQuery)}
                              </span>
                              <span className={`dataset-kind-badge ${record.kind}`}>
                                {kindBadgeLabel(record)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                      <nav className="dataset-pagination" aria-label="데이터 목록 페이지">
                        <button type="button" disabled aria-label="첫 페이지">
                          <Icon name="chevronsLeft" size={15} />
                        </button>
                        <button type="button" disabled aria-label="이전 페이지">
                          <Icon name="chevronLeft" size={15} />
                        </button>
                        {visibleDatasetPages.map((page) => (
                          <button
                            className={page === currentDatasetPage ? "active" : ""}
                            key={page}
                            type="button"
                            aria-label={`${formatNumber(page + 1)} 페이지`}
                          >
                            {formatNumber(page + 1)}
                          </button>
                        ))}
                        <button type="button" disabled={datasetPageCount <= 1} aria-label="다음 페이지">
                          <Icon name="chevronRight" size={15} />
                        </button>
                        <button type="button" disabled={datasetPageCount <= 1} aria-label="마지막 페이지">
                          <Icon name="chevronsRight" size={15} />
                        </button>
                      </nav>
                    </>
                  ) : (
                    <div className="empty-state">조건에 맞는 데이터가 없습니다.</div>
                  )}
                </section>
              )}
            </div>
          </aside>
        ) : null}
      </section>

      <footer className="map-footer">
        <span>
          과학기술정보통신부 · {crawledAt ? new Date(crawledAt).toLocaleDateString("ko-KR") : "-"} 기준
        </span>
        <span>
          현재 표시 {formatNumber(visibleTotals.total)}건 · 파일 {formatNumber(visibleTotals.files)} · API{" "}
          {formatNumber(visibleTotals.apis)} · API/파일 {formatNumber(visibleTotals.hybrids)}
        </span>
      </footer>
    </section>
  );
}

function GuideTour({
  open,
  onClose,
  onStepChange,
  stepIndex,
  steps,
  crawledAt,
  datasets,
}: {
  open: boolean;
  onClose: () => void;
  onStepChange: (stepIndex: number) => void;
  stepIndex: number;
  steps: GuideStep[];
  crawledAt: string;
  datasets: DatasetRecord[];
}) {
  const [typedText, setTypedText] = useState("");
  const [demoMapTypedText, setDemoMapTypedText] = useState("");
  const [demoDetailTypedText, setDemoDetailTypedText] = useState("");
  const [targetRect, setTargetRect] = useState<GuideTargetRect>(emptyGuideRect);
  const [subStepIndex, setSubStepIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const step = steps[stepIndex] ?? steps[0];
  const activeSubStep = step.substeps?.[subStepIndex % step.substeps.length];
  const activeTargetSelectors = activeSubStep?.targetSelectors ?? step.targetSelectors;
  const activeClickPoint = activeSubStep?.clickPoint ?? step.clickPoint;
  const stepScript = step.body.join("\n");
  const hasKind = stepIndex >= guideSteps.findIndex((item) => item.id === "kind");
  const hasOrg = stepIndex >= guideSteps.findIndex((item) => item.id === "org");
  const hasMapSearch = stepIndex >= guideSteps.findIndex((item) => item.id === "mapSearch");
  const hasDetailSearch = stepIndex >= guideSteps.findIndex((item) => item.id === "detailSearch");
  const hasKeyword = stepIndex >= guideSteps.findIndex((item) => item.id === "keyword");
  const hasLevel1 = stepIndex >= guideSteps.findIndex((item) => item.id === "level1Node");
  const hasLevel2 = stepIndex >= guideSteps.findIndex((item) => item.id === "level2Node");
  const hasListClick = stepIndex >= guideSteps.findIndex((item) => item.id === "dataList");
  const hasPortal = stepIndex >= guideSteps.findIndex((item) => item.id === "portalLink");
  const hasGuideKindScope = hasKind && !hasOrg;
  const hasGuideOrgScope = hasOrg && !hasMapSearch;
  const hasGuideMapScope = hasMapSearch;
  const showGuideLevel2 = hasMapSearch || hasDetailSearch || hasKeyword || hasLevel1 || hasLevel2 || hasListClick || hasPortal;
  const showGuideRecords = showGuideLevel2;
  const showGuideList = (hasDetailSearch || hasKeyword || hasLevel1 || hasLevel2 || hasListClick) && !hasPortal;
  const showGuideRecordDetail = hasPortal;
  const showGuideSidePanel = showGuideList || showGuideRecordDetail;
  const guideScopeTotalLabel = hasGuideMapScope ? "27" : hasGuideOrgScope ? "52" : hasGuideKindScope ? "903" : "1,707";
  const guideCenterLabel = hasGuideMapScope ? guideMapSearchTerm : "데이터현황";
  const guideCenterLabelLines = guideCenterLabel === guideMapSearchTerm ? ["과학기술", "연구"] : [guideCenterLabel];
  const guideResultCountLabel = hasPortal ? "22/27" : hasDetailSearch ? "1/27" : hasMapSearch ? "1/27" : hasOrg ? "1/52" : hasKind ? "1/903" : "1/1,707";
  const guideCategoryCounts =
    hasGuideMapScope
      ? {
          science: "27",
          communication: "-",
          other: "-",
          welfare: "1",
          administration: "-",
          environment: "-",
          education: "-",
          industry: "-",
          transport: "-",
          health: "-",
        }
      : hasGuideOrgScope
        ? {
            science: "37",
            communication: "8",
            other: "2",
            welfare: "1",
            administration: "4",
            environment: "-",
            education: "-",
            industry: "-",
            transport: "-",
            health: "-",
          }
        : hasGuideKindScope
          ? {
              science: "513",
              communication: "115",
              other: "9",
              welfare: "9",
              administration: "120",
              environment: "3",
              education: "90",
              industry: "8",
              transport: "19",
              health: "17",
            }
          : {
              science: "931",
              communication: "275",
              other: "16",
              welfare: "10",
              administration: "183",
              environment: "28",
              education: "155",
              industry: "29",
              transport: "35",
              health: "45",
            };
  const guideNodeStateClass = (count: string) => (count === "-" ? " guide-empty-node" : "");
  const demoKindLabel = hasKind ? "API/파일데이터" : "전체 유형";
  const demoOrgLabel = hasOrg ? guideFixedOrg : "전체 기관";
  const demoMapQuery = hasMapSearch ? demoMapTypedText : "";
  const demoDetailQuery = hasPortal ? "데" : hasDetailSearch ? demoDetailTypedText : "";
  const guideFanRecords = guideFanRecordLabels.slice(0, 27);
  const guideCenterX = 430;
  const guideCenterY = 470;
  const guideScienceX = 430;
  const guideScienceY = 315;
  const guidePrimaryLevel2X = showGuideRecords ? 310 : 300;
  const guidePrimaryLevel2Y = showGuideRecords ? 175 : 190;
  const guideResearchX = showGuideRecords ? 450 : 430;
  const guideResearchY = showGuideRecords ? 160 : 170;
  const guideThirdLevel2X = showGuideRecords ? 590 : 560;
  const guideThirdLevel2Y = showGuideRecords ? 175 : 190;

  useEffect(() => {
    setSubStepIndex(0);
  }, [stepIndex]);

  useEffect(() => {
    if (open) setIsPaused(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    setTypedText("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedText(stepScript.slice(0, index));
      if (index >= stepScript.length) {
        window.clearInterval(timer);
      }
    }, 24);

    return () => window.clearInterval(timer);
  }, [open, stepScript]);

  useEffect(() => {
    if (!open) return;

    const mapIndex = steps.findIndex((item) => item.id === "mapSearch");
    if (stepIndex < mapIndex) {
      setDemoMapTypedText("");
      return;
    }
    if (step.id !== "mapSearch") {
      setDemoMapTypedText(guideMapSearchTerm);
      return;
    }

    setDemoMapTypedText("");
    const letters = [...guideMapSearchTerm];
    const timer = window.setInterval(() => {
      setDemoMapTypedText((current) => {
        const next = letters.slice(0, current.length + 1).join("");
        if (next.length >= letters.length) window.clearInterval(timer);
        return next;
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, [open, step.id, stepIndex, steps]);

  useEffect(() => {
    if (!open) return;

    const detailIndex = steps.findIndex((item) => item.id === "detailSearch");
    if (stepIndex < detailIndex) {
      setDemoDetailTypedText("");
      return;
    }
    if (step.id !== "detailSearch") {
      setDemoDetailTypedText(guideDetailSearchTerm);
      return;
    }

    setDemoDetailTypedText("");
    const letters = [...guideDetailSearchTerm];
    const timer = window.setInterval(() => {
      setDemoDetailTypedText((current) => {
        const next = letters.slice(0, current.length + 1).join("");
        if (next.length >= letters.length) window.clearInterval(timer);
        return next;
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, [open, step.id, stepIndex, steps]);

  useEffect(() => {
    if (!open || isPaused) return;

    const timer = window.setTimeout(() => {
      onStepChange(stepIndex + 1 >= steps.length ? stepIndex : stepIndex + 1);
    }, 7200);

    return () => window.clearTimeout(timer);
  }, [isPaused, onStepChange, open, stepIndex, steps.length]);

  useEffect(() => {
    if (!open || isPaused || !step.substeps?.length || subStepIndex >= step.substeps.length - 1) return;

    const timer = window.setInterval(() => {
      setSubStepIndex((current) => Math.min(current + 1, step.substeps!.length - 1));
    }, 1500);

    return () => window.clearInterval(timer);
  }, [isPaused, open, step.substeps, subStepIndex]);

  useEffect(() => {
    if (!open) return;

    const updateTargetRect = () => {
      setTargetRect(findGuideTarget(activeTargetSelectors, modalRef.current));
    };

    updateTargetRect();
    const interval = window.setInterval(updateTargetRect, 450);
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect, true);
    };
  }, [activeTargetSelectors, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const moveStep = (nextIndex: number) => {
    onStepChange((nextIndex + steps.length) % steps.length);
  };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardWidth = Math.min(320, viewportWidth - 32);
  const cardHeight = 190;
  const targetCenterX = targetRect.left + targetRect.width * activeClickPoint.x;
  const targetCenterY = targetRect.top + targetRect.height * activeClickPoint.y;
  const panelGap = step.id === "kind" ? 84 : 26;
  const modalBounds = modalRef.current?.getBoundingClientRect();
  const boundaryLeft = modalBounds ? modalBounds.left + 12 : 16;
  const boundaryTop = modalBounds ? modalBounds.top + 12 : 16;
  const boundaryRight = modalBounds ? modalBounds.right - 12 : viewportWidth - 16;
  const boundaryBottom = modalBounds ? modalBounds.bottom - 78 : viewportHeight - 16;
  const spotlightStyle = {
    left: targetRect.left - 8,
    top: targetRect.top - 8,
    width: targetRect.width + 16,
    height: targetRect.height + 16,
  } as CSSProperties;
  const spotlightLeft = Math.max(0, targetRect.left - 8);
  const spotlightTop = Math.max(0, targetRect.top - 8);
  const spotlightRight = Math.min(viewportWidth, targetRect.left + targetRect.width + 8);
  const spotlightBottom = Math.min(viewportHeight, targetRect.top + targetRect.height + 8);
  const pointerStyle = {
    left: targetCenterX,
    top: targetCenterY,
  } as CSSProperties;

  let panelLeft =
    step.panelSide === "left"
      ? targetRect.left - cardWidth - panelGap
      : step.panelSide === "right"
        ? targetRect.left + targetRect.width + panelGap
        : targetRect.left + targetRect.width / 2 - cardWidth / 2;
  let panelTop =
    step.panelSide === "top"
      ? targetRect.top - cardHeight - panelGap
      : step.panelSide === "bottom"
        ? targetRect.top + targetRect.height + panelGap
        : targetCenterY - cardHeight / 2;

  if (panelLeft < boundaryLeft || panelLeft + cardWidth > boundaryRight) {
    panelLeft = targetCenterX < (boundaryLeft + boundaryRight) / 2 ? boundaryRight - cardWidth : boundaryLeft;
  }
  panelLeft = clampNumber(panelLeft, boundaryLeft, Math.max(boundaryLeft, boundaryRight - cardWidth));

  if (panelTop < boundaryTop || panelTop + cardHeight > boundaryBottom) {
    panelTop = clampNumber(
      targetCenterY - cardHeight / 2,
      boundaryTop,
      Math.max(boundaryTop, boundaryBottom - cardHeight),
    );
  }

  const panelStyle = {
    left: panelLeft,
    top: panelTop,
    width: cardWidth,
  } as CSSProperties;
  const selectPopoverStyle = {
    left: spotlightLeft,
    top: spotlightBottom + 8,
    width: Math.max(180, Math.min(260, spotlightRight - spotlightLeft)),
  } as CSSProperties;
  const panelAnchorX = clampNumber(targetCenterX, panelLeft, panelLeft + cardWidth);
  const panelAnchorY = clampNumber(targetCenterY, panelTop, panelTop + cardHeight);
  const typedLines = typedText.split("\n").filter(Boolean);
  const showClickMotion = step.id !== "controls";
  const showConnector = step.id !== "dataList";
  const guideProgressLabel = `${step.badge}/${steps.length}`;

  return (
    <div className="guide-tour-layer" role="dialog" aria-modal="true" aria-label="온라인 사용자 이용 메뉴얼">
      <div className="guide-modal-shell" ref={modalRef}>
        <div className="guide-modal-titlebar">
          <strong>온라인 사용자 이용 메뉴얼</strong>
          <button className="guide-icon-button" type="button" onClick={onClose} aria-label="메뉴얼 닫기">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="guide-interface-modal">
          <GuideDataMapPreview
            crawledAt={crawledAt}
            datasets={datasets}
            detailQuery={demoDetailQuery}
            mapQuery={demoMapQuery}
            stepIndex={stepIndex}
          />
          <header className="map-header guide-sim-header">
            <div className="brand-area guide-sim-brand">
              <span className="brand-mark" aria-hidden="true">
                <img src="/favicon.svg" alt="" />
              </span>
              <div>
                <h2>과학기술정보통신부 데이터맵</h2>
              </div>
            </div>
            <section className="search-panel" aria-label="가이드 데이터 검색">
              <div className="search-row">
                <label className="condition-select">
                  <span>데이터유형</span>
                  <select value={demoKindLabel} onChange={() => undefined}>
                    <option>전체 유형</option>
                    <option>API</option>
                    <option>파일데이터</option>
                    <option>API/파일데이터</option>
                  </select>
                </label>
                <div className="org-filter">
                  <button
                    aria-expanded={step.id === "org"}
                    aria-haspopup="listbox"
                    className="org-filter-trigger"
                    type="button"
                    title={demoOrgLabel}
                  >
                    <span>{demoOrgLabel}</span>
                    <Icon name={step.id === "org" ? "chevronUp" : "chevronDown"} size={16} />
                  </button>
                  {step.id === "org" ? (
                    <div className="org-filter-menu" role="listbox" aria-label="기관 선택">
                      {[
                        guideFixedOrg,
                        "광주과학기술원",
                        "국가과학기술연구회",
                        "국립과천과학관",
                        "국립광주과학관",
                        "국립부산과학관",
                        "국립전파연구원",
                        "국립중앙과학관",
                      ].map((org) => (
                        <label
                          className={`org-filter-option${org === guideFixedOrg ? " guide-org-choice" : ""}`}
                          key={org}
                        >
                          <input type="checkbox" checked={org === guideFixedOrg} readOnly />
                          <span>{org}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="global-search-group">
                  <label className="global-search">
                    <span>데이터맵 검색</span>
                    <input value={demoMapQuery} readOnly placeholder="데이터맵 검색" />
                  </label>
                  <button className="search-submit" type="button" aria-label="검색">
                    <Icon name="search" size={18} />
                  </button>
                </div>
                <label className="result-search">
                  <span>결과 내 검색</span>
                  <input value={demoDetailQuery} readOnly placeholder="결과 내 검색" />
                  <span className="result-count">{guideResultCountLabel}</span>
                  <button type="button" aria-label="이전 결과">
                    <Icon name="chevronUp" size={16} />
                  </button>
                  <button type="button" aria-label="다음 결과">
                    <Icon name="chevronDown" size={16} />
                  </button>
                  <button type="button" aria-label="결과 내 검색 지우기">
                    <Icon name="x" size={15} />
                  </button>
                </label>
                <div className="keyword-row" aria-label="추천 키워드">
                  <button type="button" aria-label="이전 키워드">
                    <Icon name="chevronLeft" size={15} />
                  </button>
                  <div className="keyword-pager">
                    {["기술통계", guideKeywordTerm, "연구개발", "디지털", "정보통신"].map((keyword) => (
                      <button className={keyword === guideKeywordTerm && hasKeyword ? "active" : ""} key={keyword} type="button">
                        {keyword}
                      </button>
                    ))}
                  </div>
                  <button type="button" aria-label="다음 키워드">
                    <Icon name="chevronRight" size={15} />
                  </button>
                </div>
              </div>
            </section>
          </header>

          <section className={`map-workspace guide-sim-workspace${showGuideSidePanel ? " with-detail" : " full-map"}`}>
            <section className="network-shell" aria-label="가이드 네트워크 맵">
              <div className="network-toolbar">
                <button className="canvas-help-button" type="button" aria-label="가이드">
                  <Icon name="help" size={17} />
                </button>
              </div>
              <div className="canvas-map-controls" aria-label="지도 확대 축소">
                <button className="fit-view-button" type="button" aria-label="전체 노드 펼치기">
                  <Icon name="fitView" size={18} />
                </button>
                <button type="button" aria-label="확대">
                  <Icon name="plus" size={18} />
                </button>
                <button type="button" aria-label="축소">
                  <Icon name="minus" size={18} />
                </button>
                <button type="button" aria-label="검색 조건 초기화">
                  <Icon name="rotateCcw" size={17} />
                </button>
              </div>
              <div className={`guide-sim-graph${hasMapSearch ? " searched" : ""}`}>
                <svg
                  className="guide-sim-svg"
                  viewBox={showGuideRecords ? "40 0 800 700" : "180 230 500 500"}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label="데이터맵 가이드 미리보기"
                >
                  <g
                    className={`guide-sim-graph-stage${showGuideRecords ? " expanded" : ""}`}
                    transform={showGuideRecords ? "translate(42 112) scale(0.78)" : undefined}
                  >
                  <g className="guide-svg-links">
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2={guideScienceX} y2={guideScienceY} />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="300" y2="360" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="560" y2="360" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="240" y2="455" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="620" y2="455" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="260" y2="555" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="600" y2="560" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="340" y2="625" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="430" y2="652" />
                    <line className="visible" x1={guideCenterX} y1={guideCenterY} x2="520" y2="625" />
                    <line className={showGuideLevel2 ? "visible" : ""} x1={guideScienceX} y1={guideScienceY} x2={guidePrimaryLevel2X} y2={guidePrimaryLevel2Y} />
                    <line className={showGuideLevel2 ? "visible" : ""} x1={guideScienceX} y1={guideScienceY} x2={guideResearchX} y2={guideResearchY} />
                    <line className={showGuideLevel2 ? "visible" : ""} x1={guideScienceX} y1={guideScienceY} x2={guideThirdLevel2X} y2={guideThirdLevel2Y} />
                  </g>
                  {showGuideRecords ? (
                    <g className="guide-record-fan" aria-label="4차 데이터 노드">
                      {guideFanRecords.map((label, index) => {
                        const angle = -160 + (140 * index) / Math.max(guideFanRecords.length - 1, 1);
                        const radians = (angle * Math.PI) / 180;
                        const recordFanRadius = 540;
                        const dotX = guideCenterX + Math.cos(radians) * recordFanRadius;
                        const dotY = guideCenterY + Math.sin(radians) * recordFanRadius;
                        const isFlipped = angle > 90 || angle < -90;
                        const labelAngle = isFlipped ? angle + 180 : angle;
                        const labelX = isFlipped ? -12 : 12;
                        const labelAnchor = isFlipped ? "end" : "start";
                        return (
                          <g
                            className="guide-record-fan-item"
                            key={label}
                            style={{ "--fan-delay": `${index * 18}ms` } as CSSProperties}
                          >
                            <line x1={guidePrimaryLevel2X} y1={guidePrimaryLevel2Y} x2={dotX} y2={dotY} />
                            <g transform={`translate(${dotX} ${dotY})`}>
                              <circle r={index === guideFanRecords.length - 1 ? 7 : 4.8} />
                              <g className="guide-record-label-group" transform={`rotate(${labelAngle})`}>
                                <text x={labelX} dy="0.35em" textAnchor={labelAnchor}>
                                  {label}
                                </text>
                              </g>
                            </g>
                          </g>
                        );
                      })}
                    </g>
                  ) : null}
                  <g className="guide-svg-node d3-node center search-match" transform={`translate(${guideCenterX} ${guideCenterY})`}>
                    <circle r="46" />
                    <text>
                      {guideCenterLabelLines.length > 1 ? (
                        <>
                          <tspan x="0" y="-17">{guideCenterLabelLines[0]}</tspan>
                          <tspan x="0" y="2">{guideCenterLabelLines[1]}</tspan>
                          <tspan x="0" y="26">{guideScopeTotalLabel}</tspan>
                        </>
                      ) : (
                        <>
                          <tspan x="0" y="-6">{guideCenterLabel}</tspan>
                          <tspan x="0" y="18">{guideScopeTotalLabel}</tspan>
                        </>
                      )}
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 guide-node-level1-primary${showGuideLevel2 ? " active" : ""}${hasMapSearch ? " search-match" : ""}`} transform={`translate(${guideScienceX} ${guideScienceY})`}>
                    <circle r="48" />
                    <text>
                      <tspan x="0" y="-4">과학기술</tspan>
                      <tspan x="0" y="16">{guideCategoryCounts.science}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 violet${guideNodeStateClass(guideCategoryCounts.communication)}`} transform="translate(560 360)">
                    <circle r="46" />
                    <text>
                      <tspan x="0" y="-4">통신</tspan>
                      <tspan x="0" y="15">{guideCategoryCounts.communication}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 sky${guideNodeStateClass(guideCategoryCounts.other)}`} transform="translate(300 360)">
                    <circle r="46" />
                    <text>
                      <tspan x="0" y="-4">기타</tspan>
                      <tspan x="0" y="15">{guideCategoryCounts.other}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 red${guideNodeStateClass(guideCategoryCounts.welfare)}`} transform="translate(240 455)">
                    <circle r="44" />
                    <text>
                      <tspan x="0" y="-4">사회복지</tspan>
                      <tspan x="0" y="14">{guideCategoryCounts.welfare}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 green${guideNodeStateClass(guideCategoryCounts.administration)}`} transform="translate(620 455)">
                    <circle r="46" />
                    <text>
                      <tspan x="0" y="-4">일반공공행정</tspan>
                      <tspan x="0" y="14">{guideCategoryCounts.administration}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 lime${guideNodeStateClass(guideCategoryCounts.environment)}`} transform="translate(260 555)">
                    <circle r="42" />
                    <text>
                      <tspan x="0" y="-4">환경</tspan>
                      <tspan x="0" y="14">{guideCategoryCounts.environment}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 orange${guideNodeStateClass(guideCategoryCounts.education)}`} transform="translate(600 560)">
                    <circle r="42" />
                    <text>
                      <tspan x="0" y="-4">교육</tspan>
                      <tspan x="0" y="14">{guideCategoryCounts.education}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 yellow${guideNodeStateClass(guideCategoryCounts.industry)}`} transform="translate(340 625)">
                    <circle r="40" />
                    <text>
                      <tspan x="0" y="-10">산업·통상</tspan>
                      <tspan x="0" y="7">중소기업</tspan>
                      <tspan x="0" y="24">{guideCategoryCounts.industry}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 rose${guideNodeStateClass(guideCategoryCounts.transport)}`} transform="translate(430 652)">
                    <circle r="40" />
                    <text>
                      <tspan x="0" y="-4">교통및물류</tspan>
                      <tspan x="0" y="14">{guideCategoryCounts.transport}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level1 indigo${guideNodeStateClass(guideCategoryCounts.health)}`} transform="translate(520 625)">
                    <circle r="40" />
                    <text>
                      <tspan x="0" y="-4">보건</tspan>
                      <tspan x="0" y="14">{guideCategoryCounts.health}</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level2 violet guide-primary-level2-node${showGuideRecords ? " active" : ""}${showGuideLevel2 ? " visible" : ""}`} transform={`translate(${guidePrimaryLevel2X} ${guidePrimaryLevel2Y})`}>
                    <circle r="38" />
                    <text>
                      <tspan x="0" y="-4">과학기술연구</tspan>
                      <tspan x="0" y="13">27</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level2 green guide-research-node${showGuideLevel2 ? " visible" : ""}`} transform={`translate(${guideResearchX} ${guideResearchY})`}>
                    <circle r="38" />
                    <text>
                      <tspan x="0" y="-4">연구사업</tspan>
                      <tspan x="0" y="13">9</tspan>
                    </text>
                  </g>
                  <g className={`guide-svg-node d3-node level2 orange${showGuideLevel2 ? " visible" : ""} guide-empty-node`} transform={`translate(${guideThirdLevel2X} ${guideThirdLevel2Y})`}>
                    <circle r="38" />
                    <text>
                      <tspan x="0" y="-4">원자력기술</tspan>
                      <tspan x="0" y="13">-</tspan>
                    </text>
                  </g>
                  </g>
                </svg>
              </div>
            </section>

            {showGuideSidePanel ? (
              <aside className={`detail-panel ${showGuideRecordDetail ? "record-mode" : "list-mode"}`}>
                <div className="panel-title">
                  <strong>{showGuideRecordDetail ? "여성과학기술인력_공공연구기관 직급별 승진현황" : "데이터 목록"}</strong>
                  <div className="panel-actions">
                    {showGuideRecordDetail ? (
                      <button type="button" aria-label="데이터 목록으로 돌아가기">
                        <Icon name="chevronLeft" size={17} />
                      </button>
                    ) : null}
                    <button type="button" aria-label="닫기">
                      <Icon name="x" size={17} />
                    </button>
                  </div>
                </div>
                <div className="detail-content">
                  {showGuideRecordDetail ? (
                    <section className="record-table-view">
                      <table className="record-info-table">
                        <tbody>
                          <tr>
                            <th>데이터명</th>
                            <td>여성과학기술인력_공공연구기관 직급별 승진현황</td>
                          </tr>
                          <tr>
                            <th>데이터유형</th>
                            <td>API/파일데이터</td>
                          </tr>
                          <tr>
                            <th>제공기관</th>
                            <td>{guideFixedOrg}</td>
                          </tr>
                          <tr>
                            <th>분류체계</th>
                            <td>과학기술 - 과학기술진흥</td>
                          </tr>
                          <tr>
                            <th>확장자</th>
                            <td>CSV, XML, JSON</td>
                          </tr>
                          <tr>
                            <th>갱신주기</th>
                            <td>연간</td>
                          </tr>
                          <tr>
                            <th>전체 행</th>
                            <td>42</td>
                          </tr>
                          <tr>
                            <th>키워드</th>
                            <td>여성과학기술인, 공공연구기관, 과학기술자, 직급별, 승진, 여성, 남성</td>
                          </tr>
                          <tr>
                            <th>수정일</th>
                            <td>2026-07-10</td>
                          </tr>
                        </tbody>
                      </table>
                      <button className={`data-portal-link${hasPortal ? " guide-portal-active" : ""}`} type="button">
                        공공데이터 바로가기
                      </button>
                    </section>
                  ) : (
                    <section className="dataset-list-section">
                      <div className="dataset-list-summary">
                        <span>데이터 27</span>
                        <span>파일 0</span>
                        <span>API 0</span>
                        <span>API/파일 27</span>
                      </div>
                      <ol className="dataset-list">
                        {[
                          "여성과학기술인력_공공연구기관 직급별 승진현황",
                          "경제사회목적별 연구개발비 통계",
                          "기술무역_국가별 기술수출 추이",
                          "이공계인력실태조사_근로소득",
                          "이공계인력실태조사_박사 근로소득",
                          "이공계인력실태조사_최종 만족도",
                          "이공계인력실태조사_학위별 성별 기초자료",
                          "이공계인력실태조사_박사학위 전공별 현황",
                          "국가연구개발사업 조사분석",
                          "연구개발활동조사 통계",
                        ].map((name, index) => (
                          <li key={name}>
                            <button className={index === 0 ? "guide-list-click-target" : ""} type="button">
                              <span className="dataset-index">{index + 1}</span>
                              <span className="dataset-dot" style={{ "--item-color": "#8b5cf6" } as CSSProperties} />
                              <span className="dataset-name">{name}</span>
                              <span className="dataset-kind-badge hybrid">API/파일</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                </div>
              </aside>
            ) : null}
          </section>
        </div>
        <footer className="guide-modal-footer" aria-label="가이드 재생 컨트롤">
          <div className="guide-modal-step-dots" aria-label="가이드 단계">
            {steps.map((item, index) => (
              <button
                className={index === stepIndex ? "active" : ""}
                key={item.badge}
                type="button"
                onClick={() => moveStep(index)}
                aria-label={`${item.badge}. ${item.title}`}
              >
                {item.badge}
              </button>
            ))}
          </div>
          <div className="guide-playback-controls">
            <button type="button" onClick={() => moveStep(stepIndex - 1)} aria-label="이전 단계">
              <Icon name="chevronLeft" size={18} />
            </button>
            <button
              className="guide-play-toggle"
              type="button"
              onClick={() => setIsPaused((paused) => !paused)}
              aria-label={isPaused ? "가이드 재생" : "가이드 정지"}
            >
              <Icon name={isPaused ? "play" : "pause"} size={18} />
            </button>
            <button type="button" onClick={() => moveStep(stepIndex + 1)} aria-label="다음 단계">
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
          <span className="guide-progress-label">{guideProgressLabel}</span>
        </footer>
      </div>
      {showConnector ? (
        <svg className="guide-connector" aria-hidden="true">
          <line x1={targetCenterX} y1={targetCenterY} x2={panelAnchorX} y2={panelAnchorY} />
        </svg>
      ) : null}
      <div className="guide-spotlight" style={spotlightStyle} />
      {showClickMotion ? <span className="guide-click-pulse" style={pointerStyle} /> : null}
      <span className="guide-pointer" style={pointerStyle} />
      {step.id === "kind" ? (
        <div className="guide-select-popover" style={selectPopoverStyle} aria-hidden="true">
          <span>전체 유형</span>
          <span>API</span>
          <span>파일데이터</span>
          <strong>API/파일데이터</strong>
        </div>
      ) : null}

      <section className="guide-callout" style={panelStyle}>
        <div className="guide-callout-header">
          <div className="guide-callout-heading">
            <h2>{step.title}</h2>
          </div>
        </div>

        <ul className="guide-script-list">
          {typedLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NetworkGraph({
  center,
  items,
  labelHighlightTerm,
  onNodeClick,
  recordAngleStepPx = 24,
  registerControls,
  selectedNodeId,
}: {
  center: GraphItem;
  items: GraphItem[];
  labelHighlightTerm: string;
  onNodeClick: (item: GraphItem) => void;
  recordAngleStepPx?: number;
  registerControls: (controls: GraphControls | null) => void;
  selectedNodeId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const graphOffsetRef = useRef({ x: 0, y: 0 });
  const labelHighlightTermRef = useRef(labelHighlightTerm);
  const movedRecordPositionsRef = useRef(new Map<string, { angle: number; x: number; y: number }>());
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || size.width <= 0 || size.height <= 0) return;

    const width = size.width;
    const height = size.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const graphOffset = graphOffsetRef.current;
    const graphCenterX = centerX + graphOffset.x;
    const graphCenterY = centerY + graphOffset.y;
    const orbitRadius = Math.min(width, height) * 0.32;
    const level1Radius = Math.min(Math.max(orbitRadius * 0.98, 174), 250);
    const level2Radius = level1Radius * 1.65;
    const level3Radius = level2Radius * 1.52;
    const recordRadius = level3Radius + Math.min(Math.max(level1Radius * 0.58, 85), 120);
    const compactRecordAngleStep = recordAngleStepPx / Math.max(recordRadius, 1);
    const level1Items = items.filter((item) => item.kind === "level1");
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const level2ItemsByParent = new Map<string, GraphItem[]>();
    const level3ItemsByParent = new Map<string, GraphItem[]>();
    const recordItemsByParent = new Map<string, GraphItem[]>();

    for (const item of items) {
      if (!item.parentId) continue;

      if (item.kind === "level2") {
        const group = level2ItemsByParent.get(item.parentId) ?? [];
        group.push(item);
        level2ItemsByParent.set(item.parentId, group);
      }

      if (item.kind === "level3") {
        const group = level3ItemsByParent.get(item.parentId) ?? [];
        group.push(item);
        level3ItemsByParent.set(item.parentId, group);
      }

      if (item.kind === "record" || item.kind === "overflow") {
        const group = recordItemsByParent.get(item.parentId) ?? [];
        group.push(item);
        recordItemsByParent.set(item.parentId, group);
      }
    }

    const angleById = new Map<string, number>();
    const spreadAngle = (
      parentAngle: number,
      index: number,
      total: number,
      maxSpread: number,
      density = 0.22,
    ) => {
      if (total <= 1) return parentAngle;
      const spread = Math.min(maxSpread, total * density);
      return parentAngle + (index - (total - 1) / 2) * (spread / (total - 1));
    };
    const angleForItem = (item: GraphItem): number => {
      const cached = angleById.get(item.id);
      if (cached !== undefined) return cached;

      if (item.kind === "level1") {
        const index = Math.max(
          level1Items.findIndex((level1Item) => level1Item.id === item.id),
          0,
        );
        const angle =
          -Math.PI / 2 + (index / Math.max(level1Items.length, 1)) * Math.PI * 2;
        angleById.set(item.id, angle);
        return angle;
      }

      if (item.kind === "level2" && item.parentId) {
        const parent = itemsById.get(item.parentId);
        const parentAngle = parent ? angleForItem(parent) : -Math.PI / 2;
        const siblings = level2ItemsByParent.get(item.parentId) ?? [item];
        const index = Math.max(
          siblings.findIndex((sibling) => sibling.id === item.id),
          0,
        );
        const angle = spreadAngle(parentAngle, index, siblings.length, Math.PI * 0.95);
        angleById.set(item.id, angle);
        return angle;
      }

      if (item.kind === "level3" && item.parentId) {
        const parent = itemsById.get(item.parentId);
        const parentAngle = parent ? angleForItem(parent) : -Math.PI / 2;
        const siblings = level3ItemsByParent.get(item.parentId) ?? [item];
        const index = Math.max(
          siblings.findIndex((sibling) => sibling.id === item.id),
          0,
        );
        const angle = spreadAngle(parentAngle, index, siblings.length, Math.PI * 0.88);
        angleById.set(item.id, angle);
        return angle;
      }

      if ((item.kind === "record" || item.kind === "overflow") && item.parentId) {
        const parent = itemsById.get(item.parentId);
        const parentAngle = parent ? angleForItem(parent) : -Math.PI / 2;
        const siblings = recordItemsByParent.get(item.parentId) ?? [item];
        const index = Math.max(
          siblings.findIndex((sibling) => sibling.id === item.id),
          0,
        );
        const angle =
          parentAngle + (index - (siblings.length - 1) / 2) * compactRecordAngleStep;
        angleById.set(item.id, angle);
        return angle;
      }

      return -Math.PI / 2;
    };
    const targetForItem = (item: GraphItem) => {
      const angle = angleForItem(item);
      const radius =
        item.kind === "record" || item.kind === "overflow"
          ? recordRadius
          : item.kind === "level3"
            ? level3Radius
            : item.kind === "level2"
              ? level2Radius
              : level1Radius;

      return {
        x: graphCenterX + Math.cos(angle) * radius,
        y: graphCenterY + Math.sin(angle) * radius,
        angle,
      };
    };

    const graphNodes: GraphNode[] = [
      {
        id: "__center",
        label: center.label,
        countLabel: center.countLabel,
        color: center.color,
        radius: center.radius,
        kind: "center",
        isCenter: true,
        x: graphCenterX,
        y: graphCenterY,
        targetX: graphCenterX,
        targetY: graphCenterY,
        angle: 0,
      },
      ...items.map((item) => {
        const target = targetForItem(item);
        const movedPosition =
          item.kind === "record" ? movedRecordPositionsRef.current.get(item.id) : undefined;
        const x = movedPosition?.x ?? target.x;
        const y = movedPosition?.y ?? target.y;
        const angle = movedPosition?.angle ?? target.angle;

        return {
          id: item.id,
          label: item.label,
          countLabel: item.countLabel,
          color: item.color,
          radius: item.radius,
          kind: item.kind,
          tooltip: item.tooltip,
          parentId: item.parentId,
          targetX: x,
          targetY: y,
          angle,
          theme: item.theme,
          categoryLevel2: item.categoryLevel2,
          recordId: item.recordId,
          isEmpty: item.isEmpty,
          x,
          y,
        };
      }),
    ];
    const visibleRecordIds = new Set(
      items.filter((item) => item.kind === "record").map((item) => item.id),
    );
    for (const recordId of movedRecordPositionsRef.current.keys()) {
      if (!visibleRecordIds.has(recordId)) movedRecordPositionsRef.current.delete(recordId);
    }

    const recordsByParent = new Map<string, GraphNode[]>();
    for (const graphNode of graphNodes) {
      if (graphNode.kind !== "record" || !graphNode.parentId) continue;
      const group = recordsByParent.get(graphNode.parentId) ?? [];
      group.push(graphNode);
      recordsByParent.set(graphNode.parentId, group);
    }

    const labelLanePattern = [0, -1, 1, -2, 2, -3, 3];
    for (const records of recordsByParent.values()) {
      const lastArcByLane = new Map<number, number>();
      records
        .sort((recordA, recordB) => recordA.angle - recordB.angle)
        .forEach((record) => {
          const arcPosition = record.angle * recordRadius;
          const lane =
            labelLanePattern.find((candidate) => {
              const lastArc = lastArcByLane.get(candidate);
              return lastArc === undefined || arcPosition - lastArc >= 22;
            }) ?? 0;
          record.labelLane = lane;
          lastArcByLane.set(lane, arcPosition);
        });
    }

    const graphLinks: GraphLink[] = items.map((item) => ({
      source: item.parentId ?? "__center",
      target: item.id,
      isEmpty: item.isEmpty,
    }));

    const svg = d3
      .select(svgElement)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    svg.selectAll("*").remove();

    const layer = svg.append("g").attr("class", "d3-graph-layer");

    const link = layer
      .append("g")
      .attr("class", "d3-links")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(graphLinks)
      .join("line")
      .attr("class", (d) => `d3-link${d.isEmpty ? " empty" : ""}`);

    const node = layer
      .append("g")
      .attr("class", "d3-nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(graphNodes)
      .join("g")
      .attr("class", (d) =>
        [
          "d3-node",
          d.kind,
          d.isCenter ? "center" : "",
          d.isEmpty ? "empty" : "",
        ]
          .filter(Boolean)
          .join(" "),
      );

    node.append("title").text((d) => d.tooltip || `${d.label}\n${d.countLabel}`);

    node
      .filter((d) => d.kind === "record")
      .append("circle")
      .attr("class", "d3-record-hit")
      .attr("r", 18)
      .attr("fill", "transparent");

    node
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color);

    const bubbleNode = node.filter((d) => d.kind !== "record" && d.kind !== "overflow");
    const recordNode = node.filter((d) => d.kind === "record" || d.kind === "overflow");
    let draggedRecordId = "";
    const isDraggedRecord = (d: GraphNode) => d.kind === "record" && d.id === draggedRecordId;
    const isFlippedRecordLabel = (d: GraphNode) => {
      const angle = (d.angle * 180) / Math.PI;
      return angle > 90 || angle < -90;
    };
    const recordLabelRotation = (d: GraphNode) => {
      const angle = (d.angle * 180) / Math.PI;
      return angle > 90 || angle < -90 ? angle + 180 : angle;
    };
    const recordLabelX = (d: GraphNode) => {
      return isFlippedRecordLabel(d) ? -12 : 12;
    };
    const recordLabelAnchor = (d: GraphNode) => {
      return isFlippedRecordLabel(d) ? "end" : "start";
    };
    const recordLabelDy = (d: GraphNode) => {
      if (isDraggedRecord(d)) return "0.35em";
      return `${0.35 + (d.labelLane ?? 0) * 0.95}em`;
    };
    const recordLabelText = (d: GraphNode) => {
      if (d.kind === "overflow") return `${d.label} ${d.countLabel}`;
      return isDraggedRecord(d) ? shortLabel(d.label, 40) : shortLabel(d.label, 28);
    };
    const renderHighlightedSvgText = (
      textSelection: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown>,
      getText: (d: GraphNode) => string,
    ) => {
      textSelection.each(function renderTextParts(d) {
        const textElement = d3.select(this);
        textElement.selectAll("tspan").remove();
        const baseX = textElement.attr("x") ?? "0";
        const lines = getText(d).split("\n");

        for (const [lineIndex, line] of lines.entries()) {
          let hasTextInLine = false;
          for (const part of highlightParts(line, d.kind === "level1" || d.kind === "center" ? "" : labelHighlightTermRef.current)) {
            const tspan = textElement.append("tspan").text(part.text);
            if (!hasTextInLine) {
              tspan.attr("x", baseX).attr("dy", lineIndex === 0 ? "0" : "1.06em");
              hasTextInLine = true;
            }
            if (part.isMatch) tspan.attr("class", "d3-label-highlight");
          }
        }

        const parent = this.parentElement;
        if (!(parent instanceof SVGElement)) return;

        parent
          .querySelectorAll(".d3-label-click-target")
          .forEach((element) => element.remove());

        try {
          const textBox = this.getBBox();
          const clickTarget = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          clickTarget.setAttribute("class", "d3-label-click-target");
          clickTarget.setAttribute("x", String(textBox.x - 8));
          clickTarget.setAttribute("y", String(textBox.y - 4));
          clickTarget.setAttribute("width", String(textBox.width + 16));
          clickTarget.setAttribute("height", String(textBox.height + 8));
          clickTarget.setAttribute("rx", "4");
          parent.insertBefore(clickTarget, this);
        } catch {
          // Ignore labels that are not measurable during SVG layout updates.
        }

      });
    };
    const fitBubbleLabel = (
      textSelection: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown>,
    ) => {
      textSelection
        .attr("lengthAdjust", null)
        .attr("textLength", null)
        .attr("transform", null)
        .style("font-size", (d) => {
          const labelLength = d.label.replace(/\s+/g, "").length;
          if (d.kind === "center") return labelLength > 5 ? "18px" : "19px";
          if (d.kind === "level2") return "10.5px";
          return "13px";
        })
        .each(function fitOnlyWhenOverflow(d) {
          const textElement = this;
          window.requestAnimationFrame(() => {
            const maxWidth = Math.max(d.radius * 1.66, 34);
            const actualWidth = textElement.getComputedTextLength();
            const scale = actualWidth > maxWidth ? maxWidth / actualWidth : 1;
            textElement.setAttribute("transform", scale < 1 ? `scale(${scale},1)` : "");
          });
        });
    };

    const bubbleLabelGroup = bubbleNode.append("g").attr("class", "d3-node-label-group");
    const bubbleLabel = bubbleLabelGroup
      .append("text")
      .attr("class", "d3-node-label")
      .attr("dy", "-0.15em");
    fitBubbleLabel(bubbleLabel);
    renderHighlightedSvgText(bubbleLabel, (d) => d.label.replace(/\s+/g, ""));

    bubbleNode
      .append("text")
      .attr("class", "d3-node-count")
      .attr("dy", "1.35em")
      .text((d) => d.countLabel);

    const recordLabelGroup = recordNode
      .append("g")
      .attr("class", "d3-record-label-group")
      .attr("transform", (d) => `rotate(${recordLabelRotation(d)})`);

    const recordLabel = recordLabelGroup
      .append("text")
      .attr("class", "d3-record-label")
      .attr("dy", recordLabelDy)
      .attr("x", recordLabelX)
      .attr("text-anchor", recordLabelAnchor);
    renderHighlightedSvgText(recordLabel, recordLabelText);

    const updateRecordLabelOrientation = () => {
      recordNode
        .select<SVGGElement>(".d3-record-label-group")
        .attr("transform", (d) => `rotate(${recordLabelRotation(d)})`);

      const recordLabels = recordNode
        .select<SVGTextElement>(".d3-record-label")
        .attr("dy", recordLabelDy)
        .attr("x", recordLabelX)
        .attr("text-anchor", recordLabelAnchor);
      renderHighlightedSvgText(recordLabels, recordLabelText);
    };

    const nodeById = new Map(graphNodes.map((graphNode) => [graphNode.id, graphNode]));

    const childrenByParent = new Map<string, GraphNode[]>();
    for (const graphNode of graphNodes) {
      if (!graphNode.parentId) continue;
      const children = childrenByParent.get(graphNode.parentId) ?? [];
      children.push(graphNode);
      childrenByParent.set(graphNode.parentId, children);
    }
    const collectDescendants = (parentId: string) => {
      const descendants: GraphNode[] = [];
      const stack = [...(childrenByParent.get(parentId) ?? [])];

      while (stack.length) {
        const child = stack.pop();
        if (!child) continue;
        descendants.push(child);
        stack.push(...(childrenByParent.get(child.id) ?? []));
      }

      return descendants;
    };
    const collectAncestors = (graphNode: GraphNode) => {
      const ancestors: GraphNode[] = [];
      let parentId = graphNode.parentId;

      while (parentId) {
        const parent = nodeById.get(parentId);
        if (!parent) break;
        ancestors.push(parent);
        parentId = parent.parentId;
      }

      return ancestors;
    };
    const setDragFocus = (graphNode: GraphNode) => {
      const focusIds = new Set<string>(
        graphNode.isCenter ? graphNodes.map((candidate) => candidate.id) : [graphNode.id],
      );

      if (!graphNode.isCenter) {
        for (const descendant of collectDescendants(graphNode.id)) {
          focusIds.add(descendant.id);
        }

        for (const ancestor of collectAncestors(graphNode)) {
          focusIds.add(ancestor.id);
        }
      }

      layer.classed("dragging", true);
      node.classed("drag-focus", (d) => focusIds.has(d.id));
      link.classed(
        "drag-focus",
        (d) => focusIds.has(d.source) && focusIds.has(d.target),
      );
    };
    const clearDragFocus = () => {
      layer.classed("dragging", false);
      node.classed("drag-focus", false);
      link.classed("drag-focus", false);
    };
    const updateRecordAngle = (graphNode: GraphNode) => {
      const parent = graphNode.parentId ? nodeById.get(graphNode.parentId) : undefined;
      const parentX = parent?.x ?? parent?.targetX ?? centerX;
      const parentY = parent?.y ?? parent?.targetY ?? centerY;
      graphNode.angle = Math.atan2(
        (graphNode.y ?? graphNode.targetY) - parentY,
        (graphNode.x ?? graphNode.targetX) - parentX,
      );
    };
    const linkEndpoint = (graphLink: GraphLink, side: "source" | "target") => {
      const source = nodeById.get(graphLink.source);
      const target = nodeById.get(graphLink.target);
      const sourceX = source?.x ?? centerX;
      const sourceY = source?.y ?? centerY;
      const targetX = target?.x ?? centerX;
      const targetY = target?.y ?? centerY;
      const distance = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
      const sourceRadius = source?.radius ?? 0;
      const targetRadius = target?.radius ?? 0;
      const directionX = (targetX - sourceX) / distance;
      const directionY = (targetY - sourceY) / distance;

      if (side === "source") {
        return {
          x: sourceX + directionX * sourceRadius,
          y: sourceY + directionY * sourceRadius,
        };
      }

      return {
        x: targetX - directionX * targetRadius,
        y: targetY - directionY * targetRadius,
      };
    };
    const renderPositions = () => {
      link
        .attr("x1", (d) => linkEndpoint(d, "source").x)
        .attr("y1", (d) => linkEndpoint(d, "source").y)
        .attr("x2", (d) => linkEndpoint(d, "target").x)
        .attr("y2", (d) => linkEndpoint(d, "target").y);

      node.attr("transform", (d) => `translate(${d.x ?? centerX},${d.y ?? centerY})`);
    };

    let didDrag = false;
    let dragStartPosition = { x: 0, y: 0 };
    let suppressNextClick = false;
    const clickDragThreshold = 5;
    const graphItemFromNode = (d: GraphNode): GraphItem => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      countLabel: d.countLabel,
      color: d.color,
      radius: d.radius,
      parentId: d.parentId,
      isEmpty: d.isEmpty,
      theme: d.theme,
      categoryLevel2: d.categoryLevel2,
      recordId: d.recordId,
    });
    const openGraphNode = (d: GraphNode) => {
      if (d.isCenter) return;
      onNodeClick(graphItemFromNode(d));
    };
    const suppressClickOnce = () => {
      suppressNextClick = true;
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 80);
    };

    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        didDrag = false;
        dragStartPosition = { x: event.x, y: event.y };
        setDragFocus(d);
        if (d.kind === "record") {
          draggedRecordId = d.id;
          node.classed("drag-source", (candidate) => candidate.id === d.id);
          node.filter((candidate) => candidate.id === d.id).raise();
          updateRecordLabelOrientation();
        }
      })
      .on("drag", (event, d) => {
        const dragDistance = Math.hypot(
          event.x - dragStartPosition.x,
          event.y - dragStartPosition.y,
        );
        if (!didDrag && dragDistance < clickDragThreshold) return;

        didDrag = true;
        const previousX = d.x ?? d.targetX;
        const previousY = d.y ?? d.targetY;
        const deltaX = event.x - previousX;
        const deltaY = event.y - previousY;
        const movedNodes =
          d.kind === "center"
            ? graphNodes
            : [d, ...(d.kind === "level2" ? collectDescendants(d.id) : [])];

        for (const movedNode of movedNodes) {
          movedNode.x = (movedNode.x ?? movedNode.targetX) + deltaX;
          movedNode.y = (movedNode.y ?? movedNode.targetY) + deltaY;
        }

        if (d.kind === "record") {
          updateRecordAngle(d);
          updateRecordLabelOrientation();
        }

        renderPositions();
      })
      .on("end", (_event, d) => {
        if (!didDrag) {
          draggedRecordId = "";
          node.classed("drag-source", false);
          updateRecordLabelOrientation();
          clearDragFocus();
          suppressClickOnce();
          openGraphNode(d);
          window.setTimeout(() => {
            didDrag = false;
          }, 0);
          return;
        }

        if (d.kind === "center") {
          graphOffsetRef.current = {
            x: (d.x ?? d.targetX) - centerX,
            y: (d.y ?? d.targetY) - centerY,
          };

          for (const graphNode of graphNodes) {
            graphNode.targetX = graphNode.x ?? graphNode.targetX;
            graphNode.targetY = graphNode.y ?? graphNode.targetY;

            if (
              graphNode.kind !== "record" ||
              !movedRecordPositionsRef.current.has(graphNode.id)
            ) {
              continue;
            }

            movedRecordPositionsRef.current.set(graphNode.id, {
              angle: graphNode.angle,
              x: graphNode.targetX,
              y: graphNode.targetY,
            });
          }
          renderPositions();
        }

        if (d.kind === "record") {
          d.targetX = d.x ?? d.targetX;
          d.targetY = d.y ?? d.targetY;
          updateRecordAngle(d);
          movedRecordPositionsRef.current.set(d.id, {
            angle: d.angle,
            x: d.targetX,
            y: d.targetY,
          });
          renderPositions();
        }
        draggedRecordId = "";
        node.classed("drag-source", false);
        updateRecordLabelOrientation();
        clearDragFocus();
        window.setTimeout(() => {
          didDrag = false;
        }, 0);
      });

    node.call(drag);

    node.on("click", (event, d) => {
      event.stopPropagation();
      if (d.kind === "overflow") {
        return;
      }
      if (suppressNextClick) return;
      if (didDrag) return;
      openGraphNode(d);
    });

    node
      .filter((d) => d.kind === "overflow")
      .on("pointerup", (event, d) => {
        event.stopPropagation();
        openGraphNode(d);
      });

    node
      .filter((d) => d.kind === "overflow")
      .select("circle")
      .on("pointerup", (event, d) => {
        event.stopPropagation();
        openGraphNode(d as GraphNode);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
      });

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => {
        layer.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

    const restoreTargetPositions = () => {
      graphNodes.forEach((d) => {
        d.x = d.targetX;
        d.y = d.targetY;
      });
      renderPositions();
    };

    const fitGraph = () => {
      restoreTargetPositions();

      const padding = 44;
      const bounds = {
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
      };

      node.each(function measureNodeBounds(d) {
        const x = d.x ?? d.targetX;
        const y = d.y ?? d.targetY;
        let minX = x - d.radius - 20;
        let maxX = x + d.radius + 20;
        let minY = y - d.radius - 20;
        let maxY = y + d.radius + 20;

        try {
          const box = (this as SVGGElement).getBBox();
          minX = x + box.x;
          maxX = x + box.x + box.width;
          minY = y + box.y;
          maxY = y + box.y + box.height;
        } catch {
          const x = d.x ?? d.targetX;
          const y = d.y ?? d.targetY;
          const recordBuffer = d.kind === "record" ? Math.min(Math.max(d.label.length * 7, 86), 210) : 0;
          const buffer = d.kind === "record" ? recordBuffer : d.radius + 18;
          minX = x - buffer;
          maxX = x + buffer;
          minY = y - buffer;
          maxY = y + buffer;
        }

        bounds.maxX = Math.max(bounds.maxX, maxX);
        bounds.maxY = Math.max(bounds.maxY, maxY);
        bounds.minX = Math.min(bounds.minX, minX);
        bounds.minY = Math.min(bounds.minY, minY);
      });

      const graphWidth = Math.max(bounds.maxX - bounds.minX, 1);
      const graphHeight = Math.max(bounds.maxY - bounds.minY, 1);
      const scale = Math.min(
        1.35,
        Math.max(
          0.22,
          Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight),
        ),
      );
      const translateX = width / 2 - scale * (bounds.minX + graphWidth / 2);
      const translateY = height / 2 - scale * (bounds.minY + graphHeight / 2);

      svg
        .transition()
        .duration(200)
        .call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
    };

    const resetGraph = () => {
      graphOffsetRef.current = { x: 0, y: 0 };
      movedRecordPositionsRef.current.clear();
      graphNodes.forEach((d) => {
        const item = itemsById.get(d.id);
        const angle = item ? angleForItem(item) : 0;
        const radius =
          item?.kind === "record"
            ? recordRadius
            : item?.kind === "level2"
              ? level2Radius
              : item?.kind === "level1"
                ? level1Radius
                : 0;
        const target = item
          ? {
            angle,
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
          }
          : { x: centerX, y: centerY, angle: 0 };
        d.targetX = target.x;
        d.targetY = target.y;
        d.angle = target.angle;
      });
      updateRecordLabelOrientation();
      restoreTargetPositions();
      svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
    };

    registerControls({
      fitAll: fitGraph,
      zoomIn: () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.3);
      },
      zoomOut: () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.7);
      },
      reset: resetGraph,
    });

    fitGraph();

    return () => {
      registerControls(null);
      svg.on(".zoom", null);
    };
  }, [
    center,
    items,
    onNodeClick,
    recordAngleStepPx,
    registerControls,
    size.height,
    size.width,
  ]);

  useEffect(() => {
    labelHighlightTermRef.current = labelHighlightTerm;
    if (!svgRef.current) return;

    const renderTextParts = (element: SVGTextElement, value: string, term = labelHighlightTerm) => {
      const textElement = d3.select(element);
      textElement.selectAll("tspan").remove();

      for (const part of highlightParts(value, term)) {
        const tspan = textElement.append("tspan").text(part.text);
        if (part.isMatch) tspan.attr("class", "d3-label-highlight");
      }

      const parent = element.parentElement;
      if (!(parent instanceof SVGElement)) return;

      parent
        .querySelectorAll(".d3-label-click-target")
        .forEach((targetElement) => targetElement.remove());

      try {
        const textBox = element.getBBox();
        const clickTarget = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        clickTarget.setAttribute("class", "d3-label-click-target");
        clickTarget.setAttribute("x", String(textBox.x - 8));
        clickTarget.setAttribute("y", String(textBox.y - 4));
        clickTarget.setAttribute("width", String(textBox.width + 16));
        clickTarget.setAttribute("height", String(textBox.height + 8));
        clickTarget.setAttribute("rx", "4");
        parent.insertBefore(clickTarget, element);
      } catch {
        // Ignore labels that are not measurable during SVG layout updates.
      }

    };

    d3.select(svgRef.current)
      .selectAll<SVGTextElement, GraphNode>(".d3-node-label")
      .each(function updateBubbleLabel(d) {
        this.removeAttribute("textLength");
        this.removeAttribute("lengthAdjust");
        this.removeAttribute("transform");
        renderTextParts(this, d.label.replace(/\s+/g, ""), d.kind === "level1" || d.kind === "center" ? "" : labelHighlightTerm);
        window.requestAnimationFrame(() => {
          const maxWidth = Math.max(d.radius * 1.66, 34);
          const actualWidth = this.getComputedTextLength();
          const scale = actualWidth > maxWidth ? maxWidth / actualWidth : 1;
          this.setAttribute("transform", scale < 1 ? `scale(${scale},1)` : "");
        });
      });

    d3.select(svgRef.current)
      .selectAll<SVGTextElement, GraphNode>(".d3-record-label")
      .each(function updateRecordLabel(d) {
        const nodeElement = this.closest(".d3-node");
        const isDragSource = nodeElement?.classList.contains("drag-source") ?? false;
        renderTextParts(this, shortLabel(d.label, isDragSource ? 40 : 28));
      });
  }, [labelHighlightTerm]);

  useEffect(() => {
    if (!svgRef.current) return;

    d3.select(svgRef.current)
      .selectAll<SVGGElement, GraphNode>(".d3-node")
      .classed("active", (d) => d.id === selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!svgRef.current) return;

    const hasSearchTerm = Boolean(labelHighlightTerm.trim());
    d3.select(svgRef.current)
      .selectAll<SVGGElement, GraphNode>(".d3-node")
      .classed("search-match", (d) => hasSearchTerm && !d.isEmpty);
  }, [labelHighlightTerm]);

  return (
    <div className="network-canvas" ref={containerRef}>
      <svg
        aria-label="드래그 가능한 네트워크 데이터맵"
        className="d3-network-svg"
        ref={svgRef}
        role="img"
      />
    </div>
  );
}

export function DataMapClient() {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [crawledAt, setCrawledAt] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<KindFilter>("all");
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [selectedCategoryLevel2, setSelectedCategoryLevel2] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const sortKey: SortKey = "views";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStepIndex, setGuideStepIndex] = useState(0);
  const [detailQuery, setDetailQuery] = useState("");
  const [datasetPage, setDatasetPage] = useState(0);
  const [graphRevealLimit, setGraphRevealLimit] = useState(50);
  const [allNodesExpanded, setAllNodesExpanded] = useState(false);
  const [isKeywordDragging, setIsKeywordDragging] = useState(false);
  const graphControls = useRef<GraphControls | null>(null);
  const urlStateAppliedRef = useRef(false);
  const orgFilterRef = useRef<HTMLDivElement | null>(null);
  const keywordPagerRef = useRef<HTMLDivElement | null>(null);
  const guideAppliedStepRef = useRef("");
  const guideKeywordRef = useRef("");
  const guideMapTermRef = useRef("");
  const guideOrgRef = useRef("");
  const keywordDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    hasMoved: boolean;
  } | null>(null);
  const suppressKeywordClickRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    fetch(catalogUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`데이터 파일을 불러오지 못했습니다. (${response.status})`);
        }

        return response.json() as Promise<RawDatamap>;
      })
      .then((raw) => {
        if (!isMounted) return;
        setDatasets(datamapToRecords(raw));
        setCrawledAt(raw.crawled_at ?? "");
        setCatalogError("");
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setCatalogError(
          error instanceof Error ? error.message : "데이터 파일을 불러오지 못했습니다.",
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (urlStateAppliedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const nextKind = params.get("kind");
    const nextOrg = params.get("org") ?? "";
    const nextTheme = params.get("theme") ?? "";
    const nextCategory = params.get("category") ?? "";
    const nextRecord = params.get("record") ?? "";

    setQuery(params.get("q") ?? "");
    if (nextKind === "api" || nextKind === "file" || nextKind === "hybrid" || nextKind === "all") {
      setActiveKind(nextKind);
    }
    setSelectedOrgs(nextOrg.split(",").map((org) => org.trim()).filter(Boolean));
    setDetailQuery(params.get("detail") ?? "");
    setSelectedTheme(nextTheme);
    setSelectedCategoryLevel2(nextCategory);
    setSelectedId(nextRecord);
    setDetailsOpen(Boolean(nextTheme || nextCategory || nextRecord));
    urlStateAppliedRef.current = true;
  }, []);

  useEffect(() => {
    if (guideOpen) {
      setGuideStepIndex(0);
      guideAppliedStepRef.current = "";
      guideKeywordRef.current = "";
      guideMapTermRef.current = "";
      guideOrgRef.current = "";
    }
  }, [guideOpen]);

  const catalogSummary = useMemo(() => summarizeCatalog(datasets), [datasets]);
  const themeOrder = useMemo(
    () => catalogSummary.byTheme.map((item) => item.name),
    [catalogSummary.byTheme],
  );
  const orgOptions = useMemo(() => {
    return [...new Set(datasets.map((record) => record.제공기관).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko-KR"));
  }, [datasets]);

  useEffect(() => {
    function closeOrgMenu(event: PointerEvent) {
      if (!orgFilterRef.current?.contains(event.target as Node)) {
        setOrgMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOrgMenu);
    return () => document.removeEventListener("pointerdown", closeOrgMenu);
  }, []);

  const baseRecords = useMemo(() => {
    return datasets.filter((record) => {
      const kindMatch = matchesKindFilter(record, activeKind);
      const orgMatch = selectedOrgs.length === 0 || selectedOrgs.includes(record.제공기관);
      return kindMatch && orgMatch && matchesDataMapSearch(record, query);
    });
  }, [activeKind, query, selectedOrgs, datasets]);

  const level1KiTaSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of datasets) {
      const theme = level1Label(record);
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count < 10).map(([theme]) => theme));
  }, [datasets]);

  const themeStats = useMemo<ThemeStat[]>(() => {
    const stats: ThemeStat[] = [];
    for (const [index, theme] of themeOrder.entries()) {
      if (level1KiTaSet.has(theme)) continue;
      const records = baseRecords.filter((r) => level1Label(r) === theme);
      stats.push({ theme, ...summarizeRecords(records), color: palette[index % palette.length] });
    }
    if (level1KiTaSet.size > 0) {
      const kiTaRecords = baseRecords.filter((record) => level1KiTaSet.has(level1Label(record)));
      stats.push({
        theme: "기타",
        ...summarizeRecords(kiTaRecords),
        color: palette[stats.length % palette.length],
      });
    }
    return stats;
  }, [baseRecords, level1KiTaSet, themeOrder]);

  const selectedScopeRecords = useMemo(() => {
    if (!selectedTheme) return baseRecords;
    return baseRecords.filter((record) => {
      const l1 = level1Label(record);
      if (selectedTheme === "기타") {
        if (!level1KiTaSet.has(l1)) return false;
        return !selectedCategoryLevel2 || l1 === selectedCategoryLevel2;
      }
      if (l1 !== selectedTheme) return false;
      if (!selectedCategoryLevel2) return true;
      return level2Label(record) === selectedCategoryLevel2;
    });
  }, [baseRecords, level1KiTaSet, selectedCategoryLevel2, selectedTheme]);

  const selectedRecords = useMemo(() => {
    return [...selectedScopeRecords].sort(compareRecords(sortKey));
  }, [selectedScopeRecords, sortKey]);

  const detailRecords = useMemo(() => {
    return selectedRecords.filter((record) => matchesDetailSearch(record, detailQuery));
  }, [detailQuery, selectedRecords]);
  const datasetPageSize = 10;
  const datasetPageCount = Math.max(Math.ceil(detailRecords.length / datasetPageSize), 1);
  const currentDatasetPage = Math.min(datasetPage, datasetPageCount - 1);
  const visibleDetailRecords = detailRecords.slice(
    currentDatasetPage * datasetPageSize,
    (currentDatasetPage + 1) * datasetPageSize,
  );
  const maxDatasetPageButtons = 5;
  const datasetPageStart = Math.max(
    0,
    Math.min(
      currentDatasetPage - Math.floor(maxDatasetPageButtons / 2),
      datasetPageCount - maxDatasetPageButtons,
    ),
  );
  const visibleDatasetPages = Array.from(
    { length: Math.min(maxDatasetPageButtons, datasetPageCount) },
    (_, index) => datasetPageStart + index,
  );

  const activeSelectedId = baseRecords.some((record) => record.id === selectedId)
    ? selectedId
    : "";

  useEffect(() => {
    if (!urlStateAppliedRef.current) return;

    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (activeKind !== "all") params.set("kind", activeKind);
    if (selectedOrgs.length > 0) params.set("org", selectedOrgs.join(","));
    if (selectedTheme) params.set("theme", selectedTheme);
    if (selectedCategoryLevel2) params.set("category", selectedCategoryLevel2);
    if (activeSelectedId) params.set("record", activeSelectedId);
    if (detailQuery.trim()) params.set("detail", detailQuery.trim());

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
  }, [
    activeKind,
    activeSelectedId,
    detailQuery,
    query,
    selectedOrgs,
    selectedCategoryLevel2,
    selectedTheme,
  ]);

  const selectedRecord =
    detailRecords.find((record) => record.id === activeSelectedId) ??
    detailRecords[0] ??
    (activeSelectedId
      ? selectedRecords.find((record) => record.id === activeSelectedId)
      : undefined) ??
    (activeSelectedId ? datasets.find((record) => record.id === activeSelectedId) : undefined) ??
    selectedRecords[0] ??
    baseRecords[0] ??
    datasets[0];
  const selectedRecordIndex = selectedRecord
    ? detailRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const detailResultLabel = detailRecords.length
    ? `${formatNumber(Math.max(selectedRecordIndex, 0) + 1)}/${formatNumber(detailRecords.length)}`
    : "0/0";

  const visibleTotals = useMemo(() => {
    return {
      total: baseRecords.length,
      files: baseRecords.filter((record) => record.kind === "file").length,
      apis: baseRecords.filter((record) => record.kind === "api").length,
      hybrids: baseRecords.filter((record) => record.kind === "hybrid").length,
    };
  }, [baseRecords]);

  const selectedColor = selectedTheme
    ? (themeStats.find((stat) => stat.theme === selectedTheme)?.color ?? palette[0])
    : palette[0];
  const keywordSourceRecords = useMemo(() => {
    return datasets.filter((record) => {
      const kindMatch = matchesKindFilter(record, activeKind);
      const orgMatch = selectedOrgs.length === 0 || selectedOrgs.includes(record.제공기관);
      return kindMatch && orgMatch;
    });
  }, [activeKind, datasets, selectedOrgs]);
  const keywordOptions = useMemo(
    () => topKeywordsFromPopularRecords(keywordSourceRecords, 20),
    [keywordSourceRecords],
  );

  useEffect(() => {
    keywordPagerRef.current?.scrollTo({ left: 0 });
  }, [keywordOptions]);

  const graphData = useMemo<{
    center: GraphItem;
    items: GraphItem[];
  }>(() => {
    const center: GraphItem = {
      id: "__center",
      kind: "center",
      label: query.trim() || "데이터현황",
      countLabel: formatNumber(visibleTotals.total),
      color: centerNodeColor,
      radius: 72,
      tooltip: [
        query.trim() || "데이터현황",
        `데이터 ${formatNumber(visibleTotals.total)}건`,
        `파일 ${formatNumber(visibleTotals.files)} · API ${formatNumber(visibleTotals.apis)} · API/파일 ${formatNumber(visibleTotals.hybrids)}`,
      ].join("\n"),
    };
    const level1Items: GraphItem[] = themeStats.map((stat) => ({
      id: level1NodeId(stat.theme),
      kind: "level1",
      label: stat.theme,
      countLabel: stat.count ? formatNumber(stat.count) : "-",
      color: stat.color,
      radius: branchNodeRadius,
      tooltip: summaryTooltip(stat.theme, stat),
      isEmpty: stat.count === 0,
      theme: stat.theme,
    }));
    const items = [...level1Items];
    const appendLevel2Nodes = (theme: string) => {
      const level1Records =
        theme === "기타"
          ? baseRecords.filter((record) => level1KiTaSet.has(level1Label(record)))
          : baseRecords.filter((record) => level1Label(record) === theme);
      const themeIndex = Math.max(themeOrder.indexOf(theme), 0);

      // 3차 노드 – 기타 아래는 원래 2차 노드, 일반 분류 아래는 2차분류
      const rawGroups = new Map<string, DatasetRecord[]>();
      for (const r of level1Records) {
        const cat = theme === "기타" ? level1Label(r) : level2Label(r);
        const arr = rawGroups.get(cat) ?? [];
        arr.push(r);
        rawGroups.set(cat, arr);
      }

      const categoryColorMap = new Map<string, string>();
      const sortedGroups = [...rawGroups.entries()].sort(([, a], [, b]) => b.length - a.length);
      const visibleGroups = sortedGroups.slice(0, graphRevealLimit);
      const hiddenGroupCount = Math.max(sortedGroups.length - graphRevealLimit, 0);

      items.push(
        ...visibleGroups.map<GraphItem>(([category, recordsInGroup], index) => {
          const color = palette[(themeIndex + index + 1) % palette.length];
          categoryColorMap.set(category, color);
          const summary = summarizeRecords(recordsInGroup);
          return {
            id: level2NodeId(theme, category),
            kind: "level2",
            label: category,
            countLabel: formatNumber(recordsInGroup.length),
            color,
            radius: level2NodeRadius,
            tooltip: summaryTooltip(`${theme} > ${category}`, summary),
            parentId: level1NodeId(theme),
            theme,
            categoryLevel2: category,
          };
        }),
      );

      if (hiddenGroupCount > 0) {
        items.push({
          id: `overflow-${level1NodeId(theme)}`,
          kind: "overflow",
          label: "더보기",
          countLabel: `+${formatNumber(hiddenGroupCount)}`,
          color: selectedColor,
          radius: level2NodeRadius,
          tooltip: `${theme}\n더보기를 누르면 10개씩 추가 표시됩니다.\n오른쪽 데이터 상세보기 목록에서도 전체를 검색할 수 있습니다.`,
          parentId: level1NodeId(theme),
          theme,
        });
      }

      return {
        categoryColorMap,
        rawGroups,
        themeIndex,
      };
    };

    if (allNodesExpanded) {
      for (const item of level1Items) {
        if (!item.theme || item.isEmpty) continue;
        appendLevel2Nodes(item.theme);
      }
    } else if (selectedTheme) {
      const { categoryColorMap, rawGroups, themeIndex } = appendLevel2Nodes(selectedTheme);

      // 데이터 점 – 선택한 3차 노드 아래에 바로 표시, 50건 초과 시 더보기
      if (selectedCategoryLevel2) {
        const categoryRecords = [...(rawGroups.get(selectedCategoryLevel2) ?? [])].sort(
          compareRecords(sortKey),
        );
        const hasOverflow = categoryRecords.length > graphRevealLimit;
        const dotsToShow = hasOverflow ? categoryRecords.slice(0, graphRevealLimit) : categoryRecords;
        const dotColor =
          categoryColorMap.get(selectedCategoryLevel2) ?? palette[themeIndex % palette.length];

        items.push(
          ...dotsToShow.map<GraphItem>((record) => ({
            id: `record-${record.id}`,
            kind: "record",
            label: record.name,
            countLabel: record.kind === "file" ? record.확장자 || "FILE" : kindBadgeLabel(record),
            color: dotColor,
            radius: recordDotRadius,
            tooltip: recordTooltip(record),
            parentId: level2NodeId(selectedTheme, selectedCategoryLevel2),
            theme: selectedTheme,
            categoryLevel2: selectedCategoryLevel2,
            recordId: record.id,
          })),
        );

        if (hasOverflow) {
          items.push({
            id: `overflow-${level2NodeId(selectedTheme, selectedCategoryLevel2)}`,
            kind: "overflow",
            label: "더보기",
            countLabel: `+${formatNumber(categoryRecords.length - graphRevealLimit)}`,
            color: dotColor,
            radius: recordDotRadius + 7,
            tooltip: `${selectedCategoryLevel2}\n더보기를 누르면 10개씩 추가 표시됩니다.\n오른쪽 데이터 상세보기 목록에서도 전체를 검색할 수 있습니다.`,
            parentId: level2NodeId(selectedTheme, selectedCategoryLevel2),
            theme: selectedTheme,
            categoryLevel2: selectedCategoryLevel2,
          });
        }
      }
    }

    return {
      center,
      items,
    };
  }, [
    allNodesExpanded,
    baseRecords,
    query,
    selectedTheme,
    selectedCategoryLevel2,
    sortKey,
    graphRevealLimit,
    level1KiTaSet,
    themeStats,
    themeOrder,
    visibleTotals.apis,
    visibleTotals.files,
    visibleTotals.hybrids,
    visibleTotals.total,
  ]);

  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of graphData.items) {
      if (item.kind === "level1" && item.theme) {
        map.set(item.theme, item.color);
      }
      if (item.kind === "level2" && item.categoryLevel2) {
        map.set(item.categoryLevel2, item.color);
      }
    }
    return map;
  }, [graphData.items]);
  const selectedGraphNodeId = allNodesExpanded
    ? ""
    : selectedId
    ? `record-${selectedId}`
    : selectedCategoryLevel2 && selectedTheme
      ? level2NodeId(selectedTheme, selectedCategoryLevel2)
      : selectedTheme
        ? level1NodeId(selectedTheme)
        : "";

  const registerGraphControls = useCallback((controls: GraphControls | null) => {
    graphControls.current = controls;
  }, []);

  const toggleAllNodes = useCallback(() => {
    const nextExpanded = !allNodesExpanded;
    setAllNodesExpanded(nextExpanded);
    setSelectedTheme("");
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDatasetPage(0);
    setGraphRevealLimit(nextExpanded ? 5000 : 50);
    setDetailsOpen(false);
    window.setTimeout(() => graphControls.current?.fitAll(), 0);
  }, [allNodesExpanded]);

  const chooseTheme = useCallback((theme: string) => {
    setAllNodesExpanded(false);
    setSelectedTheme(theme);
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
    setDetailsOpen(true);
  }, []);

  const chooseCategoryLevel2 = useCallback((theme: string, category: string) => {
    setAllNodesExpanded(false);
    setSelectedTheme(theme);
    setSelectedCategoryLevel2(category);
    setSelectedId("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
    setDetailsOpen(true);
  }, []);

  const chooseRecord = useCallback((record: DatasetRecord) => {
    setAllNodesExpanded(false);
    const theme = level1Label(record);
    setSelectedTheme(level1KiTaSet.has(theme) ? "기타" : theme);
    setSelectedCategoryLevel2(level1KiTaSet.has(theme) ? theme : level2Label(record));
    setSelectedId(record.id);
    setGraphRevealLimit(50);
    setDetailsOpen(true);
  }, [level1KiTaSet]);

  const handleGraphNodeClick = useCallback(
    (item: GraphItem) => {
      if (item.isEmpty) return;

      if (item.kind === "level1" && item.theme) {
        chooseTheme(item.theme);
        return;
      }

      if (item.kind === "level2" && item.theme && item.categoryLevel2) {
        chooseCategoryLevel2(item.theme, item.categoryLevel2);
        return;
      }

      if (item.kind === "overflow") {
        setGraphRevealLimit((limit) => limit + 10);
        setDetailsOpen(true);
        return;
      }

      if (item.kind === "record" && item.recordId) {
        const record = datasets.find((candidate) => candidate.id === item.recordId);
        if (record) chooseRecord(record);
      }
    },
    [chooseCategoryLevel2, chooseRecord, chooseTheme, datasets],
  );

  function applyTerm(term: string) {
    const nextRecords = datasets.filter(
      (record) => {
        const kindMatch = matchesKindFilter(record, activeKind);
        const orgMatch = selectedOrgs.length === 0 || selectedOrgs.includes(record.제공기관);
        return kindMatch && orgMatch && matchesDataMapSearch(record, term);
      },
    );
    const nextTheme =
      themeOrder.find((theme) => nextRecords.some((record) => level1Label(record) === theme)) ??
      "";

    setQuery(term);
    setAllNodesExpanded(false);
    setSelectedTheme(nextTheme);
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDetailQuery("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
    setDetailsOpen(true);
  }

  function focusCurrentSearch() {
    const nextTheme =
      themeOrder.find((theme) => baseRecords.some((record) => level1Label(record) === theme)) ??
      "";

    setAllNodesExpanded(false);
    setSelectedTheme(nextTheme);
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDetailQuery("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
    setDetailsOpen(Boolean(nextTheme));
  }

  function chooseKind(kind: KindFilter) {
    setActiveKind(kind);
    setAllNodesExpanded(false);
    setSelectedTheme("");
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDetailQuery("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
  }

  function resetOrgScopedSelection() {
    setAllNodesExpanded(false);
    setSelectedTheme("");
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDetailQuery("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
    setDetailsOpen(false);
  }

  function clearOrgSelection() {
    setSelectedOrgs([]);
    setOrgMenuOpen(false);
    resetOrgScopedSelection();
  }

  function toggleOrg(org: string) {
    setSelectedOrgs((current) =>
      current.includes(org) ? current.filter((item) => item !== org) : [...current, org],
    );
    resetOrgScopedSelection();
  }

  function resetSearchConditions() {
    setQuery("");
    setActiveKind("all");
    setSelectedOrgs([]);
    setOrgMenuOpen(false);
    setAllNodesExpanded(false);
    setSelectedTheme("");
    setSelectedCategoryLevel2("");
    setSelectedId("");
    setDetailQuery("");
    setDatasetPage(0);
    setGraphRevealLimit(50);
    setDetailsOpen(false);
    keywordPagerRef.current?.scrollTo({ left: 0, behavior: "smooth" });
    window.setTimeout(() => graphControls.current?.reset(), 0);
  }

  function moveKeywordPage(direction: number) {
    const element = keywordPagerRef.current;
    if (!element || isKeywordDragging) return;

    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    if (maxScrollLeft <= 0) return;

    const step = Math.max(element.clientWidth * 0.78, 220);
    element.scrollTo({
      left: Math.min(Math.max(element.scrollLeft + step * direction, 0), maxScrollLeft),
      behavior: "smooth",
    });
  }

  function suppressNextKeywordClick() {
    suppressKeywordClickRef.current = true;
    window.setTimeout(() => {
      suppressKeywordClickRef.current = false;
    }, 90);
  }

  function startKeywordDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) return;

    keywordDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: element.scrollLeft,
      hasMoved: false,
    };
  }

  function moveKeywordDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = keywordDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 5 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (!drag.hasMoved) {
        drag.hasMoved = true;
        setIsKeywordDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
    }
  }

  function finishKeywordDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = keywordDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    keywordDragRef.current = null;
    setIsKeywordDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.hasMoved) suppressNextKeywordClick();
  }

  function cancelKeywordDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = keywordDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    keywordDragRef.current = null;
    setIsKeywordDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.hasMoved) suppressNextKeywordClick();
  }

  function handleKeywordClick(keyword: string) {
    if (suppressKeywordClickRef.current) return;
    applyTerm(keyword);
  }

  function moveDetailResult(direction: number) {
    if (!detailRecords.length) return;

    const currentIndex = selectedRecordIndex >= 0 ? selectedRecordIndex : 0;
    const nextIndex = (currentIndex + direction + detailRecords.length) % detailRecords.length;
    chooseRecord(detailRecords[nextIndex]);
  }

  function moveDatasetPage(page: number) {
    setDatasetPage(Math.min(Math.max(page, 0), datasetPageCount - 1));
  }

  function pickGuideKind(): KindFilter {
    return guideFixedKind;
  }

  function pickGuideOrg(kind: KindFilter) {
    if (guideOrgRef.current) return guideOrgRef.current;

    const candidates = orgOptions.filter((org) =>
      datasets.some((record) => record.제공기관 === org && matchesKindFilter(record, kind)),
    );
    const nextOrg =
      candidates.find((org) => org === guideFixedOrg) ??
      candidates.find((org) => org.includes(guideFixedOrg)) ??
      candidates[0] ??
      orgOptions[0] ??
      "";
    guideOrgRef.current = nextOrg;
    return nextOrg;
  }

  function pickGuideRecords() {
    return datasets.filter((record) => {
      const orgMatch = !guideOrgRef.current || record.제공기관 === guideOrgRef.current;
      return matchesKindFilter(record, activeKind) && orgMatch;
    });
  }

  function pickGuideTerm(records: DatasetRecord[], avoidTerm = "") {
    const normalizedAvoid = cleanText(avoidTerm);
    const candidates: string[] = [];

    for (const record of records.length ? records : datasets) {
      candidates.push(...record.키워드);
      candidates.push(...record.name.split(/[\s_,./-]+/));
    }

    const cleanedCandidates = candidates.map((item) => item.trim()).filter((item) => item.length >= 2);
    const differentCandidates = cleanedCandidates.filter((item) => {
      if (!normalizedAvoid) return true;
      return item !== normalizedAvoid && !normalizedAvoid.includes(item) && !item.includes(normalizedAvoid);
    });

    return (
      differentCandidates.find((item) => item.length >= 4) ??
      differentCandidates[0] ??
      cleanedCandidates.find((item) => item.length >= 4) ??
      cleanedCandidates[0] ??
      ""
    );
  }

  function applyGuideRecordScope(record: DatasetRecord) {
    const theme = level1Label(record);
    const guideTheme = level1KiTaSet.has(theme) ? "기타" : theme;
    const guideCategory = level1KiTaSet.has(theme) ? theme : level2Label(record);

    setSelectedTheme(guideTheme);
    setSelectedCategoryLevel2(guideCategory);
    setSelectedId("");
    setDatasetPage(0);
    setGraphRevealLimit(5000);
    setDetailsOpen(true);
  }

  function pickGuideKeyword() {
    guideKeywordRef.current = guideKeywordTerm;
    return guideKeywordRef.current;
  }

  useEffect(() => {
    if (!guideOpen || !datasets.length) return;
    return;

    const step = guideSteps[guideStepIndex] ?? guideSteps[0];
    const runKey = `${guideStepIndex}:${step.id}:${datasets.length}`;
    if (guideAppliedStepRef.current === runKey) return;
    guideAppliedStepRef.current = runKey;

    const timers: number[] = [];
    const clearScopedSelection = () => {
      setSelectedTheme("");
      setSelectedCategoryLevel2("");
      setSelectedId("");
      setDetailQuery("");
      setDatasetPage(0);
      setGraphRevealLimit(50);
      setDetailsOpen(true);
    };
    const typeInto = (setValue: (value: string) => void, term: string, afterTyping?: () => void) => {
      setValue("");
      const letters = [...term];
      letters.forEach((_, index) => {
        timers.push(window.setTimeout(() => {
          setValue(letters.slice(0, index + 1).join(""));
        }, 95 * (index + 1)));
      });
      timers.push(window.setTimeout(() => {
        afterTyping?.();
      }, 95 * letters.length + 260));
    };
    const scrollGuideOrgChoice = () => {
      document.querySelector(".org-filter-option.guide-org-choice")?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    };

    switch (step.id) {
      case "kind": {
        const kind = pickGuideKind();
        setOrgMenuOpen(false);
        setQuery("");
        chooseKind("all");
        setDetailsOpen(true);
        timers.push(window.setTimeout(() => chooseKind(kind), 850));
        break;
      }
      case "org": {
        const org = pickGuideOrg(activeKind);
        if (org) {
          setQuery("");
          setSelectedOrgs([]);
          setOrgMenuOpen(true);
          clearScopedSelection();
          timers.push(window.setTimeout(() => setSelectedOrgs([org]), 650));
          timers.push(window.setTimeout(scrollGuideOrgChoice, 760));
          timers.push(window.setTimeout(scrollGuideOrgChoice, 1180));
        }
        break;
      }
      case "mapSearch": {
        setOrgMenuOpen(false);
        const term = guideMapSearchTerm;
        guideMapTermRef.current = term;
        typeInto(setQuery, term, () => {
          setQuery(term);
          setSelectedTheme("");
          setSelectedCategoryLevel2("");
          setSelectedId("");
          setDetailQuery("");
          setDatasetPage(0);
          setGraphRevealLimit(50);
          setDetailsOpen(true);
        });
        break;
      }
      case "detailSearch": {
        setOrgMenuOpen(false);
        const sourceRecords = detailRecords.length ? detailRecords : selectedRecords.length ? selectedRecords : datasets;
        const guideRecord = sourceRecords.find((record) => record.키워드.length > 0) ?? sourceRecords[0];
        if (guideRecord) applyGuideRecordScope(guideRecord);
        const term = guideDetailSearchTerm;
        typeInto(setDetailQuery, term);
        setDatasetPage(0);
        setDetailsOpen(true);
        break;
      }
      case "keyword": {
        setOrgMenuOpen(false);
        setDetailQuery("");
        const keyword = pickGuideKeyword();
        if (keyword) handleKeywordClick(keyword);
        break;
      }
      case "controls": {
        setOrgMenuOpen(false);
        setDetailsOpen(true);
        break;
      }
      case "level1Node": {
        setOrgMenuOpen(false);
        setSelectedId("");
        const item = graphData.items.find((candidate) => candidate.kind === "level1" && !candidate.isEmpty);
        if (item) handleGraphNodeClick(item as GraphItem);
        break;
      }
      case "level2Node": {
        setOrgMenuOpen(false);
        const item = graphData.items.find((candidate) => candidate.kind === "level2" && !candidate.isEmpty);
        if (item) {
          handleGraphNodeClick(item as GraphItem);
          setGraphRevealLimit(5000);
        } else {
          const record = selectedRecords[0] ?? baseRecords[0] ?? datasets[0];
          if (record) applyGuideRecordScope(record);
        }
        break;
      }
      case "dataList": {
        setOrgMenuOpen(false);
        setSelectedId("");
        setDetailsOpen(true);
        setDatasetPage(0);
        const record = visibleDetailRecords[0] ?? detailRecords[0] ?? selectedRecords[0] ?? datasets[0];
        if (record) {
          timers.push(window.setTimeout(() => chooseRecord(record), 1500));
        }
        break;
      }
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [guideOpen, guideStepIndex, datasets.length]);

  const isRecordDetail = Boolean(activeSelectedId && selectedRecord);
  const selectedRecordRows = isRecordDetail && selectedRecord ? recordInfoRows(selectedRecord) : [];
  const selectedPortalUrl = selectedRecord ? dataGoKrUrl(selectedRecord) : "";
  const isCatalogLoading = datasets.length === 0 && !catalogError;
  const currentScopeSummary = useMemo(() => summarizeRecords(detailRecords), [detailRecords]);
  const orgSelectionLabel =
    selectedOrgs.length === 0
      ? "전체 기관"
      : selectedOrgs.length === 1
        ? selectedOrgs[0]
        : `${selectedOrgs[0]} 외 ${formatNumber(selectedOrgs.length - 1)}`;

  return (
    <main className="datamap-page">
      <header className="map-header">
        <button className="brand-area" type="button" onClick={resetSearchConditions} aria-label="홈으로 이동">
          <span className="brand-mark" aria-hidden="true">
            <img src="/favicon.svg" alt="" />
          </span>
          <div>
            <h2>과학기술정보통신부 데이터맵</h2>
          </div>
        </button>

        <section className="search-panel" aria-label="데이터 검색">
          <div className="search-row">
            <label className="condition-select">
              <span>데이터유형</span>
              <select
                value={activeKind}
                onChange={(event) => chooseKind(event.target.value as KindFilter)}
              >
                <option value="all">전체 유형</option>
                <option value="api">API</option>
                <option value="file">파일데이터</option>
                <option value="hybrid">API/파일데이터</option>
              </select>
            </label>
            <div className="org-filter" ref={orgFilterRef}>
              <button
                aria-expanded={orgMenuOpen}
                aria-haspopup="listbox"
                className="org-filter-trigger"
                type="button"
                onClick={() => setOrgMenuOpen((open) => !open)}
                title={orgSelectionLabel}
              >
                <span>{orgSelectionLabel}</span>
                <Icon name={orgMenuOpen ? "chevronUp" : "chevronDown"} size={16} />
              </button>
              {orgMenuOpen ? (
                <div className="org-filter-menu" role="listbox" aria-label="기관 선택">
                  <label className="org-filter-option">
                    <input
                      type="checkbox"
                      checked={selectedOrgs.length === 0}
                      onChange={clearOrgSelection}
                    />
                    <span>전체 기관</span>
                  </label>
                  {orgOptions.map((org) => (
                    <label
                      className={`org-filter-option${guideOpen && guideSteps[guideStepIndex]?.id === "org" && selectedOrgs.includes(org)
                          ? " guide-org-choice"
                          : ""
                        }`}
                      key={org}
                    >
                      <input
                        type="checkbox"
                        checked={selectedOrgs.includes(org)}
                        onChange={() => toggleOrg(org)}
                      />
                      <span title={org}>{org}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="global-search-group">
              <label className="global-search">
                <span>결과 검색</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setDatasetPage(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") focusCurrentSearch();
                  }}
                  placeholder="데이터맵 검색"
                />
              </label>
              <button className="search-submit" type="button" onClick={focusCurrentSearch} aria-label="검색">
                <Icon name="search" size={18} />
              </button>
            </div>
            <label className="result-search">
              <span>결과 내 검색</span>
              <input
                value={detailQuery}
                onChange={(event) => {
                  setDetailQuery(event.target.value);
                  setDatasetPage(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && detailRecords[0]) {
                    chooseRecord(detailRecords[0]);
                  }
                }}
                placeholder="결과 내 검색"
              />
              <span className="result-count">{detailResultLabel}</span>
              <button type="button" onClick={() => moveDetailResult(-1)} aria-label="이전 결과">
                <Icon name="chevronUp" size={16} />
              </button>
              <button type="button" onClick={() => moveDetailResult(1)} aria-label="다음 결과">
                <Icon name="chevronDown" size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDetailQuery("");
                  setDatasetPage(0);
                }}
                aria-label="결과 내 검색 지우기"
              >
                <Icon name="x" size={15} />
              </button>
            </label>
            <div className="keyword-row" aria-label="추천 키워드">
              <button type="button" onClick={() => moveKeywordPage(-1)} aria-label="이전 키워드">
                <Icon name="chevronLeft" size={15} />
              </button>
              <div
                className={`keyword-pager${isKeywordDragging ? " dragging" : ""}`}
                ref={keywordPagerRef}
                onClickCapture={(event) => {
                  if (!suppressKeywordClickRef.current) return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerCancel={cancelKeywordDrag}
                onPointerDown={startKeywordDrag}
                onPointerMove={moveKeywordDrag}
                onPointerUp={finishKeywordDrag}
              >
                {keywordOptions.map((keyword) => (
                  <button
                    className={query === keyword ? "active" : ""}
                    key={keyword}
                    type="button"
                    onClick={() => handleKeywordClick(keyword)}
                  >
                    {keyword}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => moveKeywordPage(1)} aria-label="다음 키워드">
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </div>
        </section>
      </header>

      <section className="map-workspace">
        <section className="network-shell" aria-label="공공데이터 네트워크 맵">
          <div className="network-toolbar">
            <button
              className="canvas-help-button"
              type="button"
              onClick={() => setGuideOpen(true)}
              title="데이터맵 온라인 가이드 열기"
              aria-label="데이터맵 온라인 가이드 열기"
            >
              <Icon name="help" size={17} />
            </button>
          </div>
          {isCatalogLoading ? <div className="canvas-status">데이터를 불러오는 중입니다.</div> : null}
          {catalogError ? <div className="canvas-status error">{catalogError}</div> : null}
          <NetworkGraph
            center={graphData.center}
            items={graphData.items}
            labelHighlightTerm={query}
            onNodeClick={handleGraphNodeClick}
            registerControls={registerGraphControls}
            selectedNodeId={selectedGraphNodeId}
          />
          <div className="canvas-map-controls" aria-label="지도 확대 축소">
            <button
              className={`fit-view-button${allNodesExpanded ? " expanded" : ""}`}
              type="button"
              onClick={toggleAllNodes}
              title={allNodesExpanded ? "기본 노드만 보기" : "전체 노드 펼치기"}
              aria-label={allNodesExpanded ? "기본 노드만 보기" : "전체 노드 펼치기"}
              aria-pressed={allNodesExpanded}
            >
              <Icon name={allNodesExpanded ? "collapseView" : "fitView"} size={18} />
            </button>
            <button type="button" onClick={() => graphControls.current?.zoomIn()} aria-label="확대">
              <Icon name="plus" size={18} />
            </button>
            <button type="button" onClick={() => graphControls.current?.zoomOut()} aria-label="축소">
              <Icon name="minus" size={18} />
            </button>
            <button type="button" onClick={resetSearchConditions} aria-label="검색 조건 초기화">
              <Icon name="rotateCcw" size={17} />
            </button>
          </div>
        </section>

        <aside className={`detail-panel ${detailsOpen ? "" : "collapsed"} ${isRecordDetail ? "record-mode" : "list-mode"}`}>
          <div className="panel-title">
            <strong>{isRecordDetail && selectedRecord ? selectedRecord.name : "데이터 목록"}</strong>
            <div className="panel-actions">
              {isRecordDetail ? (
                <button type="button" onClick={() => setSelectedId("")} aria-label="데이터 목록으로 돌아가기">
                  <Icon name="chevronLeft" size={17} />
                </button>
              ) : null}
              <button type="button" onClick={() => setDetailsOpen(false)} aria-label="상세 닫기">
                <Icon name="x" size={17} />
              </button>
            </div>
          </div>

          <div className="detail-content" style={{ "--node-color": selectedColor } as CSSProperties}>
            {isRecordDetail && selectedRecord ? (
              <section className="record-table-view">
                <table className="record-info-table">
                  <tbody>
                    {selectedRecordRows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        <td>{highlightSearchTerm(row.value, detailQuery)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedPortalUrl ? (
                  <a className="data-portal-link" href={selectedPortalUrl} target="_blank" rel="noreferrer">
                    공공데이터 바로가기
                  </a>
                ) : null}
              </section>
            ) : (
              <section className="dataset-list-section">
                {detailRecords.length ? (
                  <>
                    <div className="dataset-list-summary">
                      <span>데이터 {formatNumber(currentScopeSummary.count)}</span>
                      <span>파일 {formatNumber(currentScopeSummary.files)}</span>
                      <span>API {formatNumber(currentScopeSummary.apis)}</span>
                      <span>API/파일 {formatNumber(currentScopeSummary.hybrids)}</span>
                    </div>
                    <ol className="dataset-list">
                      {visibleDetailRecords.map((record, index) => (
                        <li key={record.id}>
                          <button type="button" onClick={() => chooseRecord(record)}>
                            <span className="dataset-index">
                              {formatNumber(currentDatasetPage * datasetPageSize + index + 1)}
                            </span>
                            <span
                              className="dataset-dot"
                              style={
                                {
                                  "--item-color":
                                    nodeColorMap.get(selectedCategoryLevel2) ??
                                    nodeColorMap.get(level1Label(record)) ??
                                    kindColor(record),
                                } as CSSProperties
                              }
                              aria-hidden="true"
                            />
                            <span className="dataset-name">
                              {highlightSearchTerm(record.name, detailQuery)}
                            </span>
                            <span className={`dataset-kind-badge ${record.kind}`}>
                              {kindBadgeLabel(record)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                    <nav className="dataset-pagination" aria-label="데이터 목록 페이지">
                      <button
                        type="button"
                        onClick={() => moveDatasetPage(0)}
                        disabled={currentDatasetPage === 0}
                        aria-label="첫 페이지"
                      >
                        <Icon name="chevronsLeft" size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDatasetPage(currentDatasetPage - 1)}
                        disabled={currentDatasetPage === 0}
                        aria-label="이전 페이지"
                      >
                        <Icon name="chevronLeft" size={15} />
                      </button>
                      {visibleDatasetPages.map((page) => (
                        <button
                          className={page === currentDatasetPage ? "active" : ""}
                          key={page}
                          type="button"
                          onClick={() => moveDatasetPage(page)}
                          aria-label={`${formatNumber(page + 1)} 페이지`}
                        >
                          {formatNumber(page + 1)}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => moveDatasetPage(currentDatasetPage + 1)}
                        disabled={currentDatasetPage >= datasetPageCount - 1}
                        aria-label="다음 페이지"
                      >
                        <Icon name="chevronRight" size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDatasetPage(datasetPageCount - 1)}
                        disabled={currentDatasetPage >= datasetPageCount - 1}
                        aria-label="마지막 페이지"
                      >
                        <Icon name="chevronsRight" size={15} />
                      </button>
                    </nav>
                  </>
                ) : (
                  <div className="empty-state">조건에 맞는 데이터가 없습니다.</div>
                )}
              </section>
            )}
          </div>
        </aside>
      </section>

      <footer className="map-footer">
        <span>
          과학기술정보통신부 · {crawledAt ? new Date(crawledAt).toLocaleDateString("ko-KR") : "-"} 기준
        </span>
        <span>
          현재 표시 {formatNumber(visibleTotals.total)}건 · 파일{" "}
          {formatNumber(visibleTotals.files)} · API {formatNumber(visibleTotals.apis)} · API/파일{" "}
          {formatNumber(visibleTotals.hybrids)}
        </span>
      </footer>
      <GuideTour
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onStepChange={setGuideStepIndex}
        stepIndex={guideStepIndex}
        steps={guideSteps}
        crawledAt={crawledAt}
        datasets={datasets}
      />
    </main>
  );
}
