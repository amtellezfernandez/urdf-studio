from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


def load_runs(path: Path) -> list[dict]:
    runs: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            runs.append(json.loads(line))
    return runs


def plot_latency_cdf(runs: list[dict], output_dir: Path) -> None:
    by_policy: defaultdict[str, list[float]] = defaultdict(list)
    for run in runs:
        by_policy[run["solver_policy"]].append(run["duration_ms"])

    plt.figure(figsize=(6, 4))
    for policy, durations in by_policy.items():
        if not durations:
            continue
        values = np.sort(np.array(durations, dtype=float))
        cdf = np.arange(1, len(values) + 1) / len(values)
        plt.plot(values, cdf, label=policy)
    plt.xlabel("Latency (ms)")
    plt.ylabel("CDF")
    plt.title("IK Latency CDF")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_dir / "latency_cdf.png", dpi=150)


def plot_success_rates(runs: list[dict], output_dir: Path) -> None:
    by_policy: defaultdict[str, list[bool]] = defaultdict(list)
    for run in runs:
        by_policy[run["solver_policy"]].append(bool(run["success"]))

    labels = []
    rates = []
    for policy, values in by_policy.items():
        labels.append(policy)
        rates.append(sum(values) / len(values))

    plt.figure(figsize=(6, 4))
    plt.bar(labels, rates)
    plt.ylim(0.0, 1.0)
    plt.ylabel("Success Rate")
    plt.title("IK Success Rate")
    plt.grid(axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_dir / "success_rate.png", dpi=150)


def plot_escalation_hist(runs: list[dict], output_dir: Path) -> None:
    counts: defaultdict[str, int] = defaultdict(int)
    for run in runs:
        reason = run.get("escalation_blocked_reason") or "none"
        counts[reason] += 1

    labels = list(counts.keys())
    values = [counts[label] for label in labels]
    plt.figure(figsize=(7, 4))
    plt.bar(labels, values)
    plt.ylabel("Count")
    plt.title("Escalation Blocked Reasons")
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()
    plt.savefig(output_dir / "escalation_hist.png", dpi=150)


def main() -> None:
    parser = argparse.ArgumentParser(description="Plot IK benchmark results from JSONL.")
    parser.add_argument("--input", required=True, help="Path to JSONL benchmark output.")
    parser.add_argument(
        "--output-dir", default="ik_benchmark_plots", help="Directory for plots."
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    runs = load_runs(input_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    plot_latency_cdf(runs, output_dir)
    plot_success_rates(runs, output_dir)
    plot_escalation_hist(runs, output_dir)
    print(f"Wrote plots to {output_dir}")


if __name__ == "__main__":
    main()
