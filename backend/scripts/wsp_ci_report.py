from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.wsp_ci_report import (
    build_wsp_ci_report,
    load_policy_report,
    write_wsp_ci_report,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert WSP policy eval JSON into a CI PASS/WARN/BLOCK report.")
    parser.add_argument("--policy-report", required=True, help="Policy eval report JSON path.")
    parser.add_argument("--out", required=True, help="Output CI report JSON path.")
    parser.add_argument("--warn-invalid-rate-increase", type=float, default=0.0)
    parser.add_argument("--warn-new-failure-cases", type=int, default=0)
    parser.add_argument("--fail-on-warn", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = build_wsp_ci_report(
        policy_report=load_policy_report(Path(args.policy_report)),
        warn_invalid_rate_increase=args.warn_invalid_rate_increase,
        warn_new_failure_cases=args.warn_new_failure_cases,
    )
    write_wsp_ci_report(report, output_path=Path(args.out))
    print(json.dumps(report, indent=2, sort_keys=True))
    if report["status"] == "BLOCK":
        return 1
    if args.fail_on_warn and report["status"] == "WARN":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
