from __future__ import annotations

import argparse
import gc
import json
import tracemalloc
from dataclasses import asdict, dataclass
from pathlib import Path
from time import perf_counter_ns
from typing import Callable

from backend.app import create_app
from backend.world_bridge.perf_params import (
    PERF_BENCHMARK_COMMAND_SOURCE,
    PERF_BENCHMARK_ROBOT_NAME,
    PERF_BENCHMARK_SCENARIO_DURATION_MS,
    PERF_DEFAULT_COMMANDS_PER_SESSION,
    PERF_DEFAULT_JOINTS_PER_COMMAND,
    PERF_DEFAULT_SCENARIO_UPDATES_PER_SESSION,
    PERF_DEFAULT_SESSION_COUNT,
    PERF_LIST_SESSIONS_MEASURE_ITERATIONS,
    PERF_OPERATION_MAX_RETRIES,
    PERF_SEQUENCE_START,
    PERF_SEQUENCE_STEP,
    PERF_STARTUP_APP_MEASURE_ITERATIONS,
    PERF_STARTUP_RUNTIME_MEASURE_ITERATIONS,
    PERF_TARGET_APP_STARTUP_P95_MS,
    PERF_TARGET_CREATE_SESSION_PAYLOAD_BYTES,
    PERF_TARGET_CREATE_SESSION_P95_MS,
    PERF_TARGET_COMMAND_P95_MS,
    PERF_TARGET_COMMAND_P99_MS,
    PERF_TARGET_ERROR_RATE,
    PERF_TARGET_GET_SESSION_PAYLOAD_BYTES,
    PERF_TARGET_GET_SESSION_P95_MS,
    PERF_TARGET_LIST_SESSIONS_PAYLOAD_BYTES,
    PERF_TARGET_LIST_SESSIONS_P95_MS,
    PERF_TARGET_MAX_FAILED_OPERATIONS,
    PERF_TARGET_MAX_RETRIES,
    PERF_TARGET_PYTHON_PEAK_ALLOCATED_MIB,
    PERF_TARGET_RETRY_RATE,
    PERF_TARGET_RUNTIME_STARTUP_P95_MS,
    PERF_TARGET_SCENARIO_UPDATE_P95_MS,
    PERF_TARGET_STATUS_PAYLOAD_BYTES,
)
from backend.world_bridge.runtime import WorldBridgeRuntime
from backend.world_bridge.types import (
    WorldBridgeStatusResponse,
    WorldBridgeJointCommandRequest,
    WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeSessionSnapshot,
)

NANOSECONDS_PER_MILLISECOND = 1_000_000.0
BYTES_PER_MIB = 1_048_576.0
PERCENTILE_50 = 50
PERCENTILE_95 = 95
PERCENTILE_99 = 99


def _ns_to_ms(duration_ns: int) -> float:
    return duration_ns / NANOSECONDS_PER_MILLISECOND


def _bytes_to_mib(value: int) -> float:
    return value / BYTES_PER_MIB


def _percentile(values: list[float], percentile: int) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    rank = int((len(sorted_values) - 1) * (percentile / 100.0))
    return sorted_values[rank]


def _json_size_bytes(payload: object) -> int:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return len(encoded)


def _status_payload_size_bytes(status: WorldBridgeStatusResponse) -> int:
    return _json_size_bytes(status.model_dump(mode="json"))


def _snapshot_payload_size_bytes(snapshot: WorldBridgeSessionSnapshot) -> int:
    return _json_size_bytes(snapshot.model_dump(mode="json"))


def _snapshot_list_payload_size_bytes(snapshots: list[WorldBridgeSessionSnapshot]) -> int:
    return _json_size_bytes([snapshot.model_dump(mode="json") for snapshot in snapshots])


@dataclass
class LatencySummary:
    count: int
    mean_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float


@dataclass
class StartupSummary:
    app_create_p95_ms: float
    runtime_init_p95_ms: float


@dataclass
class PayloadSizeSummary:
    status_bytes: int
    create_session_bytes: int
    get_session_bytes: int
    list_sessions_bytes: int


@dataclass
class ResourceSummary:
    python_peak_allocated_mib: float


@dataclass
class ReliabilitySummary:
    total_operations: int
    failed_operations: int
    retries_executed: int
    error_rate: float
    retry_rate: float


@dataclass
class OperationExecution:
    success: bool
    duration_ms: float
    retries_used: int
    error: str | None


@dataclass
class WorldBridgeBenchmarkReport:
    sessions: int
    commands_per_session: int
    joints_per_command: int
    scenario_updates_per_session: int
    total_commands: int
    successful_commands: int
    startup: StartupSummary
    payload_sizes: PayloadSizeSummary
    resources: ResourceSummary
    reliability: ReliabilitySummary
    create_session: LatencySummary
    apply_joint_command: LatencySummary
    update_scenario_time: LatencySummary
    get_session: LatencySummary
    list_sessions: LatencySummary
    command_throughput_ops_per_sec: float


def _summarize(values_ms: list[float]) -> LatencySummary:
    if not values_ms:
        return LatencySummary(
            count=0,
            mean_ms=0.0,
            p50_ms=0.0,
            p95_ms=0.0,
            p99_ms=0.0,
            max_ms=0.0,
        )
    total_ms = sum(values_ms)
    return LatencySummary(
        count=len(values_ms),
        mean_ms=total_ms / len(values_ms),
        p50_ms=_percentile(values_ms, PERCENTILE_50),
        p95_ms=_percentile(values_ms, PERCENTILE_95),
        p99_ms=_percentile(values_ms, PERCENTILE_99),
        max_ms=max(values_ms),
    )


def _build_joint_positions(joints_per_command: int) -> dict[str, float]:
    return {f"joint_{index + 1}": (index + 1) * 0.01 for index in range(joints_per_command)}


def _measure_call_latency_ms(
    call: Callable[[], object],
    *,
    iterations: int,
    collect_gc_before_sample: bool = False,
) -> list[float]:
    samples_ms: list[float] = []
    for _ in range(iterations):
        if collect_gc_before_sample:
            gc.collect()
        start_ns = perf_counter_ns()
        call()
        samples_ms.append(_ns_to_ms(perf_counter_ns() - start_ns))
    return samples_ms


def _run_with_retry(
    operation: Callable[[], object],
    *,
    max_retries: int,
) -> OperationExecution:
    retries_used = 0
    start_ns = perf_counter_ns()
    last_error: str | None = None
    for _attempt in range(max_retries + 1):
        try:
            operation()
            return OperationExecution(
                success=True,
                duration_ms=_ns_to_ms(perf_counter_ns() - start_ns),
                retries_used=retries_used,
                error=None,
            )
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            if retries_used >= max_retries:
                break
            retries_used += 1
    return OperationExecution(
        success=False,
        duration_ms=_ns_to_ms(perf_counter_ns() - start_ns),
        retries_used=retries_used,
        error=last_error,
    )


def run_world_bridge_benchmark(
    *,
    sessions: int,
    commands_per_session: int,
    joints_per_command: int,
    scenario_updates_per_session: int,
) -> WorldBridgeBenchmarkReport:
    startup_summary = StartupSummary(
        app_create_p95_ms=_percentile(
            _measure_call_latency_ms(
                create_app,
                iterations=PERF_STARTUP_APP_MEASURE_ITERATIONS,
                collect_gc_before_sample=True,
            ),
            PERCENTILE_95,
        ),
        runtime_init_p95_ms=_percentile(
            _measure_call_latency_ms(
                WorldBridgeRuntime,
                iterations=PERF_STARTUP_RUNTIME_MEASURE_ITERATIONS,
            ),
            PERCENTILE_95,
        ),
    )
    runtime = WorldBridgeRuntime()

    tracemalloc.start()

    create_latencies: list[float] = []
    command_latencies: list[float] = []
    scenario_update_latencies: list[float] = []
    get_session_latencies: list[float] = []
    list_sessions_latencies: list[float] = []
    session_ids: list[str] = []
    joint_positions = _build_joint_positions(joints_per_command)
    operation_total_count = 0
    operation_failed_count = 0
    retries_executed = 0
    successful_commands = 0
    first_created_snapshot: WorldBridgeSessionSnapshot | None = None
    first_get_session_snapshot: WorldBridgeSessionSnapshot | None = None

    for _ in range(sessions):
        create_req = WorldBridgeSessionCreateRequest(
            robot_name=PERF_BENCHMARK_ROBOT_NAME,
            scenario_duration_ms=PERF_BENCHMARK_SCENARIO_DURATION_MS,
        )
        created_result: dict[str, WorldBridgeSessionSnapshot | None] = {"value": None}
        execution = _run_with_retry(
            lambda: created_result.update(value=runtime.create_session(create_req)),
            max_retries=PERF_OPERATION_MAX_RETRIES,
        )
        operation_total_count += 1
        operation_failed_count += 0 if execution.success else 1
        retries_executed += execution.retries_used
        if execution.success:
            create_latencies.append(execution.duration_ms)
        created = created_result["value"]
        if created is None:
            continue
        if first_created_snapshot is None:
            first_created_snapshot = created
        session_ids.append(created.session_id)

    commands_start_ns = perf_counter_ns()
    for session_id in session_ids:
        sequence_id = PERF_SEQUENCE_START
        for command_index in range(commands_per_session):
            command_req = WorldBridgeJointCommandRequest(
                joint_positions=joint_positions,
                source=PERF_BENCHMARK_COMMAND_SOURCE,
                sequence_id=sequence_id,
                command_time_ms=command_index,
            )
            execution = _run_with_retry(
                lambda: runtime.apply_joint_command(session_id, command_req),
                max_retries=PERF_OPERATION_MAX_RETRIES,
            )
            operation_total_count += 1
            operation_failed_count += 0 if execution.success else 1
            retries_executed += execution.retries_used
            if execution.success:
                command_latencies.append(execution.duration_ms)
                successful_commands += 1
            sequence_id += PERF_SEQUENCE_STEP
    commands_elapsed_s = (perf_counter_ns() - commands_start_ns) / 1_000_000_000.0

    for session_id in session_ids:
        for update_index in range(scenario_updates_per_session):
            scenario_req = WorldBridgeScenarioTimeUpdateRequest(scenario_time_ms=update_index)
            execution = _run_with_retry(
                lambda: runtime.update_scenario_time(session_id, scenario_req),
                max_retries=PERF_OPERATION_MAX_RETRIES,
            )
            operation_total_count += 1
            operation_failed_count += 0 if execution.success else 1
            retries_executed += execution.retries_used
            if execution.success:
                scenario_update_latencies.append(execution.duration_ms)

    for session_id in session_ids:
        get_result: dict[str, WorldBridgeSessionSnapshot | None] = {"value": None}
        execution = _run_with_retry(
            lambda: get_result.update(
                value=runtime.get_session(session_id, include_trace=False)
            ),
            max_retries=PERF_OPERATION_MAX_RETRIES,
        )
        operation_total_count += 1
        operation_failed_count += 0 if execution.success else 1
        retries_executed += execution.retries_used
        if execution.success:
            get_session_latencies.append(execution.duration_ms)
        fetched = get_result["value"]
        if fetched is not None and first_get_session_snapshot is None:
            first_get_session_snapshot = fetched

    listed_result: dict[str, list[WorldBridgeSessionSnapshot] | None] = {"value": None}
    for _ in range(PERF_LIST_SESSIONS_MEASURE_ITERATIONS):
        execution = _run_with_retry(
            lambda: listed_result.update(value=runtime.list_sessions(include_trace=False)),
            max_retries=PERF_OPERATION_MAX_RETRIES,
        )
        operation_total_count += 1
        operation_failed_count += 0 if execution.success else 1
        retries_executed += execution.retries_used
        if execution.success:
            list_sessions_latencies.append(execution.duration_ms)

    current_bytes, peak_bytes = tracemalloc.get_traced_memory()
    _ = current_bytes
    tracemalloc.stop()

    status_payload_size = _status_payload_size_bytes(runtime.get_status())
    create_payload_size = (
        _snapshot_payload_size_bytes(first_created_snapshot)
        if first_created_snapshot is not None
        else 0
    )
    get_payload_size = (
        _snapshot_payload_size_bytes(first_get_session_snapshot)
        if first_get_session_snapshot is not None
        else 0
    )
    listed_snapshots = listed_result["value"] or []
    list_payload_size = _snapshot_list_payload_size_bytes(listed_snapshots)

    total_commands = sessions * commands_per_session
    throughput = successful_commands / commands_elapsed_s if commands_elapsed_s > 0 else 0.0
    error_rate = (
        operation_failed_count / operation_total_count if operation_total_count > 0 else 0.0
    )
    retry_rate = retries_executed / operation_total_count if operation_total_count > 0 else 0.0
    return WorldBridgeBenchmarkReport(
        sessions=sessions,
        commands_per_session=commands_per_session,
        joints_per_command=joints_per_command,
        scenario_updates_per_session=scenario_updates_per_session,
        total_commands=total_commands,
        successful_commands=successful_commands,
        startup=startup_summary,
        payload_sizes=PayloadSizeSummary(
            status_bytes=status_payload_size,
            create_session_bytes=create_payload_size,
            get_session_bytes=get_payload_size,
            list_sessions_bytes=list_payload_size,
        ),
        resources=ResourceSummary(
            python_peak_allocated_mib=_bytes_to_mib(peak_bytes),
        ),
        reliability=ReliabilitySummary(
            total_operations=operation_total_count,
            failed_operations=operation_failed_count,
            retries_executed=retries_executed,
            error_rate=error_rate,
            retry_rate=retry_rate,
        ),
        create_session=_summarize(create_latencies),
        apply_joint_command=_summarize(command_latencies),
        update_scenario_time=_summarize(scenario_update_latencies),
        get_session=_summarize(get_session_latencies),
        list_sessions=_summarize(list_sessions_latencies),
        command_throughput_ops_per_sec=throughput,
    )


def _print_summary(report: WorldBridgeBenchmarkReport) -> None:
    print("World-bridge benchmark")
    print(
        f"sessions={report.sessions} commands/session={report.commands_per_session} "
        f"joints/command={report.joints_per_command} "
        f"scenario-updates/session={report.scenario_updates_per_session}"
    )
    print(f"total_commands={report.total_commands} successful_commands={report.successful_commands}")
    print(f"command_throughput_ops_per_sec={report.command_throughput_ops_per_sec:.2f}")
    print(
        "apply_joint_command_ms "
        f"p50={report.apply_joint_command.p50_ms:.4f} "
        f"p95={report.apply_joint_command.p95_ms:.4f} "
        f"p99={report.apply_joint_command.p99_ms:.4f} "
        f"max={report.apply_joint_command.max_ms:.4f}"
    )
    print(
        "update_scenario_time_ms "
        f"p50={report.update_scenario_time.p50_ms:.4f} "
        f"p95={report.update_scenario_time.p95_ms:.4f} "
        f"p99={report.update_scenario_time.p99_ms:.4f} "
        f"max={report.update_scenario_time.max_ms:.4f}"
    )
    print(
        "get_session_ms "
        f"p50={report.get_session.p50_ms:.4f} "
        f"p95={report.get_session.p95_ms:.4f} "
        f"p99={report.get_session.p99_ms:.4f} "
        f"max={report.get_session.max_ms:.4f}"
    )
    print(
        "startup_ms "
        f"app_create_p95={report.startup.app_create_p95_ms:.4f} "
        f"runtime_init_p95={report.startup.runtime_init_p95_ms:.4f}"
    )
    print(
        "payload_bytes "
        f"status={report.payload_sizes.status_bytes} "
        f"create_session={report.payload_sizes.create_session_bytes} "
        f"get_session={report.payload_sizes.get_session_bytes} "
        f"list_sessions={report.payload_sizes.list_sessions_bytes}"
    )
    print(
        "resources "
        f"python_peak_allocated_mib={report.resources.python_peak_allocated_mib:.4f}"
    )
    print(
        "reliability "
        f"total_operations={report.reliability.total_operations} "
        f"failed={report.reliability.failed_operations} "
        f"retries={report.reliability.retries_executed} "
        f"error_rate={report.reliability.error_rate:.6f} "
        f"retry_rate={report.reliability.retry_rate:.6f}"
    )


def _assert_targets(report: WorldBridgeBenchmarkReport) -> list[str]:
    failures: list[str] = []
    if report.apply_joint_command.p95_ms > PERF_TARGET_COMMAND_P95_MS:
        failures.append(
            "apply_joint_command p95 exceeded target: "
            f"{report.apply_joint_command.p95_ms:.4f}ms > {PERF_TARGET_COMMAND_P95_MS:.4f}ms"
        )
    if report.apply_joint_command.p99_ms > PERF_TARGET_COMMAND_P99_MS:
        failures.append(
            "apply_joint_command p99 exceeded target: "
            f"{report.apply_joint_command.p99_ms:.4f}ms > {PERF_TARGET_COMMAND_P99_MS:.4f}ms"
        )
    if report.update_scenario_time.p95_ms > PERF_TARGET_SCENARIO_UPDATE_P95_MS:
        failures.append(
            "update_scenario_time p95 exceeded target: "
            f"{report.update_scenario_time.p95_ms:.4f}ms > {PERF_TARGET_SCENARIO_UPDATE_P95_MS:.4f}ms"
        )
    if report.get_session.p95_ms > PERF_TARGET_GET_SESSION_P95_MS:
        failures.append(
            "get_session p95 exceeded target: "
            f"{report.get_session.p95_ms:.4f}ms > {PERF_TARGET_GET_SESSION_P95_MS:.4f}ms"
        )
    if report.create_session.p95_ms > PERF_TARGET_CREATE_SESSION_P95_MS:
        failures.append(
            "create_session p95 exceeded target: "
            f"{report.create_session.p95_ms:.4f}ms > {PERF_TARGET_CREATE_SESSION_P95_MS:.4f}ms"
        )
    if report.list_sessions.p95_ms > PERF_TARGET_LIST_SESSIONS_P95_MS:
        failures.append(
            "list_sessions p95 exceeded target: "
            f"{report.list_sessions.p95_ms:.4f}ms > {PERF_TARGET_LIST_SESSIONS_P95_MS:.4f}ms"
        )
    if report.startup.app_create_p95_ms > PERF_TARGET_APP_STARTUP_P95_MS:
        failures.append(
            "app startup p95 exceeded target: "
            f"{report.startup.app_create_p95_ms:.4f}ms > {PERF_TARGET_APP_STARTUP_P95_MS:.4f}ms"
        )
    if report.startup.runtime_init_p95_ms > PERF_TARGET_RUNTIME_STARTUP_P95_MS:
        failures.append(
            "runtime startup p95 exceeded target: "
            f"{report.startup.runtime_init_p95_ms:.4f}ms > {PERF_TARGET_RUNTIME_STARTUP_P95_MS:.4f}ms"
        )
    if report.payload_sizes.status_bytes > PERF_TARGET_STATUS_PAYLOAD_BYTES:
        failures.append(
            "status payload exceeded target: "
            f"{report.payload_sizes.status_bytes} > {PERF_TARGET_STATUS_PAYLOAD_BYTES}"
        )
    if report.payload_sizes.create_session_bytes > PERF_TARGET_CREATE_SESSION_PAYLOAD_BYTES:
        failures.append(
            "create_session payload exceeded target: "
            f"{report.payload_sizes.create_session_bytes} > {PERF_TARGET_CREATE_SESSION_PAYLOAD_BYTES}"
        )
    if report.payload_sizes.get_session_bytes > PERF_TARGET_GET_SESSION_PAYLOAD_BYTES:
        failures.append(
            "get_session payload exceeded target: "
            f"{report.payload_sizes.get_session_bytes} > {PERF_TARGET_GET_SESSION_PAYLOAD_BYTES}"
        )
    if report.payload_sizes.list_sessions_bytes > PERF_TARGET_LIST_SESSIONS_PAYLOAD_BYTES:
        failures.append(
            "list_sessions payload exceeded target: "
            f"{report.payload_sizes.list_sessions_bytes} > {PERF_TARGET_LIST_SESSIONS_PAYLOAD_BYTES}"
        )
    if report.resources.python_peak_allocated_mib > PERF_TARGET_PYTHON_PEAK_ALLOCATED_MIB:
        failures.append(
            "python peak allocation exceeded target: "
            f"{report.resources.python_peak_allocated_mib:.4f}MiB > "
            f"{PERF_TARGET_PYTHON_PEAK_ALLOCATED_MIB:.4f}MiB"
        )
    if report.reliability.error_rate > PERF_TARGET_ERROR_RATE:
        failures.append(
            "error rate exceeded target: "
            f"{report.reliability.error_rate:.6f} > {PERF_TARGET_ERROR_RATE:.6f}"
        )
    if report.reliability.retry_rate > PERF_TARGET_RETRY_RATE:
        failures.append(
            "retry rate exceeded target: "
            f"{report.reliability.retry_rate:.6f} > {PERF_TARGET_RETRY_RATE:.6f}"
        )
    if report.reliability.failed_operations > PERF_TARGET_MAX_FAILED_OPERATIONS:
        failures.append(
            "failed operation count exceeded target: "
            f"{report.reliability.failed_operations} > {PERF_TARGET_MAX_FAILED_OPERATIONS}"
        )
    if report.reliability.retries_executed > PERF_TARGET_MAX_RETRIES:
        failures.append(
            "retry count exceeded target: "
            f"{report.reliability.retries_executed} > {PERF_TARGET_MAX_RETRIES}"
        )
    return failures


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="World-bridge runtime benchmark")
    parser.add_argument("--sessions", type=int, default=PERF_DEFAULT_SESSION_COUNT)
    parser.add_argument("--commands-per-session", type=int, default=PERF_DEFAULT_COMMANDS_PER_SESSION)
    parser.add_argument("--joints-per-command", type=int, default=PERF_DEFAULT_JOINTS_PER_COMMAND)
    parser.add_argument(
        "--scenario-updates-per-session",
        type=int,
        default=PERF_DEFAULT_SCENARIO_UPDATES_PER_SESSION,
    )
    parser.add_argument("--assert-targets", action="store_true")
    parser.add_argument("--json-output", type=str, default=None)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = run_world_bridge_benchmark(
        sessions=args.sessions,
        commands_per_session=args.commands_per_session,
        joints_per_command=args.joints_per_command,
        scenario_updates_per_session=args.scenario_updates_per_session,
    )
    _print_summary(report)

    if args.json_output:
        output_path = Path(args.json_output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(asdict(report), indent=2), encoding="utf-8")
        print(f"json_report={output_path}")

    if not args.assert_targets:
        return 0
    failures = _assert_targets(report)
    for failure in failures:
        print(f"[error] {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
