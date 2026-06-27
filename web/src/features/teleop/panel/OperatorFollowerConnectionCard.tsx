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

type OperatorFollowerDirectTeleopView = {
  available: boolean;
  busy: boolean;
  disabled: boolean;
  issue: string | null;
  running: boolean;
  statusLabel: string;
  detailLines: readonly string[];
  onStart: () => void;
  onStop: () => void;
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

type OperatorFollowerDetectedHardwareTarget = {
  id: string;
  label: string;
  detailLines: readonly string[];
};

type OperatorFollowerCameraView = {
  count: number;
  selectedLabel: string | null;
  statusLabel: string;
  detailLines: readonly string[];
};

type OperatorFollowerHardwareDetectionView = {
  requested: boolean;
  resolved: boolean;
  error: string | null;
  targets: readonly OperatorFollowerDetectedHardwareTarget[];
  onScan: () => void;
};

type OperatorFollowerConnectionCardProps = {
  buttonClassName: string;
  calibration: OperatorFollowerCalibrationView;
  calibrationFileEdit: OperatorFollowerCalibrationFileEditView;
  calibrationSourceSelection: OperatorFollowerCalibrationSourceSelectionView;
  camera?: OperatorFollowerCameraView;
  connection: OperatorFollowerConnectionView;
  directTeleop?: OperatorFollowerDirectTeleopView;
  envConfig: OperatorFollowerEnvConfigView;
  hardwareDetection?: OperatorFollowerHardwareDetectionView;
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

function formatFollowerRobotType(
  selectedTarget: OperatorFollowerTargetOption | null,
): string | null {
  if (selectedTarget?.robotType) return selectedTarget.robotType;
  const profileId = selectedTarget?.profileId.trim() ?? "";
  if (!profileId) return null;
  return profileId.replace(/_joint_jog$/u, "");
}

function formatFollowerConnectionStatus({
  connection,
  selectedTarget,
  issue,
}: {
  connection: OperatorFollowerConnectionView;
  selectedTarget: OperatorFollowerTargetOption | null;
  issue: string | null;
}): string {
  if (connection.isConnected) return "Using";
  if (selectedTarget?.setupOnly && connection.isBusy) return "Applying";
  if (connection.isBusy) return "Connecting";
  if (issue) return "Blocked";
  if (selectedTarget?.setupOnly) return "Setup";
  if (selectedTarget) return "Ready";
  return "No target";
}

const OperatorFollowerTargetDetails = ({
  selectedTarget,
  targetSelection,
}: {
  selectedTarget: OperatorFollowerTargetOption | null;
  targetSelection: OperatorFollowerTargetSelectionView;
}) => {
  const notableTargets = targetSelection.options.filter(
    (target) => target.profileId !== selectedTarget?.profileId,
  );
  if (notableTargets.length === 0) return null;

  return (
    <div className="space-y-0.5 border-t border-border/20 pt-1">
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
  );
};

const OperatorFollowerHardwareDetection = ({
  buttonClassName,
  detection,
}: {
  buttonClassName: string;
  detection: OperatorFollowerHardwareDetectionView;
}) => {
  return (
    <div className="rounded border border-border/25 bg-background/30 p-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Detected targets</span>
        <div className="flex items-center gap-1">
          {!detection.resolved || detection.error ? (
            <span className="font-mono text-foreground">
              {!detection.requested
                ? "Idle"
                : !detection.resolved
                  ? "Scanning"
                  : "Error"}
            </span>
          ) : null}
          <button
            type="button"
            className={cn(buttonClassName, "h-6 px-1.5")}
            onClick={detection.onScan}
          >
            {detection.requested ? "Rescan" : "Scan"}
          </button>
        </div>
      </div>

      {!detection.requested ? (
        <div>Click Scan to detect robot targets.</div>
      ) : !detection.resolved ? (
        <div>Scanning serial devices.</div>
      ) : detection.error ? (
        <div className="text-amber-200">{detection.error}</div>
      ) : detection.targets.length > 0 ? (
        <div className="space-y-1">
          <div className="font-mono text-muted-foreground">
            {detection.targets.length} detected
          </div>
          {detection.targets.map((target) => (
            <div key={target.id} className="space-y-0.5">
              <div className="truncate font-mono text-foreground">
                {target.label}
              </div>
              {target.detailLines.map((line) => (
                <div
                  key={line}
                  className="truncate font-mono text-muted-foreground"
                  title={line}
                >
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div>No LeRobot robot targets detected.</div>
      )}
    </div>
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
  camera,
  connection,
  directTeleop,
  envConfig,
  hardwareDetection,
  targetSelection,
}: OperatorFollowerConnectionCardProps) => {
  const envConfigLabel = formatOperatorFollowerEnvConfigRef(envConfig.configRef);
  const selectedTarget = findSelectedFollowerTarget(targetSelection);
  const selectedTargetBlockedByLeader = selectedTarget?.status === "used_as_leader";
  const shortIssue = selectedTargetBlockedByLeader
    ? "Disconnect Leader first."
    : connection.issue;
  const selectedCalibrationOption =
    calibrationSourceSelection.options.find(
      (option) => option.id === calibrationSourceSelection.selectedSourceId,
    ) ?? null;
  const robotType = formatFollowerRobotType(selectedTarget);
  const connectionStatus = formatFollowerConnectionStatus({
    connection,
    selectedTarget,
    issue: shortIssue,
  });
  const setupTargetSelected = selectedTarget?.setupOnly === true;
  const cardInUse = connection.isConnected;
  const cameraSummary =
    camera && camera.count > 0
      ? `${camera.count} camera${camera.count === 1 ? "" : "s"}`
      : "No camera";
  const noTargetMessage =
    camera && camera.count > 0
      ? "Camera detected, but no LeRobot robot target."
      : "No LeRobot robot target.";

  return (
    <div
      className={cn(
        "rounded-md border p-2 text-[10px] text-muted-foreground",
        cardInUse
          ? "border-emerald-500/55 bg-emerald-500/10"
          : "border-border/40 bg-background/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-medium text-foreground">Robot</div>
        <div
          className={cn(
            "font-mono",
            cardInUse
              ? "text-emerald-200"
              : shortIssue
                ? "text-amber-200"
                : "text-muted-foreground",
          )}
        >
          {connectionStatus}
        </div>
      </div>

      <div className="space-y-1 border-t border-border/30 pt-1">
        {hardwareDetection ? (
          <OperatorFollowerHardwareDetection
            buttonClassName={buttonClassName}
            detection={hardwareDetection}
          />
        ) : null}

        <div className="grid grid-cols-[72px_minmax(0,1fr)_88px] items-center gap-1.5">
          <div className="font-medium text-foreground">Config</div>
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
      </div>

      {envConfig.error ? (
        <div className="mt-1 text-amber-200">{envConfig.error}</div>
      ) : null}

      <div className="space-y-1 border-t border-border/30 pt-1">
        <div
          className={cn(
            "grid items-center gap-1.5",
            setupTargetSelected
              ? "grid-cols-[minmax(0,1fr)_96px]"
              : "grid-cols-[minmax(0,1fr)_76px_88px]",
          )}
        >
          <select
            className="h-7 min-w-0 rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Robot target"
            disabled={targetSelection.disabled || targetSelection.options.length === 0}
            value={selectedTarget?.profileId ?? ""}
            onChange={(event) => targetSelection.onSelectProfile(event.target.value)}
          >
            {targetSelection.options.length === 0 ? (
              <option value="">No robot target</option>
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
          {setupTargetSelected ? (
            <button
              type="button"
              className={cn(buttonClassName, "h-7 px-2")}
              disabled={connection.connectDisabled}
              title={
                connection.connectDisabled ? (shortIssue ?? undefined) : undefined
              }
              onClick={connection.onToggleConnection}
            >
              {connection.isBusy ? "Applying" : "Use target"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={cn(buttonClassName, "h-7 px-2")}
                disabled={connection.connectDisabled || connection.isConnected}
                title={
                  connection.connectDisabled ? (shortIssue ?? undefined) : undefined
                }
                onClick={connection.onToggleConnection}
              >
                {connection.isBusy ? "Connecting" : "Connect"}
              </button>
              <button
                type="button"
                className={cn(
                  buttonClassName,
                  "h-7 px-2",
                  connection.isConnected
                    ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
                    : "",
                )}
                disabled={
                  connection.isBusy ||
                  !connection.isConnected ||
                  !connection.isDisconnectAvailable
                }
                onClick={connection.onToggleConnection}
              >
                Disconnect
              </button>
            </>
          )}
        </div>

        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-1.5 gap-y-0.5 font-mono">
          <div className="text-muted-foreground">Target</div>
          <div className="truncate text-foreground">
            {selectedTarget?.label ?? "No robot target"}
          </div>
          <div className="text-muted-foreground">LeRobot</div>
          <div className="truncate text-foreground">
            {robotType ??
              (calibration.available ? "Configured robot" : "No robot profile")}
          </div>
          <div className="text-muted-foreground">Calibration</div>
          <div className="truncate text-foreground">
            {selectedCalibrationOption?.label ??
              (calibration.available ? "Gateway env source" : "Not available")}
          </div>
          <div className="text-muted-foreground">Camera</div>
          <div className="truncate text-foreground" title={camera?.statusLabel}>
            {camera?.selectedLabel
              ? `${camera.selectedLabel} · ${cameraSummary}`
              : cameraSummary}
          </div>
        </div>

        {selectedTarget ? (
          <div className="space-y-0.5">
            {selectedTarget.detailLines.map((line) => (
              <div key={line} className="truncate font-mono text-muted-foreground">
                {line}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">{noTargetMessage}</div>
        )}

        <OperatorFollowerTargetDetails
          selectedTarget={selectedTarget}
          targetSelection={targetSelection}
        />

        {camera && camera.detailLines.length > 0 ? (
          <div className="space-y-0.5">
            {camera.detailLines.map((line) => (
              <div
                key={line}
                className="truncate font-mono text-muted-foreground"
                title={line}
              >
                {line}
              </div>
            ))}
          </div>
        ) : null}

        {shortIssue ? (
          <div className="text-amber-200">{shortIssue}</div>
        ) : null}
      </div>

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

      {directTeleop?.available ? (
        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_88px] items-start gap-1.5 border-t border-border/20 pt-1">
          <div className="min-w-0 space-y-0.5">
            <div className="font-medium text-foreground">LeRobot direct teleop</div>
            <div
              className={cn(
                directTeleop.issue ? "text-amber-200" : "text-muted-foreground",
              )}
            >
              {directTeleop.issue ?? directTeleop.statusLabel}
            </div>
            {directTeleop.detailLines.length > 0 ? (
              <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                {directTeleop.detailLines.map((line) => (
                  <div key={line} className="truncate" title={line}>
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={cn(buttonClassName, "h-7 px-1.5")}
            disabled={
              directTeleop.busy ||
              (!directTeleop.running && directTeleop.disabled)
            }
            title={directTeleop.disabled ? (directTeleop.issue ?? undefined) : undefined}
            onClick={directTeleop.running ? directTeleop.onStop : directTeleop.onStart}
          >
            {directTeleop.busy
              ? "Working"
              : directTeleop.running
                ? "Stop direct"
                : "Start direct"}
          </button>
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
