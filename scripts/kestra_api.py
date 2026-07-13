from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
FLOW_DIR = ROOT / "flows"


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env(name: str, default: str) -> str:
    return os.environ.get(name, default).rstrip("/")


def request(method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    base_url = env("KESTRA_BASE_URL", "http://localhost:8080")
    url = f"{base_url}{path}"
    req_headers = headers.copy() if headers else {}

    token = os.environ.get("KESTRA_API_TOKEN")
    username = os.environ.get("KESTRA_USERNAME")
    password = os.environ.get("KESTRA_PASSWORD")
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    elif username and password:
        raw = f"{username}:{password}".encode("utf-8")
        req_headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")

    req = Request(url, data=body, headers=req_headers, method=method)
    try:
        with urlopen(req, timeout=30) as response:
            return response.status, decode_response(response.read(), response.headers.get("Content-Type", ""))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: HTTP {exc.code}\n{detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Cannot reach Kestra at {base_url}: {exc.reason}") from exc


def decode_response(raw: bytes, content_type: str) -> Any:
    text = raw.decode("utf-8", errors="replace")
    if "application/json" in content_type:
        return json.loads(text) if text else {}
    return text


def flow_identity(source: str) -> tuple[str, str]:
    flow_id = re.search(r"(?m)^id:\s*([^\s#]+)", source)
    namespace = re.search(r"(?m)^namespace:\s*([^\s#]+)", source)
    if not flow_id or not namespace:
        raise ValueError("Flow source must include top-level id and namespace.")
    return namespace.group(1), flow_id.group(1)


def deploy_flow(path: Path) -> None:
    tenant = env("KESTRA_TENANT", "main")
    source = path.read_text(encoding="utf-8")
    namespace, flow_id = flow_identity(source)
    body = source.encode("utf-8")
    headers = {"Content-Type": "application/x-yaml; charset=utf-8"}

    try:
        status, _ = request("POST", f"/api/v1/{tenant}/flows", body, headers)
    except RuntimeError as create_error:
        if "HTTP 409" not in str(create_error) and "already" not in str(create_error).lower():
            raise
        status, _ = request("PUT", f"/api/v1/{tenant}/flows/{namespace}/{flow_id}", body, headers)

    print(f"[DEPLOYED] {path.relative_to(ROOT)} -> {namespace}/{flow_id} ({status})")


def deploy(_: argparse.Namespace) -> int:
    flow_files = sorted(FLOW_DIR.glob("*.yml")) + sorted(FLOW_DIR.glob("*.yaml"))
    if not flow_files:
        print("No flow files found.", file=sys.stderr)
        return 1
    for path in flow_files:
        deploy_flow(path)
    return 0


def multipart_form(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = "----kestra-" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def run(args: argparse.Namespace) -> int:
    tenant = env("KESTRA_TENANT", "main")
    namespace = args.namespace or env("KESTRA_NAMESPACE", "mfds.usecase")
    flow_id = args.flow_id or env("KESTRA_FLOW_ID", "food_safety_usecase_pipeline")

    fields = {
        "project_dir": env("PROJECT_DIR", str(ROOT).replace("\\", "/")),
        "input_file": env("INPUT_FILE", "활용사례_자동화_검색.xlsx"),
        "run_mode": args.run_mode or env("RUN_MODE", "manual"),
    }
    body, content_type = multipart_form(fields)
    status, payload = request(
        "POST",
        f"/api/v1/{tenant}/executions/{namespace}/{flow_id}",
        body,
        {"Content-Type": content_type},
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"[RUN] {namespace}/{flow_id} ({status})")
    return 0


def status(args: argparse.Namespace) -> int:
    tenant = env("KESTRA_TENANT", "main")
    _, payload = request("GET", f"/api/v1/{tenant}/executions/{args.execution_id}")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def logs(args: argparse.Namespace) -> int:
    tenant = env("KESTRA_TENANT", "main")
    query = urlencode({"minLevel": args.min_level})
    _, payload = request("GET", f"/api/v1/{tenant}/logs/{args.execution_id}?{query}")
    if isinstance(payload, str):
        print(payload)
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def health(_: argparse.Namespace) -> int:
    tenant = env("KESTRA_TENANT", "main")
    status_code, payload = request("GET", f"/api/v1/{tenant}/flows?size=1")
    print(f"Kestra API OK ({status_code})")
    if payload:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deploy and operate Kestra flows via the Kestra API.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    deploy_parser = subparsers.add_parser("deploy", help="Deploy all flows under flows/.")
    deploy_parser.set_defaults(func=deploy)

    run_parser = subparsers.add_parser("run", help="Run a Kestra flow.")
    run_parser.add_argument("--namespace")
    run_parser.add_argument("--flow-id")
    run_parser.add_argument("--run-mode")
    run_parser.set_defaults(func=run)

    status_parser = subparsers.add_parser("status", help="Fetch execution status and outputs.")
    status_parser.add_argument("execution_id")
    status_parser.set_defaults(func=status)

    logs_parser = subparsers.add_parser("logs", help="Fetch execution logs.")
    logs_parser.add_argument("execution_id")
    logs_parser.add_argument("--min-level", default="INFO")
    logs_parser.set_defaults(func=logs)

    health_parser = subparsers.add_parser("health", help="Check Kestra API connectivity.")
    health_parser.set_defaults(func=health)
    return parser


def main() -> int:
    load_env()
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

