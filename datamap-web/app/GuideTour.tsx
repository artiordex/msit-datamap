import * as d3 from "d3";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  type KindFilter,
  type DatasetRecord,
  type GraphItem,
  type SortKey,
  type ThemeStat,
  branchNodeRadius,
  centerNodeColor,
  level1NodeId,
  level2NodeId,
  level2NodeRadius,
  palette,
  recordDotRadius,
  compareRecords,
  formatNumber,
  highlightSearchTerm,
  kindBadgeLabel,
  kindColor,
  level1Label,
  level2Label,
  matchesDataMapSearch,
  matchesDetailSearch,
  matchesKindFilter,
  recordInfoRows,
  recordTooltip,
  summarizeCatalog,
  summarizeRecords,
  summaryTooltip,
  topKeywordsFromPopularRecords,
  Icon,
  NetworkGraph,
} from "./DataMapClient";

export type GuideTargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type GuideKindSelectPhase = "idle" | "pressed" | "open" | "selected";

export type GuideStep = {
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

export const guideFixedKind: KindFilter = "hybrid";
export const guideFixedOrg = "과학기술정보통신부";
export const guideMapSearchTerm = "기술";
export const guideDetailSearchTerm = "데이터";
export const guideKeywordTerm = "과학기술연구";
export const guideFanRecordLabels = [
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

export const guideSteps: GuideStep[] = [
  {
    id: "level1Node",
    badge: "1",
    label: "분류 기준",
    title: "데이터맵 구성 보기",
    body: [
      "중앙의 데이터현황은 현재 조건에 맞는 전체 데이터 수를 보여줍니다.",
      "주변의 큰 원은 과학기술·통신·교육처럼 데이터가 속한 1차 분류입니다.",
      "1차 분류를 선택하면 그 안의 세부 분류와 연결 데이터까지 이어서 살펴볼 수 있습니다.",
    ],
    targetSelectors: [
      ".guide-preview-map .d3-node.center, .guide-preview-map .d3-node.level1:not(.empty), .guide-preview-map .d3-node.level2:not(.empty)",
      ".guide-preview-map .network-shell",
    ],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
  {
    id: "kind",
    badge: "2",
    label: "유형",
    title: "데이터 유형 선택",
    body: [
      "전체 유형 목록에서 원하는 제공 방식을 고를 수 있습니다.",
      "API/파일데이터를 선택하면 파일과 API가 함께 제공되는 데이터만 남습니다.",
      "유형을 바꾸면 중앙 데이터 수와 오른쪽 목록이 같은 조건으로 갱신됩니다.",
    ],
    targetSelectors: [".condition-select select"],
    clickPoint: { x: 0.68, y: 0.5 },
    panelSide: "right",
  },
  {
    id: "org",
    badge: "3",
    label: "기관",
    title: "기관별 데이터 보기",
    body: [
      "기관 목록에서 원하는 제공기관을 선택할 수 있습니다.",
      "과학기술정보통신부를 선택하면 해당 기관 데이터만 데이터맵에 표시됩니다.",
      "기관 조건은 검색, 키워드, 목록에도 함께 적용됩니다.",
    ],
    targetSelectors: [".org-filter-option.guide-org-choice", ".org-filter-menu", ".org-filter-trigger"],
    clickPoint: { x: 0.55, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "mapSearch",
    badge: "4",
    label: "검색",
    title: "검색어로 데이터 찾기",
    body: [
      "데이터맵 검색창에 찾고 싶은 단어를 입력합니다.",
      "검색어가 포함된 데이터가 있는 분류 노드가 활성화됩니다.",
      "오른쪽 목록에서도 같은 검색 결과를 바로 확인할 수 있습니다.",
    ],
    targetSelectors: [".global-search-group"],
    clickPoint: { x: 0.44, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "detailSearch",
    badge: "5",
    label: "내검색",
    title: "현재 결과 안에서 다시 찾기",
    body: [
      "결과 내 검색은 현재 표시된 목록 안에서 한 번 더 찾는 기능입니다.",
      "데이터명이나 키워드 일부를 입력하면 목록 안의 해당 항목으로 이동합니다.",
      "검색 결과가 많을 때 원하는 데이터를 빠르게 좁혀볼 수 있습니다.",
    ],
    targetSelectors: [".result-search input", ".result-search"],
    clickPoint: { x: 0.32, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "keyword",
    badge: "6",
    label: "키워드",
    title: "추천 키워드 활용",
    body: [
      "상단에는 자주 활용되는 추천 키워드가 표시됩니다.",
      "과학기술연구를 선택하면 해당 키워드가 검색 조건으로 적용됩니다.",
      "관련 데이터가 있는 노드와 목록이 함께 갱신됩니다.",
    ],
    targetSelectors: [".keyword-pager button.active", ".keyword-row"],
    clickPoint: { x: 0.55, y: 0.5 },
    panelSide: "bottom",
  },
  {
    id: "controls",
    badge: "7",
    label: "조작",
    title: "화면 조작 버튼",
    body: [
      "왼쪽 버튼으로 데이터맵 화면을 보기 좋게 조정할 수 있습니다.",
      "전체 노드 펼치기, 확대, 축소, 초기화 기능을 순서대로 확인합니다.",
      "전체 노드 버튼은 다시 누르면 기본 분류 화면으로 돌아갑니다.",
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
    id: "level2Node",
    badge: "8",
    label: "2차노드",
    title: "분류 노드와 데이터명 확인",
    body: [
      "과학기술 아래의 과학기술진흥 분류를 선택해 세부 데이터를 확인합니다.",
      "선택한 분류와 연결된 데이터명이 4차 노드로 펼쳐집니다.",
      "데이터명을 선택하면 오른쪽 목록과 상세 정보로 이어집니다.",
    ],
    targetSelectors: [".guide-preview-map .d3-node.level2.active", ".guide-preview-map .d3-node.level2"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
    substeps: [
      {
        label: "과학기술진흥",
        targetSelectors: [".guide-preview-map .d3-node.level2.active", ".guide-preview-map .d3-node.level2"],
        clickPoint: { x: 0.5, y: 0.5 },
      },
      {
        label: "데이터명",
        targetSelectors: [
          ".guide-preview-map .d3-node.level2.active, .guide-preview-map .d3-node.record circle:not(.d3-record-hit)",
          ".guide-preview-map .d3-node.level2.active",
        ],
        clickPoint: { x: 0.5, y: 0.5 },
      },
    ],
  },
  {
    id: "dataList",
    badge: "9",
    label: "목록",
    title: "데이터 목록에서 항목 선택",
    body: [
      "오른쪽 목록에는 현재 조건에 맞는 데이터가 순서대로 표시됩니다.",
      "각 항목에는 파일, API, API/파일 유형 배지가 함께 표시됩니다.",
      "목록에서 항목을 선택하면 해당 데이터의 상세 정보가 열립니다.",
    ],
    targetSelectors: [".guide-list-click-target", ".dataset-list button", ".dataset-list-section", ".detail-panel"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
  {
    id: "portalLink",
    badge: "10",
    label: "바로가기",
    title: "공공데이터포털로 이동",
    body: [
      "상세 정보 하단에서 공공데이터포털 바로가기 버튼을 확인할 수 있습니다.",
      "원문 페이지에서 다운로드, 활용신청, 제공기관 정보를 이어서 확인합니다.",
      "가이드에서는 이동 위치만 안내하고 현재 화면은 유지됩니다.",
    ],
    targetSelectors: [".data-portal-link", ".record-table-view", ".detail-panel"],
    clickPoint: { x: 0.5, y: 0.5 },
    panelSide: "left",
  },
];

export const emptyGuideRect: GuideTargetRect = {
  left: 24,
  top: 120,
  width: 360,
  height: 220,
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundedGuideRect(rect: GuideTargetRect): GuideTargetRect {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function guideVisibleRect(element: Element): GuideTargetRect | null {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function unionGuideRects(rects: GuideTargetRect[]): GuideTargetRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function findGuideTarget(selectors: string[], root?: HTMLElement | null): GuideTargetRect {
  for (const selector of selectors) {
    const rootMatches = root ? Array.from(root.querySelectorAll<Element>(selector)) : [];
    const matches = rootMatches.length > 0 ? rootMatches : Array.from(document.querySelectorAll<Element>(selector));
    const rects: GuideTargetRect[] = [];

    for (const element of matches) {
      const rect = guideVisibleRect(element);
      if (rect) rects.push(rect);
    }

    if (rects.length > 0) {
      const union = roundedGuideRect(unionGuideRects(rects));
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        left: clampNumber(union.left, 4, Math.max(4, vw - 24)),
        top: clampNumber(union.top, 4, Math.max(4, vh - 24)),
        width: Math.min(union.width, vw - 8),
        height: Math.min(union.height, vh - 8),
      };
    }
  }

  const fallback = root?.querySelector<HTMLElement>(".network-shell") ?? document.querySelector<HTMLElement>(".network-shell");
  if (!fallback) return emptyGuideRect;

  const rect = fallback.getBoundingClientRect();
  return roundedGuideRect({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

type GuidePoint = {
  x: number;
  y: number;
};

function parseSvgTranslate(transform: string) {
  const match = /translate\(\s*([-0-9.]+)(?:[,\s]+([-0-9.]+))?\s*\)/.exec(transform);
  return {
    x: Number(match?.[1] ?? 0),
    y: Number(match?.[2] ?? 0),
  };
}

function parseSvgScale(transform: string) {
  const match = /scale\(\s*([-0-9.]+)\s*\)/.exec(transform);
  return Number(match?.[1] ?? 1);
}

function parseSvgRotate(transform: string) {
  const match = /rotate\(\s*([-0-9.]+)\s*\)/.exec(transform);
  return (Number(match?.[1] ?? 0) * Math.PI) / 180;
}

function guideBoxCorners(box: DOMRect): GuidePoint[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

function rotateGuidePoint(point: GuidePoint, angle: number): GuidePoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function guideOrientedRectPath(
  points: GuidePoint[],
  longPadding = 10,
  crossPadding = 8,
  minTop?: number,
) {
  if (points.length < 3) return "";

  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  const covariance = points.reduce(
    (sum, point) => {
      const x = point.x - center.x;
      const y = point.y - center.y;
      return {
        xx: sum.xx + x * x,
        xy: sum.xy + x * y,
        yy: sum.yy + y * y,
      };
    },
    { xx: 0, xy: 0, yy: 0 },
  );
  const angle = 0.5 * Math.atan2(2 * covariance.xy, covariance.xx - covariance.yy);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const cross = { x: -axis.y, y: axis.x };
  const projected = points.map((point) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
      axis: x * axis.x + y * axis.y,
      cross: x * cross.x + y * cross.y,
    };
  });
  const minAxis = Math.min(...projected.map((point) => point.axis)) - longPadding;
  const maxAxis = Math.max(...projected.map((point) => point.axis)) + longPadding;
  const minCross = Math.min(...projected.map((point) => point.cross)) - crossPadding;
  const maxCross = Math.max(...projected.map((point) => point.cross)) + crossPadding;
  const corner = (axisValue: number, crossValue: number): GuidePoint => ({
    x: center.x + axis.x * axisValue + cross.x * crossValue,
    y: center.y + axis.y * axisValue + cross.y * crossValue,
  });
  const corners = [
    corner(minAxis, minCross),
    corner(maxAxis, minCross),
    corner(maxAxis, maxCross),
    corner(minAxis, maxCross),
  ];
  if (typeof minTop === "number") {
    const top = Math.min(...corners.map((point) => point.y));
    if (top < minTop) {
      const shiftY = minTop - top;
      corners.forEach((point) => {
        point.y += shiftY;
      });
    }
  }

  return `M ${corners.map((point) => `${Math.round(point.x)} ${Math.round(point.y)}`).join(" L ")} Z`;
}

function findGuideRecordFocusPath(root?: HTMLElement | null) {
  if (!root) return "";

  const rootBounds = root.getBoundingClientRect();

  const points: GuidePoint[] = [];
  const addSvgElementBox = (element: SVGGraphicsElement) => {
    const svg = element.ownerSVGElement;
    const matrix = element.getScreenCTM();
    if (!svg || !matrix) return;

    const box = element.getBBox();
    if (box.width <= 0 || box.height <= 0) return;

    const elementPoints = guideBoxCorners(box).map((corner) => {
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = corner.x;
      svgPoint.y = corner.y;
      const screenPoint = svgPoint.matrixTransform(matrix);
      return { x: screenPoint.x, y: screenPoint.y };
    });
    const left = Math.min(...elementPoints.map((point) => point.x));
    const right = Math.max(...elementPoints.map((point) => point.x));
    const top = Math.min(...elementPoints.map((point) => point.y));
    const bottom = Math.max(...elementPoints.map((point) => point.y));
    const isVisible =
      right > rootBounds.left &&
      bottom > rootBounds.top &&
      left < rootBounds.right &&
      top < rootBounds.bottom;
    if (!isVisible) return;

    points.push(...elementPoints);
  };

  root
    .querySelectorAll<SVGTextElement>(".guide-preview-map .d3-node.record .d3-record-label")
    .forEach(addSvgElementBox);

  root
    ?.querySelectorAll<SVGCircleElement>(".guide-preview-map .d3-node.record circle:not(.d3-record-hit)")
    .forEach(addSvgElementBox);

  return guideOrientedRectPath(points, 8, 6);
}

export function guideStepIndexOf(id: GuideStep["id"]) {
  return guideSteps.findIndex((item) => item.id === id);
}

function GuideDataMapPreview({
  crawledAt,
  datasets,
  detailQuery,
  kindCommitted,
  mapQuery,
  subStepIndex,
  stepIndex,
}: {
  crawledAt: string;
  datasets: DatasetRecord[];
  detailQuery: string;
  kindCommitted: boolean;
  mapQuery: string;
  subStepIndex: number;
  stepIndex: number;
}) {
  const step = guideSteps[stepIndex] ?? guideSteps[0];
  const kindStepIndex = guideStepIndexOf("kind");
  const hasKind = stepIndex > kindStepIndex || (stepIndex === kindStepIndex && kindCommitted);
  const hasOrg = stepIndex >= guideStepIndexOf("org");
  const hasMapSearch = stepIndex >= guideStepIndexOf("mapSearch");
  const hasDetailSearch = stepIndex >= guideStepIndexOf("detailSearch");
  const hasKeyword = stepIndex >= guideStepIndexOf("keyword");
  const hasLevel1 = stepIndex >= guideStepIndexOf("level1Node");
  const hasLevel2 = stepIndex >= guideStepIndexOf("level2Node");
  const hasListClick = stepIndex >= guideStepIndexOf("dataList");
  const hasPortal = stepIndex >= guideStepIndexOf("portalLink");
  const isNodeCloseupGuide = step.id === "level2Node";
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
  const detailsOpen =
    !isNodeCloseupGuide && Boolean(selectedTheme || selectedCategoryLevel2 || previewDetailQuery || hasListClick || hasPortal);
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
  const selectedGraphNodeId = step.id === "level2Node" && subStepIndex >= 1 && selectedRecord
    ? `record-${selectedRecord.id}`
    : step.id === "portalLink" && selectedRecord
    ? `record-${selectedRecord.id}`
    : step.id === "level1Node" && selectedTheme
      ? level1NodeId(selectedTheme)
      : selectedCategoryLevel2 && selectedTheme && (hasDetailSearch || hasKeyword || hasLevel2 || hasListClick)
      ? level2NodeId(selectedTheme, selectedCategoryLevel2)
      : selectedTheme && (hasLevel1 || hasDetailSearch || hasKeyword)
      ? level1NodeId(selectedTheme)
      : "";
  const guideFocusNodeId =
    isNodeCloseupGuide && selectedTheme && selectedCategoryLevel2
      ? level2NodeId(selectedTheme, selectedCategoryLevel2)
      : undefined;
  const handlePreviewNodeClick = useCallback(() => undefined, []);
  const registerPreviewControls = useCallback(() => undefined, []);
  const orgOptions = useMemo(() => {
    const options = [...new Set(datasets.map((record) => record.제공기관).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko-KR"));
    return [guideFixedOrg, ...options.filter((org) => org !== guideFixedOrg)].slice(0, 9);
  }, [datasets]);

  return (
    <section
      className={`guide-preview-map${isNodeCloseupGuide ? " guide-node-closeup" : ""}`}
      aria-label="실제 데이터맵 축소 화면"
    >
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
              <div className="keyword-row-label">
                <Icon name="search" size={14} />
                <span>추천 검색어</span>
              </div>
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
          <NetworkGraph
            center={graphData.center}
            focusAnchor={isNodeCloseupGuide ? { x: 0.5, y: 0.86 } : undefined}
            focusNodeId={guideFocusNodeId}
            focusScale={isNodeCloseupGuide ? 0.72 : undefined}
            items={graphData.items}
            labelHighlightTerm={previewQuery}
            onNodeClick={handlePreviewNodeClick}
            registerControls={registerPreviewControls}
            selectedNodeId={selectedGraphNodeId}
            fitDurationMs={isNodeCloseupGuide ? 0 : undefined}
            recordAngleStepPx={hasKeyword ? 16 : 18}
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
  const [kindSelectPhase, setKindSelectPhase] = useState<GuideKindSelectPhase>("idle");
  const [kindSelectRect, setKindSelectRect] = useState<GuideTargetRect>(emptyGuideRect);
  const [nodeLabelFocusPath, setNodeLabelFocusPath] = useState("");
  const modalRef = useRef<HTMLDivElement | null>(null);
  const step = steps[stepIndex] ?? steps[0];
  const activeSubStep = step.substeps?.[subStepIndex % step.substeps.length];
  const kindStepIndex = guideStepIndexOf("kind");
  const isKindStep = step.id === "kind";
  const isKindOptionTarget = isKindStep && (kindSelectPhase === "open" || kindSelectPhase === "selected");
  const kindOptionTargetSelectors = useMemo(() => [".guide-select-option-hybrid"], []);
  const activeTargetSelectors = isKindOptionTarget
    ? kindOptionTargetSelectors
    : activeSubStep?.targetSelectors ?? step.targetSelectors;
  const activeClickPoint = isKindOptionTarget ? { x: 0.72, y: 0.5 } : activeSubStep?.clickPoint ?? step.clickPoint;
  const stepScript = step.body.join("\n");
  const hasKind = stepIndex > kindStepIndex || (isKindStep && kindSelectPhase === "selected");
  const hasOrg = stepIndex >= guideSteps.findIndex((item) => item.id === "org");
  const hasMapSearch = stepIndex >= guideSteps.findIndex((item) => item.id === "mapSearch");
  const hasDetailSearch = stepIndex >= guideSteps.findIndex((item) => item.id === "detailSearch");
  const hasKeyword = stepIndex >= guideSteps.findIndex((item) => item.id === "keyword");
  const hasLevel1 = stepIndex >= guideSteps.findIndex((item) => item.id === "level2Node");
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
  const demoDetailQuery = hasPortal ? guideDetailSearchTerm : hasDetailSearch ? demoDetailTypedText : "";
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
    if (!open) {
      setKindSelectPhase("idle");
      return;
    }

    if (step.id !== "kind") {
      setKindSelectPhase(stepIndex > kindStepIndex ? "selected" : "idle");
      return;
    }

    setKindSelectPhase("idle");
    const timers = [
      window.setTimeout(() => setKindSelectPhase("pressed"), 220),
      window.setTimeout(() => setKindSelectPhase("open"), 520),
      window.setTimeout(() => setKindSelectPhase("selected"), 920),
    ];

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [kindStepIndex, open, step.id, stepIndex]);

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
    }, 16);

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
    }, 70);

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
    }, 70);

    return () => window.clearInterval(timer);
  }, [open, step.id, stepIndex, steps]);

  useEffect(() => {
    if (!open || isPaused) return;

    const timer = window.setTimeout(() => {
      onStepChange(stepIndex + 1 >= steps.length ? stepIndex : stepIndex + 1);
    }, 5600);

    return () => window.clearTimeout(timer);
  }, [isPaused, onStepChange, open, stepIndex, steps.length]);

  useEffect(() => {
    if (!open || isPaused || !step.substeps?.length || subStepIndex >= step.substeps.length - 1) return;

    const timer = window.setInterval(() => {
      setSubStepIndex((current) => Math.min(current + 1, step.substeps!.length - 1));
    }, 1050);

    return () => window.clearInterval(timer);
  }, [isPaused, open, step.substeps, subStepIndex]);

  useEffect(() => {
    if (!open) return;

    const isStaticNodeFocusStep = step.id === "level1Node" || step.id === "level2Node";
    const isStableOverviewStep = step.id === "level1Node";
    const updateTargetRect = () => {
      if (isStaticNodeFocusStep) return;
      setTargetRect(findGuideTarget(activeTargetSelectors, modalRef.current));
    };

    updateTargetRect();
    if (isStableOverviewStep || isStaticNodeFocusStep) {
      const timers = [80, 180, 360, 720, 1100, 1500, 2200, 3000, 4000].map((delay) =>
        window.setTimeout(updateTargetRect, delay),
      );
      window.addEventListener("resize", updateTargetRect);

      return () => {
        timers.forEach((timer) => window.clearTimeout(timer));
        window.removeEventListener("resize", updateTargetRect);
      };
    }

    const interval = window.setInterval(updateTargetRect, 450);
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect, true);
    };
  }, [activeTargetSelectors, open, step.id, subStepIndex]);

  useEffect(() => {
    if (!open || step.id !== "kind") return;

    const updateSelectRect = () => {
      setKindSelectRect(findGuideTarget([".guide-preview-map .condition-select select"], modalRef.current));
    };

    updateSelectRect();
    const interval = window.setInterval(updateSelectRect, 450);
    window.addEventListener("resize", updateSelectRect);
    window.addEventListener("scroll", updateSelectRect, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", updateSelectRect);
      window.removeEventListener("scroll", updateSelectRect, true);
    };
  }, [open, step.id]);

  useEffect(() => {
    if (!open || step.id !== "level2Node") {
      setNodeLabelFocusPath("");
      return;
    }

    let hasLockedFocus = false;
    setNodeLabelFocusPath("");
    const updateNodeLabelFocusPath = () => {
      if (hasLockedFocus) return;

      const nextPath = findGuideRecordFocusPath(modalRef.current);
      if (!nextPath) return;

      hasLockedFocus = true;
      setNodeLabelFocusPath(nextPath);
    };
    const animationFrame = window.requestAnimationFrame(updateNodeLabelFocusPath);
    const timers = [80, 180, 360, 720, 1100, 1600, 2200, 2800, 3400].map((delay) =>
      window.setTimeout(updateNodeLabelFocusPath, delay),
    );
    window.addEventListener("resize", updateNodeLabelFocusPath);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", updateNodeLabelFocusPath);
    };
  }, [open, step.id, subStepIndex]);

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
  const nodeGroupShellBounds =
    step.id === "level1Node" || step.id === "level2Node"
      ? modalRef.current
          ?.querySelector<HTMLElement>(".guide-preview-map .network-shell")
          ?.getBoundingClientRect()
      : undefined;
  const nodeOverviewTargetRect = nodeGroupShellBounds && step.id === "level1Node"
    ? (() => {
        const width = Math.min(760, nodeGroupShellBounds.width * 0.58);
        const height = Math.min(560, nodeGroupShellBounds.height * 0.92);
        return roundedGuideRect({
          left: nodeGroupShellBounds.left + (nodeGroupShellBounds.width - width) / 2,
          top: nodeGroupShellBounds.top + (nodeGroupShellBounds.height - height) / 2,
          width,
          height,
        });
      })()
    : null;
  const nodeCloseupTargetRect = nodeGroupShellBounds && step.id === "level2Node"
    ? roundedGuideRect({
        left: nodeGroupShellBounds.left + nodeGroupShellBounds.width * 0.41,
        top: nodeGroupShellBounds.top + nodeGroupShellBounds.height * 0.006,
        width: Math.min(130, nodeGroupShellBounds.width * 0.112),
        height: Math.min(194, nodeGroupShellBounds.height * 0.39),
      })
    : null;
  const activeTargetRect = nodeCloseupTargetRect ?? nodeOverviewTargetRect ?? targetRect;
  const targetCenterX = activeTargetRect.left + activeTargetRect.width * activeClickPoint.x;
  const targetCenterY = activeTargetRect.top + activeTargetRect.height * activeClickPoint.y;
  const panelGap = step.id === "kind" ? 84 : 26;
  const modalBounds = modalRef.current?.getBoundingClientRect();
  const boundaryLeft = modalBounds ? modalBounds.left + 12 : 16;
  const boundaryTop = modalBounds ? modalBounds.top + 12 : 16;
  const boundaryRight = modalBounds ? modalBounds.right - 12 : viewportWidth - 16;
  const boundaryBottom = modalBounds ? modalBounds.bottom - 78 : viewportHeight - 16;
  const spotlightStyle = {
    left: activeTargetRect.left - 8,
    top: activeTargetRect.top - 8,
    width: activeTargetRect.width + 16,
    height: activeTargetRect.height + 16,
  } as CSSProperties;
  const spotlightLeft = Math.max(0, activeTargetRect.left - 8);
  const spotlightTop = Math.max(0, activeTargetRect.top - 8);
  const spotlightRight = Math.min(viewportWidth, activeTargetRect.left + activeTargetRect.width + 8);
  const spotlightBottom = Math.min(viewportHeight, activeTargetRect.top + activeTargetRect.height + 8);
  const pointerStyle = {
    left: targetCenterX,
    top: targetCenterY,
  } as CSSProperties;

  let panelLeft =
    step.panelSide === "left"
      ? activeTargetRect.left - cardWidth - panelGap
      : step.panelSide === "right"
        ? activeTargetRect.left + activeTargetRect.width + panelGap
        : activeTargetRect.left + activeTargetRect.width / 2 - cardWidth / 2;
  let panelTop =
    step.panelSide === "top"
      ? activeTargetRect.top - cardHeight - panelGap
      : step.panelSide === "bottom"
        ? activeTargetRect.top + activeTargetRect.height + panelGap
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

  if (step.id === "level2Node") {
    panelLeft = clampNumber(
      activeTargetRect.left - cardWidth - 28,
      boundaryLeft,
      Math.max(boundaryLeft, boundaryRight - cardWidth),
    );
    panelTop = clampNumber(
      activeTargetRect.top + 24,
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
    left: kindSelectRect.width > 0 ? kindSelectRect.left : spotlightLeft,
    top: kindSelectRect.width > 0 ? kindSelectRect.top + kindSelectRect.height + 8 : spotlightBottom + 8,
    width: Math.max(180, Math.min(260, kindSelectRect.width > 0 ? kindSelectRect.width : spotlightRight - spotlightLeft)),
  } as CSSProperties;
  const panelAnchorX = clampNumber(targetCenterX, panelLeft, panelLeft + cardWidth);
  const panelAnchorY = clampNumber(targetCenterY, panelTop, panelTop + cardHeight);
  const typedLines = typedText.split("\n").filter(Boolean);
  const showSpotlight = true;
  const showRectSpotlight = showSpotlight && step.id !== "level2Node";
  const showPointer = step.id !== "level1Node" && step.id !== "level2Node";
  const showClickMotion =
    showPointer && step.id !== "controls" && (step.id !== "kind" || kindSelectPhase !== "idle");
  const showConnector = step.id !== "dataList" && step.id !== "level2Node";
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
            kindCommitted={hasKind}
            mapQuery={demoMapQuery}
            subStepIndex={subStepIndex}
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
                  <div className="keyword-row-label">
                    <Icon name="search" size={14} />
                    <span>추천 검색어</span>
                  </div>
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
                            style={{ "--fan-delay": `${index * 10}ms` } as CSSProperties}
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
      {nodeLabelFocusPath ? (
        <svg className="guide-custom-focus" aria-hidden="true">
          <path className="guide-node-label-focus-path" d={nodeLabelFocusPath} />
        </svg>
      ) : null}
      {showRectSpotlight ? (
        <div
          className={[
            "guide-spotlight",
            isKindOptionTarget ? "option-focus" : "",
            step.id === "level2Node" ? "node-closeup-focus" : "",
            step.id === "level1Node" || step.id === "level2Node" ? "node-group-focus" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={spotlightStyle}
        />
      ) : null}
      {showClickMotion ? <span className="guide-click-pulse" style={pointerStyle} /> : null}
      {showPointer ? <span className="guide-pointer" style={pointerStyle} /> : null}
      {step.id === "kind" && (kindSelectPhase === "open" || kindSelectPhase === "selected") ? (
        <div
          className={`guide-select-popover phase-${kindSelectPhase}`}
          style={selectPopoverStyle}
          aria-hidden="true"
        >
          <span>전체 유형</span>
          <span>API</span>
          <span>파일데이터</span>
          <strong className="guide-select-option-hybrid">API/파일데이터</strong>
        </div>
      ) : null}

      <section
        className={[
          "guide-callout",
          step.id === "level2Node" ? "node-closeup-callout" : "",
          step.id === "level1Node" || step.id === "level2Node" ? "node-group-callout" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={panelStyle}
      >
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


export default GuideTour;
