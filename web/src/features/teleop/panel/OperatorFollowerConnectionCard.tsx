import type { OperatorFollowerTargetOption } from "@/features/teleop/panel/operatorFollowerConnectionPolicy";
import {
  OperatorCalibrationFileEditControls,
  type OperatorCalibrationFileEditMotionRow,
} from "@/features/teleop/panel/OperatorCalibrationFileEditControls";
import type { OperatorLeRobotCalibrationOption } from "@/features/teleop/panel/operatorLeRobotCalibrationCatalog";
import { formatOperatorFollowerEnvConfigRef } from "@/features/teleop/panel/operatorFollowerEnvConfig";
import { cn } from "@/shared/lib/utils";

type OperatorFollowerEnvConfigView = {
  configRef: string | null;
  error: string | null;
  isOpening: boolean;
  onOpen: () => void;
};

type OperatorFollowerConnectionView = {
  connectDisabled: boolean;
  issue: string | null;
  isBusy: boolean;
  isConnected: boolean;
  isDisconnectAvailable: boolean;
  motionReady: boolean;
  motionSafetyLabel: string;
  onToggleConnection: () => void;
};

type OperatorFollowerCalibrationView = {
  available: boolean;
  command: string | null;
  isStarting: boolean;
  message: string | null;
  required: boolean;
  onStart: () => void;
};

type OperatorFollowerCalibrationFileEditView = {
  available: boolean;
  disabled: boolean;
  active: boolean;
  busy: boolean;
  message: string | null;
  jointCount: number;
  motionRows: OperatorCalibrationFileEditMotionRow[];
  onStart: () => void;
  onOpenFile: () => void;
  onCancel: () => void;
};

type OperatorFollowerCalibrationSourceSelectionView = {
  error: string | null;
  options: OperatorLeRobotCalibrationOption[];
  selectedSourceId: string | null;
  showAll: boolean;
  onSelectSource: (sourceId: string) => void;
  onToggleShowAll: () => void;
};

type OperatorFollowerTargetSelectionView = {
  disabled: boolean;
  options: OperatorFollowerTargetOption[];
  selectedProfileId: string;
  onSelectProfile: (profileId: string) => void;
};

type OperatorFollowerConnectionCardProps = {
  buttonClassName: string;
  calibration: OperatorFollowerCalibrationView;
  calibrationFileEdit: OperatorFollowerCalibrationFileEditView;
  calibrationSourceSelection: OperatorFollowerCalibrationSourceSelectionView;
  connection: OperatorFollowerConnectionView;
  envConfig: OperatorFollowerEnvConfigView;
  targetSelection: OperatorFollowerTargetSelectionView;
};

const findSelectedFollowerTarget = (
  targetSelection: OperatorFollowerTargetSelectionView,
): OperatorFollowerTargetOption | null =>
  targetSelection.options.find(
    (target) => target.profileId === targetSelection.selectedProfileId,
  ) ??
  targetSelection.options[0] ??
  null;

const OperatorFollowerTargetDetails = ({
  selectedTarget,
  targetSelection,
}: {
  selectedTarget: OperatorFollowerTargetOption | null;
  targetSelection: OperatorFollowerTargetSelectionView;
}) => {
  const selectedStatusVisible =
    selectedTarget &&
    selectedTarget.status !== "available" &&
    selectedTarget.status !== "selected";
  const notableTargets = targetSelection.options.filter(
    (target) => target.profileId !== selectedTarget?.profileId,
  );

  return (
    <>
      {selectedTarget ? (
        <div className="space-y-0.5">
          <div className="truncate font-mono text-foreground">
            {selectedTarget.label}
            {selectedStatusVisible ? (
              <span className="text-muted-foreground">
                {" "}
                ({selectedTarget.statusLabel})
              </span>
            ) : null}
          </div>
          {selectedTarget.detailLines.map((line) => (
            <div key={line} className="truncate font-mono text-muted-foreground">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div>No arm targets detected.</div>
      )}

      {notableTargets.length > 0 ? (
        <div className="mt-1 space-y-0.5 border-t border-border/20 pt-1">
          {notableTargets.map((target) => (
            <div
              key={target.profileId}
              className="truncate font-mono text-muted-foreground"
            >
              {target.label}
              {target.status !== "available" ? (
                <span> ({target.statusLabel})</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
};

const OperatorFollowerCalibrationSourceSelector = ({
  buttonClassName,
  selection,
}: {
  buttonClassName: string;
  selection: OperatorFollowerCalibrationSourceSelectionView;
}) => {
  const selectedOption =
    selection.options.find((option) => option.id === selection.selectedSourceId) ??
    null;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-1.5">
        <select
          className="h-7 min-w-0 rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Follower calibration source"
          disabled={selection.options.length === 0}
          value={selection.selectedSourceId ?? ""}
          onChange={(event) => selection.onSelectSource(event.target.value)}
        >
          {selection.options.length === 0 ? (
            <option value="">Gateway env source</option>
          ) : (
            selection.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.optionLabel}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className={cn(buttonClassName, "h-7 px-1.5")}
          onClick={selection.onToggleShowAll}
        >
          {selection.showAll ? "Safe" : "All"}
        </button>
      </div>

      {selectedOption ? (
        <div
          className={cn(
            "truncate font-mono",
            selectedOption.compatibility === "advanced"
              ? "text-amber-200"
              : "text-muted-foreground",
          )}
          title={selectedOption.detailLines.join("\n")}
        >
          {selectedOption.compatibilityLabel}: {selectedOption.label}
        </div>
      ) : (
        <div className="text-muted-foreground">
          Uses the calibration source from Gateway env.
        </div>
      )}

      {selection.error ? (
        <div className="text-amber-200">{selection.error}</div>
      ) : null}
    </div>
  );
};

export const OperatorFollowerConnectionCard = ({
  buttonClassName,
  calibration,
  calibrationFileEdit,
  calibrationSourceSelection,
  connection,
  envConfig,
  targetSelection,
}: OperatorFollowerConnectionCardProps) => {
  const envConfigLabel = formatOperatorFollowerEnvConfigRef(envConfig.configRef);
  const selectedTarget = findSelectedFollowerTarget(targetSelection);
  const selectedTargetBlockedByLeader = selectedTarget?.status === "used_as_leader";
  const shortIssue = selectedTargetBlockedByLeader
    ? "Disconnect Leader first."
    : connection.issue;

  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2 text-[10px] text-muted-foreground">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-medium text-foreground">Follower</div>
        <div className="font-mono text-muted-foreground">
          {targetSelection.options.length} targets
        </div>
      </div>

      <div className="border-t border-border/30 pt-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">Detected targets</span>
          <span className="font-mono text-muted-foreground">
            {targetSelection.options.length || "none"}
          </span>
        </div>

        <OperatorFollowerTargetDetails
          selectedTarget={selectedTarget}
          targetSelection={targetSelection}
        />

        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_88px] items-center gap-1.5">
          <select
            className="h-7 min-w-0 rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Follower target"
            disabled={targetSelection.disabled || targetSelection.options.length === 0}
            value={selectedTarget?.profileId ?? ""}
            onChange={(event) => targetSelection.onSelectProfile(event.target.value)}
          >
            {targetSelection.options.length === 0 ? (
              <option value="">No arm targets</option>
            ) : (
              targetSelection.options.map((target) => (
                <option
                  key={target.profileId}
                  value={target.profileId}
                  disabled={target.status === "used_as_leader"}
                >
                  {target.optionLabel}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className={cn(buttonClassName, "h-7 px-2")}
            disabled={connection.connectDisabled}
            title={connection.connectDisabled ? (shortIssue ?? undefined) : undefined}
            onClick={connection.onToggleConnection}
          >
            {connection.isBusy
              ? "Connecting"
              : connection.isConnected && connection.isDisconnectAvailable
                ? "Disconnect"
                : "Connect"}
          </button>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-[68px_minmax(0,1fr)_88px] items-center gap-1.5">
        <div className="font-medium text-foreground">Gateway env</div>
        <div
          className="truncate font-mono text-muted-foreground"
          title={envConfig.configRef ?? "Open robot gateway config file"}
        >
          {envConfigLabel}
        </div>
        <button
          type="button"
          className={cn(buttonClassName, "h-7 px-1.5")}
          disabled={envConfig.isOpening}
          title={envConfig.configRef ?? "Open robot gateway config file"}
          onClick={envConfig.onOpen}
        >
          {envConfig.isOpening ? "Opening" : "Config"}
        </button>
      </div>

      {shortIssue ? (
        <div className="mt-1 text-amber-200">{shortIssue}</div>
      ) : envConfig.error ? (
        <div className="mt-1 text-amber-200">{envConfig.error}</div>
      ) : null}

      {connection.isConnected || calibration.available ? (
        <div className="mt-1 space-y-1 border-t border-border/20 pt-1">
          <div
            className={cn(
              "grid items-center gap-1.5",
              calibrationFileEdit.available
                ? "grid-cols-[minmax(0,1fr)_88px_88px]"
                : "grid-cols-[minmax(0,1fr)_88px]",
            )}
          >
            <div
              className={cn(
                connection.motionReady && !calibration.required
                  ? "text-muted-foreground"
                  : "text-amber-200",
              )}
            >
              {connection.isConnected
                ? connection.motionSafetyLabel
                : "LeRobot will ask to use or redo calibration."}
            </div>
            {calibration.available ? (
              <button
                type="button"
                className={cn(buttonClassName, "h-7 px-1.5")}
                disabled={calibration.isStarting}
                onClick={calibration.onStart}
              >
                {calibration.isStarting ? "Opening" : "Calibrate"}
              </button>
            ) : null}
            {calibrationFileEdit.available ? (
              <button
                type="button"
                className={cn(buttonClassName, "h-7 px-1.5")}
                disabled={calibrationFileEdit.disabled}
                onClick={calibrationFileEdit.onStart}
              >
                Fix order
              </button>
            ) : null}
          </div>

          {calibration.available ? (
            <OperatorFollowerCalibrationSourceSelector
              buttonClassName={buttonClassName}
              selection={calibrationSourceSelection}
            />
          ) : null}

          {calibrationFileEdit.active ? (
            <OperatorCalibrationFileEditControls
              buttonClassName={buttonClassName}
              message={calibrationFileEdit.message}
              jointCount={calibrationFileEdit.jointCount}
              motionRows={calibrationFileEdit.motionRows}
              busy={calibrationFileEdit.busy}
              onOpenFile={calibrationFileEdit.onOpenFile}
              onCancel={calibrationFileEdit.onCancel}
            />
          ) : null}
        </div>
      ) : null}

      {calibration.command ? (
        <div
          className="mt-1 truncate font-mono text-muted-foreground"
          title={calibration.command}
        >
          {calibration.command}
        </div>
      ) : null}

      {calibration.message ? (
        <div className="mt-1 text-muted-foreground">{calibration.message}</div>
      ) : null}
    </div>
  );
};
