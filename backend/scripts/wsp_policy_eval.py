from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.wsp_policy_eval import (
    evaluate_policy_regression,
    load_policy_eval_samples,
    write_policy_eval_report,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare baseline and candidate WSP rollout datasets.")
    parser.add_argument("--baseline", required=True, help="Baseline WSP JSONL file or folder.")
    parser.add_argument("--candidate", required=True, help="Candidate WSP JSONL file or folder.")
    parser.add_argument("--out", required=True, help="Output policy eval report JSON path.")
    parser.add_argument("--max-invalid-rate-increase", type=float, default=0.02)
    parser.add_argument("--max-new-failure-cases", type=int, default=0)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = evaluate_policy_regression(
        baseline_samples=load_policy_eval_samples(Path(args.baseline)),
        candidate_samples=load_policy_eval_samples(Path(args.candidate)),
        max_invalid_rate_increase=args.max_invalid_rate_increase,
        max_new_failure_cases=args.max_new_failure_cases,
    )
    write_policy_eval_report(report, output_path=Path(args.out))
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
