import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";
import type { OperatorCalibrationFileEditMotorRow } from "@/features/teleop/panel/useOperatorCalibrationFileEdit";
import {
  OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_MIN_MOTION_RAD,
  OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_MOTION_WINDOW_MS,
  OPERATOR_LIVE_JOINT_TELEMETRY_PRECISION,
} from "@/features/teleop/params/operatorTeleopParams";

export type OperatorCalibrationFileEditMotionRow =
  OperatorCalibrationFileEditMotorRow & {
    positionRad: number | null;
    targetJointName: string | null;
  };

type OperatorCalibrationFileEditControlsProps = {
  buttonClassName: string;
  message: string | null;
  jointCount: number;
  motionRows: OperatorCalibrationFileEditMotionRow[];
  busy: boolean;
  onOpenFile: () => void;
  onCancel: () => void;
};

type OperatorCalibrationMotionSample = {
  sampledAtMs: number;
  positionRad: number;
};

const formatCalibrationMotorAngle = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return "0.000";
  }
  return value.toFixed(OPERATOR_LIVE_JOINT_TELEMETRY_PRECISION);
};

const buildCalibrationMotionRowKey = (
  row: OperatorCalibrationFileEditMotionRow,
): string => row.jointName;

const compareCalibrationMotionRowsByMotorId = (
  left: OperatorCalibrationFileEditMotionRow,
  right: OperatorCalibrationFileEditMotionRow,
): number => {
  if (left.motorId === null && right.motorId === null) {
    return left.jointName.localeCompare(right.jointName);
  }
  if (left.motorId === null) {
    return 1;
  }
  if (right.motorId === null) {
    return -1;
  }
  return left.motorId - right.motorId || left.jointName.localeCompare(right.jointName);
};

const computeCalibrationMotionRange = (
  samples: readonly OperatorCalibrationMotionSample[],
): number => {
  if (samples.length === 0) {
    return 0;
  }
  const positions = samples.map((sample) => sample.positionRad);
  return Math.max(...positions) - Math.min(...positions);
};

export const OperatorCalibrationFileEditControls = ({
  buttonClassName,
  message,
  jointCount,
  motionRows,
  busy,
  onOpenFile,
  onCancel,
}: OperatorCalibrationFileEditControlsProps) => {
  const [checkedRowKeys, setCheckedRowKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [mostActiveRowKey, setMostActiveRowKey] = useState<string | null>(null);
  const motionSamplesByRowKeyRef = useRef(
    new Map<string, OperatorCalibrationMotionSample[]>(),
  );
  const sortedMotionRows = useMemo(
    () => [...motionRows].sort(compareCalibrationMotionRowsByMotorId),
    [motionRows],
  );
  const visibleRowKeys = useMemo(
    () => new Set(sortedMotionRows.map(buildCalibrationMotionRowKey)),
    [sortedMotionRows],
  );

  useEffect(() => {
    const sampledAtMs = Date.now();
    const oldestSampleAtMs =
      sampledAtMs - OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_MOTION_WINDOW_MS;
    let nextMostActiveRowKey: string | null = null;
    let nextMostActiveRange = OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_MIN_MOTION_RAD;

    for (const row of sortedMotionRows) {
      const rowKey = buildCalibrationMotionRowKey(row);
      const previousSamples =
        motionSamplesByRowKeyRef.current.get(rowKey) ?? [];
      const retainedSamples = previousSamples.filter(
        (sample) => sample.sampledAtMs >= oldestSampleAtMs,
      );
      if (row.positionRad !== null && Number.isFinite(row.positionRad)) {
        retainedSamples.push({
          sampledAtMs,
          positionRad: row.positionRad,
        });
      }
      motionSamplesByRowKeyRef.current.set(rowKey, retainedSamples);
      const motionRange = computeCalibrationMotionRange(retainedSamples);
      if (motionRange > nextMostActiveRange) {
        nextMostActiveRange = motionRange;
        nextMostActiveRowKey = rowKey;
      }
    }

    for (const rowKey of motionSamplesByRowKeyRef.current.keys()) {
      if (!visibleRowKeys.has(rowKey)) {
        motionSamplesByRowKeyRef.current.delete(rowKey);
      }
    }

    setMostActiveRowKey(nextMostActiveRowKey);
  }, [sortedMotionRows, visibleRowKeys]);

  const toggleRowChecked = (row: OperatorCalibrationFileEditMotionRow) => {
    const rowKey = buildCalibrationMotionRowKey(row);
    setCheckedRowKeys((currentKeys) => {
      const nextKeys = new Set(
        [...currentKeys].filter((key) => visibleRowKeys.has(key)),
      );
      if (nextKeys.has(rowKey)) {
        nextKeys.delete(rowKey);
      } else {
        nextKeys.add(rowKey);
      }
      return nextKeys;
    });
  };

  return (
    <div className="rounded border border-border/60 bg-background/80 p-1.5 text-[10px] text-foreground">
      <div>{message ?? "Open the calibration file and switch the motor entries."}</div>
      <div className="mt-1 font-mono text-muted-foreground">
        {jointCount} motor{jointCount === 1 ? "" : "s"} in this calibration
      </div>
      {sortedMotionRows.length > 0 ? (
        <div className="mt-1 max-h-36 overflow-auto rounded border border-border/40 font-mono">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="border-b border-border/30 text-muted-foreground">
                <th
                  scope="col"
                  className="px-1.5 py-0.5 text-left font-normal"
                >
                  OK
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-0.5 text-left font-normal"
                >
                  ID
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-0.5 text-right font-normal"
                >
                  Angle
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-0.5 text-left font-normal"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-0.5 text-left font-normal"
                >
                  URDF joint
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedMotionRows.map((row) => {
                const rowKey = buildCalibrationMotionRowKey(row);
                const checked = checkedRowKeys.has(rowKey);
                const mostActive = rowKey === mostActiveRowKey;
                return (
                  <tr
                    key={rowKey}
                    data-moving-most={mostActive ? "true" : undefined}
                    className={cn(
                      "border-b border-border/20 last:border-0",
                      mostActive && !checked && "bg-muted/50",
                      checked && "bg-emerald-500/10 text-emerald-200",
                    )}
                  >
                    <td className="px-1.5 py-0.5 text-left">
                      <button
                        type="button"
                        className={cn(
                          "h-5 w-7 rounded border border-border/50 text-[10px]",
                          checked
                            ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-200"
                            : "text-muted-foreground hover:bg-muted/45",
                        )}
                        aria-label={`Mark ${row.jointName} as OK`}
                        aria-pressed={checked}
                        onClick={() => toggleRowChecked(row)}
                      >
                        {checked ? "✓" : "OK"}
                      </button>
                    </td>
                    <td
                      className="px-1.5 py-0.5 text-left"
                      aria-label={`Motor ID for ${row.jointName}`}
                    >
                      {row.motorId ?? ""}
                    </td>
                    <td className="px-1.5 py-0.5 text-right">
                      {formatCalibrationMotorAngle(row.positionRad)}
                    </td>
                    <td
                      className="max-w-28 truncate px-1.5 py-0.5"
                      title={row.jointName}
                    >
                      {row.jointName}
                    </td>
                    <td
                      className="max-w-32 truncate px-1.5 py-0.5"
                      title={row.targetJointName ?? ""}
                    >
                      {row.targetJointName ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="text-muted-foreground">Saved changes reload every second.</div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <button
          type="button"
          className={cn(buttonClassName, "h-7 px-2")}
          disabled={busy}
          onClick={onOpenFile}
        >
          {busy ? "Opening" : "Open file"}
        </button>
        <button
          type="button"
          className={cn(buttonClassName, "h-7 px-2")}
          disabled={busy}
          onClick={onCancel}
        >
          Close
        </button>
      </div>
    </div>
  );
};
