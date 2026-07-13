from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    print("PyYAML is required. Run `uv sync` first.", file=sys.stderr)
    raise


ROOT = Path(__file__).resolve().parents[1]
FLOW_DIR = ROOT / "flows"


def iter_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    for task in tasks:
        collected.append(task)
        for key in ("tasks", "then", "else", "errors", "finally"):
            nested = task.get(key)
            if isinstance(nested, list):
                collected.extend(iter_tasks(nested))
    return collected


def validate_flow(path: Path) -> list[str]:
    errors: list[str] = []
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)

    if not isinstance(data, dict):
        return ["flow must be a YAML object"]

    for key in ("id", "namespace", "tasks"):
        if key not in data:
            errors.append(f"missing required key: {key}")

    tasks = data.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        errors.append("tasks must be a non-empty list")
        return errors

    task_ids: set[str] = set()
    for task in iter_tasks(tasks):
        task_id = task.get("id")
        task_type = task.get("type")
        if not task_id:
            errors.append("task is missing id")
        elif task_id in task_ids:
            errors.append(f"duplicate task id: {task_id}")
        else:
            task_ids.add(task_id)
        if not task_type:
            errors.append(f"task {task_id or '<unknown>'} is missing type")

    return errors


def main() -> int:
    flow_files = sorted(FLOW_DIR.glob("*.yml")) + sorted(FLOW_DIR.glob("*.yaml"))
    if not flow_files:
        print("No flow files found.")
        return 1

    failed = False
    for path in flow_files:
        errors = validate_flow(path)
        if errors:
            failed = True
            print(f"[FAIL] {path.relative_to(ROOT)}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"[OK] {path.relative_to(ROOT)}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

