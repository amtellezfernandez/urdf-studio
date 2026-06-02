from __future__ import annotations

import argparse
import json
from dataclasses import asdict

from backend.services.so100_sysid.benchmark import (
    assert_so100_sysid_result_is_healthy,
    run_so100_synthetic_sysid_benchmark,
)
from backend.services.so100_sysid.params import (
    SO100_SYNTHETIC_OPTIMIZER_STEPS,
    SO100_SYNTHETIC_STEP_COUNT,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SO100 MJX synthetic system-identification benchmark.")
    parser.add_argument("--optimizer-steps", type=int, default=SO100_SYNTHETIC_OPTIMIZER_STEPS)
    parser.add_argument("--rollout-steps", type=int, default=SO100_SYNTHETIC_STEP_COUNT)
    parser.add_argument("--no-assert", action="store_true", help="Print metrics without enforcing health thresholds.")
    args = parser.parse_args()

    result = run_so100_synthetic_sysid_benchmark(
        optimizer_steps=args.optimizer_steps,
        rollout_steps=args.rollout_steps,
    )
    if not args.no_assert:
        assert_so100_sysid_result_is_healthy(result)
    print(json.dumps(asdict(result), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
