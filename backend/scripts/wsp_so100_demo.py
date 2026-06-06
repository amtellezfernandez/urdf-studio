"""SO-100 random rollout demo: dynamic world validation without real hardware.

Generates random SO-100 joint trajectories, simulates a box that moves when
the gripper contacts it, then runs the WSP executability audit on each trace.

Usage:
  npm run wsp:so100-demo -- --count 20 --out /tmp/so100_demo.json
  npm run wsp:so100-demo -- --count 50 --seed 7
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.so100_random_rollout import (
    ALL_SCENARIOS,
    DEFAULT_FRAME_COUNT,
    DEFAULT_SEED,
    generate_so100_rollout_batch,
    summarize_rollout_batch,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate random SO-100 rollouts with a dynamic box and validate via WSP audit.",
    )
    parser.add_argument("--count",        type=int,  default=20,             help="Number of rollouts to generate.")
    parser.add_argument("--frames",       type=int,  default=DEFAULT_FRAME_COUNT, help="Frames per rollout.")
    parser.add_argument("--seed",         type=int,  default=DEFAULT_SEED,   help="RNG seed for reproducibility.")
    parser.add_argument("--out",          default="",                         help="Optional output JSON path.")
    parser.add_argument("--verbose",      action="store_true",                help="Print per-rollout audit results.")
    return parser.parse_args()


def _decision_emoji(decision: str) -> str:
    return {"allow": "PASS", "warn": "WARN", "reject": "BLOCK", "stop": "STOP", "escalate": "ESC"}.get(decision, decision.upper())


def main() -> int:
    args = _parse_args()

    traces = generate_so100_rollout_batch(
        args.count,
        seed=args.seed,
        frame_count=args.frames,
    )
    summary = summarize_rollout_batch(traces)

    audit_results = []
    decision_counts: dict[str, int] = {"allow": 0, "warn": 0, "reject": 0, "stop": 0}

    for trace in traces:
        report = audit_physical_rollout_trace(trace)
        scenario = str(trace.metadata.get("scenario", "unknown"))
        result = {
            "trace_id":  trace.trace_id,
            "scenario":  scenario,
            "decision":  report.decision,
            "frames":    len(trace.frames),
            "contacts":  sum(1 for f in trace.frames if f.metadata.get("contact")),
            "checks":    len(report.checks),
            "failures":  [c.check_id for c in report.checks if not c.passed],
        }
        audit_results.append(result)
        decision_counts[report.decision] = decision_counts.get(report.decision, 0) + 1

        if args.verbose:
            tag = _decision_emoji(report.decision)
            contacts = result["contacts"]
            failures = ", ".join(result["failures"]) if result["failures"] else "—"
            print(f"  [{tag}] {trace.trace_id}  scenario={scenario}  contacts={contacts}  failures={failures}")

    output = {
        "ok": True,
        "config": {"count": args.count, "frames": args.frames, "seed": args.seed},
        "rollup": summary,
        "audit_summary": {
            "pass":  decision_counts.get("allow", 0),
            "warn":  decision_counts.get("warn",  0),
            "block": decision_counts.get("reject", 0) + decision_counts.get("stop", 0),
            "total": args.count,
        },
        "results": audit_results,
    }

    print("\n── SO-100 Dynamic World Demo ─────────────────────────────────────")
    print(f"  Rollouts generated : {summary['total_traces']}")
    print(f"  Total frames       : {summary['total_frames']}")
    print(f"  Contact frames     : {summary['total_contact_frames']}")
    print(f"  Scenario mix       : {summary['scenario_counts']}")
    print()
    print(f"  Audit results:")
    print(f"    PASS   {output['audit_summary']['pass']}")
    print(f"    WARN   {output['audit_summary']['warn']}")
    print(f"    BLOCK  {output['audit_summary']['block']}")
    print("──────────────────────────────────────────────────────────────────\n")

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
        print(f"Output written to: {args.out}")

    all_ok = output["audit_summary"]["pass"] > 0
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
