"""Validate a scenario document, its world package, and its compiled checker tree.

Usage:
    python -m backend.scripts.scenario_validate scenarios/carton_sorting_0001
"""

from __future__ import annotations

import argparse
import json
import sys

from backend.services.scenario_loader import (
    ScenarioLoadError,
    compile_success_to_acts,
    load_scenario,
    load_scenario_world,
    resolve_instruction,
    validate_scenario_against_world,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", help="Path to a scenario.yaml file or its directory")
    parser.add_argument(
        "--print-acts",
        action="store_true",
        help="Print the compiled Genie checker-DSL Acts dict",
    )
    args = parser.parse_args(argv)

    try:
        scenario = load_scenario(args.scenario)
        world = load_scenario_world(args.scenario, scenario)
        instruction = resolve_instruction(scenario)
        cross_errors = validate_scenario_against_world(scenario, world)
        acts = compile_success_to_acts(scenario.success)
    except ScenarioLoadError as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1

    if cross_errors:
        for error in cross_errors:
            print(f"INVALID: {error}", file=sys.stderr)
        return 1

    print(f"OK: {scenario.scenario_id}")
    print(f"  world: {world.package_id}@{world.version} ({len(world.world.objects)} objects)")
    print(f"  instruction: {instruction}")
    print(f"  success conditions: {len(scenario.success.all_of)}, guards: {len(scenario.success.guards)}")
    if args.print_acts:
        print(json.dumps(acts, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
