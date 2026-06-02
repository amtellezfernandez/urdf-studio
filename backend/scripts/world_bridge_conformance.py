from __future__ import annotations

import argparse

from backend.world_bridge.conformance import (
    run_world_bridge_conformance,
    run_world_bridge_live_conformance,
)
from backend.world_bridge.conformance_params import (
    CONFORMANCE_WORLDD_HOST,
    CONFORMANCE_WORLDD_PORT,
    CONFORMANCE_WORLDD_TIMEOUT_MS,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="World-bridge conformance runner")
    parser.add_argument("--live", action="store_true", help="Run live conformance against worldd")
    parser.add_argument("--worldd-host", default=CONFORMANCE_WORLDD_HOST)
    parser.add_argument("--worldd-port", type=int, default=CONFORMANCE_WORLDD_PORT)
    parser.add_argument("--worldd-timeout-ms", type=int, default=CONFORMANCE_WORLDD_TIMEOUT_MS)
    return parser.parse_args()


def _print_result(label: str, passed: bool, checks: list[str], failures: list[str]) -> None:
    print(f"[{label}] passed={passed} checks={len(checks)} failures={len(failures)}")
    for check in checks:
        print(f"  [ok] {check}")
    for failure in failures:
        print(f"  [error] {failure}")


def main() -> int:
    args = _parse_args()
    static_result = run_world_bridge_conformance()
    _print_result(
        "world-bridge-conformance:static",
        static_result.passed,
        static_result.checks,
        static_result.failures,
    )
    exit_code = 0 if static_result.passed else 1

    if args.live:
        live_result = run_world_bridge_live_conformance(
            worldd_host=args.worldd_host,
            worldd_port=args.worldd_port,
            worldd_timeout_ms=args.worldd_timeout_ms,
        )
        _print_result(
            "world-bridge-conformance:live",
            live_result.passed,
            live_result.checks,
            live_result.failures,
        )
        if not live_result.passed:
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
