from __future__ import annotations

import argparse
import json
from urllib import error, request

from backend.core.settings import settings
from backend.world_bridge.types import WorldBridgeReadinessDecision

HTTP_OK = 200
HTTP_CONFLICT = 409


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="World-bridge readiness decision gate")
    parser.add_argument("--api-host", default=settings.api_host)
    parser.add_argument("--api-port", type=int, default=settings.api_port)
    parser.add_argument(
        "--minimum",
        choices=[decision.value for decision in WorldBridgeReadinessDecision],
        default=WorldBridgeReadinessDecision.WATCH.value,
        help="Minimum accepted readiness decision.",
    )
    parser.add_argument("--timeout-ms", type=int, default=1_000)
    return parser.parse_args()


def _request_readiness_assert(
    *,
    api_host: str,
    api_port: int,
    minimum: str,
    timeout_ms: int,
) -> tuple[int, str]:
    req = request.Request(
        url=f"http://{api_host}:{api_port}/world-bridge/readiness/assert/{minimum}",
        method="GET",
        headers={"Accept": "application/json"},
    )
    timeout_s = max(timeout_ms, 1) / 1000.0
    try:
        with request.urlopen(req, timeout=timeout_s) as response:
            body = response.read().decode("utf-8")
            return HTTP_OK, body
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, body
    except (error.URLError, TimeoutError, OSError) as exc:
        return 0, json.dumps({"error": str(exc)})


def main() -> int:
    args = _parse_args()
    status_code, body = _request_readiness_assert(
        api_host=args.api_host,
        api_port=args.api_port,
        minimum=args.minimum,
        timeout_ms=args.timeout_ms,
    )
    if status_code == HTTP_OK:
        print(f"[world-bridge-readiness-gate] pass minimum={args.minimum}")
        print(body)
        return 0
    if status_code == HTTP_CONFLICT:
        print(f"[world-bridge-readiness-gate] fail minimum={args.minimum}")
        print(body)
        return 1
    print("[world-bridge-readiness-gate] error")
    print(body)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
