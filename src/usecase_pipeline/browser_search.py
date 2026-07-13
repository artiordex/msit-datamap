from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.parse import quote_plus

import openpyxl
from dotenv import load_dotenv

from usecase_pipeline.gpt_search import collect_search_items, safe_filename

load_dotenv()


SEARCH_ENGINES = {
    "duckduckgo": "https://html.duckduckgo.com/html/?q={query}",
    "bing": "https://www.bing.com/search?q={query}",
    "naver": "https://search.naver.com/search.naver?query={query}",
    "daum": "https://search.daum.net/search?w=tot&q={query}",
}

BANNED_DOMAINS = {
    "help.naver.com",
    "nid.naver.com",
    "mail.naver.com",
    "m.notify.naver.com",
    "keep.naver.com",
    "member.daum.net",
    "www.daum.net",
}

UI_TEXT_HINTS = (
    "도움말",
    "바로가기",
    "전체 서비스",
    "로그인",
    "프로필",
    "멤버십",
    "검색옵션",
    "사이트맵",
    "입력삭제",
)


def parse_bool(value: str | bool) -> bool:
    if isinstance(value, bool):
        return value
    return value.strip().lower() in {"1", "true", "yes", "y"}


def load_project_env(project_dir: Path) -> None:
    load_dotenv(project_dir / ".env")


def resolve_input(project_dir: Path, input_file: str) -> Path:
    path = Path(input_file)
    if not path.is_absolute():
        path = project_dir / path
    return path


def result_text(locator: Any) -> str:
    try:
        return locator.inner_text(timeout=1000).strip()
    except Exception:
        return ""


def result_attr(locator: Any, attr: str) -> str:
    try:
        return locator.get_attribute(attr, timeout=1000) or ""
    except Exception:
        return ""


def collect_duckduckgo_results(page: Any, max_results: int) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    rows = page.locator(".result").all()
    for row in rows[: max_results * 2]:
        title_link = row.locator("a.result__a").first
        title = result_text(title_link)
        url = result_attr(title_link, "href")
        snippet = result_text(row.locator(".result__snippet").first)
        if title and url:
            results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results


def collect_bing_results(page: Any, max_results: int) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    rows = page.locator("li.b_algo").all()
    for row in rows[: max_results * 2]:
        title_link = row.locator("h2 a").first
        title = result_text(title_link)
        url = result_attr(title_link, "href")
        snippet = result_text(row.locator(".b_caption p").first)
        if title and url:
            results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results


def clean_title(text: str) -> str:
    return (
        text.replace("새 창 열림", "")
        .replace("새창", "")
        .replace("\xa0", " ")
        .strip(" |")
        .strip()
    )


def title_score(text: str) -> int:
    length = len(text)
    score = 100 - abs(length - 45)
    if "›" in text:
        score -= 25
    if "|" in text:
        score -= 5
    if length > 120:
        score -= 90
    if length > 220:
        score -= 120
    if "페이지" in text and any(unit in text for unit in ("KB", "MB")):
        score -= 35
    if text.startswith(("http://", "https://", "www.")):
        score -= 60
    return score


def should_skip_link(text: str, href: str) -> bool:
    if not href.startswith(("http://", "https://")):
        return True
    domain = urlparse(href).netloc.lower()
    if domain in BANNED_DOMAINS:
        return True
    if any(hint in text for hint in UI_TEXT_HINTS):
        return True
    return len(text.strip()) < 8


def collect_generic_anchor_results(page: Any, max_results: int) -> list[dict[str, str]]:
    by_url: dict[str, dict[str, str]] = {}
    for anchor in page.locator("a").all():
        text = clean_title(result_text(anchor))
        href = result_attr(anchor, "href")
        if should_skip_link(text, href):
            continue
        current = {"title": text, "url": href, "snippet": ""}
        existing = by_url.get(href)
        if not existing or title_score(text) > title_score(existing["title"]):
            by_url[href] = current
        if len(by_url) >= max_results * 3:
            break

    return list(by_url.values())[:max_results]


def search_one(page: Any, query: str, engine: str, max_results: int) -> list[dict[str, str]]:
    url_template = SEARCH_ENGINES[engine]
    page.goto(url_template.format(query=quote_plus(query)), wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1200)
    if engine == "duckduckgo":
        return collect_duckduckgo_results(page, max_results)
    if engine == "bing":
        return collect_bing_results(page, max_results)
    if engine in {"naver", "daum"}:
        return collect_generic_anchor_results(page, max_results)
    raise ValueError(f"Unsupported search engine: {engine}")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_xlsx(path: Path, rows: list[dict[str, Any]]) -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "browser_search_results"
    headers = [
        "category",
        "sheet",
        "row_number",
        "institution",
        "query",
        "status",
        "result_count",
        "top_title",
        "top_url",
        "top_snippet",
        "results",
        "error",
    ]
    sheet.append(headers)
    for row in rows:
        results = row.get("results") or []
        top = results[0] if results else {}
        sheet.append(
            [
                row.get("category"),
                row.get("sheet"),
                row.get("row_number"),
                row.get("institution"),
                row.get("query"),
                row.get("status"),
                len(results),
                top.get("title"),
                top.get("url"),
                top.get("snippet"),
                json.dumps(results, ensure_ascii=False),
                row.get("error"),
            ]
        )
    for column in sheet.columns:
        letter = column[0].column_letter
        sheet.column_dimensions[letter].width = min(
            max(len(str(cell.value or "")) for cell in column) + 2,
            100,
        )
    workbook.save(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search the web directly with Playwright.")
    parser.add_argument("--project-dir", default=".")
    parser.add_argument("--input-file", required=True)
    parser.add_argument(
        "--engine",
        choices=sorted(SEARCH_ENGINES),
        default=os.environ.get("BROWSER_SEARCH_ENGINE", "naver"),
    )
    parser.add_argument("--max-rows", type=int, default=int(os.environ.get("BROWSER_SEARCH_MAX_ROWS", "10")))
    parser.add_argument(
        "--max-results",
        type=int,
        default=int(os.environ.get("BROWSER_SEARCH_MAX_RESULTS", "5")),
    )
    parser.add_argument(
        "--headless",
        default=os.environ.get("BROWSER_SEARCH_HEADLESS", "true"),
        help="true or false. Ignored when --headed is used.",
    )
    parser.add_argument("--headed", action="store_true", help="Show the browser window while searching.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_dir = Path(args.project_dir).resolve()
    load_project_env(project_dir)
    input_path = resolve_input(project_dir, args.input_file)
    items = collect_search_items(input_path, args.max_rows)

    from playwright.sync_api import sync_playwright

    headless = False if args.headed else parse_bool(args.headless)
    results: list[dict[str, Any]] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context(
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
            ),
        )
        page = context.new_page()
        for item in items:
            base = {
                "category": item.category,
                "sheet": item.sheet,
                "row_number": item.row_number,
                "institution": item.institution,
                "query": item.query,
                "row": item.row,
            }
            try:
                search_results = search_one(page, item.query, args.engine, args.max_results)
                results.append({**base, "status": "success", "results": search_results})
            except Exception as exc:
                results.append({**base, "status": "failed", "results": [], "error": str(exc)})
            page.wait_for_timeout(800)
        context.close()
        browser.close()

    run_date = datetime.now().strftime("%Y%m%d")
    output_dir = project_dir / "outputs" / "browser_search" / run_date
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(input_path.stem)
    jsonl_path = output_dir / f"{stem}_browser_search.jsonl"
    xlsx_path = output_dir / f"{stem}_browser_search.xlsx"
    write_jsonl(jsonl_path, results)
    write_xlsx(xlsx_path, results)

    payload = {
        "status": "success",
        "engine": args.engine,
        "input_file": str(input_path),
        "item_count": len(results),
        "jsonl_path": str(jsonl_path),
        "xlsx_path": str(xlsx_path),
        "sheets_detected": sorted({item.sheet for item in items}),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"::{json.dumps({'outputs': payload}, ensure_ascii=False)}::")


if __name__ == "__main__":
    main()
