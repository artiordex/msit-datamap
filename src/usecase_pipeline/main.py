from __future__ import annotations

import argparse
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def configure_logging(project_dir: Path) -> None:
    log_dir = project_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(log_dir / "pipeline.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def resolve_input(project_dir: Path, input_file: str) -> Path:
    candidate = Path(input_file)
    if not candidate.is_absolute():
        candidate = project_dir / candidate
    return candidate


def summarize_workbook(path: Path) -> dict[str, Any]:
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError("openpyxl is required. Run `uv sync` first.") from exc

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets: list[dict[str, Any]] = []

    for sheet in workbook.worksheets:
        rows = sheet.iter_rows(values_only=True)
        header = next(rows, None)
        columns = [str(value).strip() for value in header if value is not None] if header else []
        data_rows = 0
        non_empty_rows = 0

        for row in rows:
            data_rows += 1
            if any(value not in (None, "") for value in row):
                non_empty_rows += 1

        sheets.append(
            {
                "name": sheet.title,
                "columns": columns,
                "data_rows": data_rows,
                "non_empty_rows": non_empty_rows,
            }
        )

    workbook.close()
    return {"type": "xlsx", "sheet_count": len(sheets), "sheets": sheets}


def summarize_csv(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader, [])
        row_count = sum(1 for _ in reader)
    return {"type": "csv", "sheet_count": 1, "sheets": [{"name": path.stem, "columns": header, "data_rows": row_count}]}


def summarize_input(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        return summarize_workbook(path)
    if suffix == ".csv":
        return summarize_csv(path)
    raise ValueError(f"Unsupported input file type: {suffix}")


def write_result(project_dir: Path, dataset_id: str, payload: dict[str, Any]) -> Path:
    run_date = datetime.now().strftime("%Y%m%d")
    output_dir = project_dir / "outputs" / run_date
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{dataset_id}.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def finalize(project_dir: Path, input_file: Path, run_mode: str) -> dict[str, Any]:
    output_root = project_dir / "outputs"
    results = sorted(output_root.glob("*/*.json")) if output_root.exists() else []
    manifest = {
        "status": "success",
        "finalized_at": utc_now(),
        "run_mode": run_mode,
        "input_file": str(input_file),
        "result_count": len(results),
        "results": [str(path.relative_to(project_dir)) for path in results],
    }
    manifest_path = write_result(project_dir, "manifest", manifest)
    manifest["manifest_path"] = str(manifest_path)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the MFDS use-case automation pipeline.")
    parser.add_argument("--project-dir", default=".", help="Project root directory.")
    parser.add_argument("--input-file", required=True, help="Input workbook or CSV.")
    parser.add_argument("--dataset-id", required=True, help="Logical dataset/process id.")
    parser.add_argument("--run-mode", default="incremental", help="manual, incremental, or full.")
    parser.add_argument("--finalize", action="store_true", help="Write a manifest for collected outputs.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_dir = Path(args.project_dir).resolve()
    configure_logging(project_dir)

    input_path = resolve_input(project_dir, args.input_file)
    logging.info("dataset=%s mode=%s input=%s", args.dataset_id, args.run_mode, input_path)

    if args.finalize:
        payload = finalize(project_dir, input_path, args.run_mode)
    else:
        summary = summarize_input(input_path)
        payload = {
            "status": "success",
            "dataset_id": args.dataset_id,
            "run_mode": args.run_mode,
            "processed_at": utc_now(),
            "input_file": str(input_path),
            "summary": summary,
        }
        output_path = write_result(project_dir, args.dataset_id, payload)
        payload["output_path"] = str(output_path)

    logging.info("result=%s", json.dumps(payload, ensure_ascii=False))
    print(f"::{json.dumps({'outputs': payload}, ensure_ascii=False)}::")


if __name__ == "__main__":
    main()

