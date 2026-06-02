import { useCallback, useEffect, useRef, useState } from "react";

import {
  OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
  openOperatorLeRobotCalibrationFile,
  syncOperatorLeRobotCalibrationFile,
  type OperatorLeaderDevice,
  type OperatorLeRobotCalibrationCatalog,
  type OperatorLeRobotCalibrationCatalogEntry,
  type OperatorLeRobotCalibrationFileSyncResult,
  type OperatorLeRobotCalibrationSource,
} from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";
import {
  OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_SESSION_ID_INCREMENT,
  OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
  OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INCREMENT,
  OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_INTERVAL_MS,
  OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
} from "@/features/teleop/params/operatorTeleopParams";
import { resolveOperatorCalibrationFileEditGuidedJointNames } from "@/features/teleop/panel/operatorCalibrationFileEditJoints";

type OperatorCalibrationFileEditRole = "leader" | "follower";

export type OperatorCalibrationFileEditMotorRow = {
  jointName: string;
  motorId: number | null;
};

export type OperatorCalibrationFileEditMapping = {
  jointNames: string[];
  motorIds: number[];
};

export type OperatorCalibrationFileEditSession = {
  sessionId: number;
  role: OperatorCalibrationFileEditRole;
  targetKey: string;
  calibrationSource: OperatorLeRobotCalibrationSource;
  jointNames: string[];
  motorRows: OperatorCalibrationFileEditMotorRow[];
  syncedMapping: OperatorCalibrationFileEditMapping;
  syncedZeroPositionsRad: Record<string, number>;
  syncRevision: number;
  lastSyncedMtimeNs: number | null;
  leaderPort: string | null;
  leaderMotorIds: number[];
  leaderMotorModel: string | null;
  busy: boolean;
  message: string | null;
};

type UseOperatorCalibrationFileEditParams = {
  lerobotCalibrationCatalog: OperatorLeRobotCalibrationCatalog;
  followerHardwareProfile: OperatorTeleopProfile | null;
  selectedFollowerHardwareDeviceKey: string | null;
  selectedFollowerCalibrationCatalogEntry: OperatorLeRobotCalibrationCatalogEntry | null;
  onStatusMessage: (message: string) => void;
};

export type UseOperatorCalibrationFileEditResult = {
  session: OperatorCalibrationFileEditSession | null;
  startLeaderFileEdit: (
    leader: OperatorLeaderDevice,
    controlPartId: string | null,
  ) => Promise<void>;
  startFollowerFileEdit: () => Promise<void>;
  openCalibrationFile: () => Promise<void>;
  closeCalibrationFileEdit: () => void;
};

const buildCalibrationFileEditReadyMessage = (jointNames: readonly string[]): string =>
  jointNames.length > 0
    ? `Open the calibration file and switch entries for ${jointNames.length} motor${jointNames.length === 1 ? "" : "s"}.`
    : "Calibration file edit target is no longer available.";

const buildCalibrationFileEditSource = (
  entry: OperatorLeRobotCalibrationCatalogEntry,
): OperatorLeRobotCalibrationSource => ({
  category: entry.category,
  profileId: entry.profileId,
  calibrationId: entry.calibrationId,
  calibrationDir: entry.calibrationDir,
  groupId: entry.groupId,
});

const buildCalibrationFileEditMapping = ({
  jointNames,
  motorIds,
}: {
  jointNames: readonly string[];
  motorIds: readonly number[];
}): OperatorCalibrationFileEditMapping => ({
  jointNames: [...jointNames],
  motorIds: [...motorIds],
});

const buildCalibrationFileEditZeroPositions = ({
  jointNames,
  zeroPositionsRad,
}: {
  jointNames: readonly string[];
  zeroPositionsRad: Readonly<Record<string, number>>;
}): Record<string, number> =>
  Object.fromEntries(
    jointNames.map((jointName) => [
      jointName,
      Number.isFinite(zeroPositionsRad[jointName])
        ? zeroPositionsRad[jointName]
        : OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
    ]),
  );

const buildMotorIdByJointName = (
  mapping: OperatorCalibrationFileEditMapping,
): Map<string, number | null> =>
  new Map<string, number | null>(
    mapping.jointNames.map((jointName, index) => [
      jointName,
      mapping.motorIds[index] ?? null,
    ]),
  );

const hasCalibrationFileEditMapping = (
  mapping: OperatorCalibrationFileEditMapping,
): boolean => mapping.jointNames.length > 0 && mapping.motorIds.length > 0;

const buildCalibrationFileEditMotorRows = ({
  jointNames,
  mapping,
}: {
  jointNames: readonly string[];
  mapping: OperatorCalibrationFileEditMapping;
}): OperatorCalibrationFileEditMotorRow[] => {
  const motorIdByJointName = buildMotorIdByJointName(mapping);
  return jointNames.map((jointName) => ({
    jointName,
    motorId: motorIdByJointName.get(jointName) ?? null,
  }));
};

const updateCalibrationFileEditMotorRowsFromMapping = ({
  currentMotorRows,
  mapping,
}: {
  currentMotorRows: readonly OperatorCalibrationFileEditMotorRow[];
  mapping: OperatorCalibrationFileEditMapping;
}): OperatorCalibrationFileEditMotorRow[] => {
  if (!hasCalibrationFileEditMapping(mapping)) {
    return [...currentMotorRows];
  }
  const motorIdByJointName = buildMotorIdByJointName(mapping);
  return currentMotorRows.map((row) =>
    motorIdByJointName.has(row.jointName)
      ? {
          ...row,
          motorId: motorIdByJointName.get(row.jointName) ?? null,
        }
      : { ...row },
  );
};

export const updateCalibrationFileEditMotorRowsFromSyncResult = ({
  currentMotorRows,
  result,
}: {
  currentMotorRows: readonly OperatorCalibrationFileEditMotorRow[];
  result: OperatorLeRobotCalibrationFileSyncResult;
}): OperatorCalibrationFileEditMotorRow[] =>
  updateCalibrationFileEditMotorRowsFromMapping({
    currentMotorRows,
    mapping: buildCalibrationFileEditMapping(result),
  });

const resolveCalibrationFileEditSyncedMapping = (
  currentMapping: OperatorCalibrationFileEditMapping,
  syncedMapping: OperatorCalibrationFileEditMapping,
): OperatorCalibrationFileEditMapping => {
  return hasCalibrationFileEditMapping(syncedMapping)
    ? syncedMapping
    : currentMapping;
};

export const findCalibrationCatalogEntryForLeaderControlPart = (
  entries: readonly OperatorLeRobotCalibrationCatalogEntry[],
  controlPart: {
    calibrationCategory: string | null;
    calibrationProfile: string | null;
    calibrationId: string | null;
    calibrationGroup: string | null;
  } | null,
): OperatorLeRobotCalibrationCatalogEntry | null => {
  if (
    !controlPart?.calibrationCategory ||
    !controlPart.calibrationProfile ||
    !controlPart.calibrationId
  ) {
    return null;
  }
  const groupId = controlPart.calibrationGroup ?? "all";
  return (
    entries.find(
      (entry) =>
        entry.category === controlPart.calibrationCategory &&
        entry.profileId === controlPart.calibrationProfile &&
        entry.calibrationId === controlPart.calibrationId &&
        entry.groupId === groupId,
    ) ?? null
  );
};

export const findCalibrationCatalogEntryBySource = (
  entries: readonly OperatorLeRobotCalibrationCatalogEntry[],
  source: OperatorLeRobotCalibrationSource | null,
): OperatorLeRobotCalibrationCatalogEntry | null =>
  source
    ? entries.find(
        (entry) =>
          entry.category === source.category &&
          entry.profileId === source.profileId &&
          entry.calibrationId === source.calibrationId &&
          entry.calibrationDir === source.calibrationDir &&
          entry.groupId === source.groupId,
      ) ?? null
    : null;

const resolveCalibrationFileEditJointNames = ({
  targetJointNames,
  catalogJointNames,
}: {
  targetJointNames: readonly string[];
  catalogJointNames: readonly string[];
}): string[] | null => {
  const jointNames = targetJointNames.filter((jointName) =>
    catalogJointNames.includes(jointName),
  );
  return jointNames.length === catalogJointNames.length ? jointNames : null;
};

export const useOperatorCalibrationFileEdit = ({
  lerobotCalibrationCatalog,
  followerHardwareProfile,
  selectedFollowerHardwareDeviceKey,
  selectedFollowerCalibrationCatalogEntry,
  onStatusMessage,
}: UseOperatorCalibrationFileEditParams): UseOperatorCalibrationFileEditResult => {
  const [session, setSession] =
    useState<OperatorCalibrationFileEditSession | null>(null);
  const sessionRef = useRef<OperatorCalibrationFileEditSession | null>(null);
  const sessionIdRef = useRef(0);
  const mountedRef = useRef(true);
  const syncInFlightRef = useRef(false);

  const commitSession = useCallback(
    (nextSession: OperatorCalibrationFileEditSession | null) => {
      sessionRef.current = nextSession;
      if (mountedRef.current) {
        setSession(nextSession);
      }
    },
    [],
  );

  const syncCalibrationFileForSession = useCallback(
    async (currentSession: OperatorCalibrationFileEditSession) => {
      try {
        const result = await syncOperatorLeRobotCalibrationFile(
          {
            role: currentSession.role,
            calibrationSource: currentSession.calibrationSource,
            lastMtimeNs: currentSession.lastSyncedMtimeNs,
            leaderPort: currentSession.leaderPort,
            leaderMotorIds: currentSession.leaderMotorIds,
            leaderMotorModel: currentSession.leaderMotorModel,
          },
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
        if (sessionIdRef.current !== currentSession.sessionId) {
          return;
        }
        const syncedMapping = buildCalibrationFileEditMapping(result);
        const syncedZeroPositionsRad = buildCalibrationFileEditZeroPositions({
          jointNames: result.jointNames,
          zeroPositionsRad: result.zeroPositionsRad,
        });
        const message =
          result.changed && result.message ? result.message : currentSession.message;
        commitSession({
          ...currentSession,
          motorRows: updateCalibrationFileEditMotorRowsFromMapping({
            currentMotorRows: currentSession.motorRows,
            mapping: syncedMapping,
          }),
          syncedMapping: resolveCalibrationFileEditSyncedMapping(
            currentSession.syncedMapping,
            syncedMapping,
          ),
          syncedZeroPositionsRad:
            Object.keys(syncedZeroPositionsRad).length > 0
              ? syncedZeroPositionsRad
              : currentSession.syncedZeroPositionsRad,
          syncRevision: result.changed
            ? currentSession.syncRevision +
              OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INCREMENT
            : currentSession.syncRevision,
          lastSyncedMtimeNs: result.mtimeNs,
          message,
        });
        if (result.changed && message) {
          onStatusMessage(message);
        }
      } catch (error) {
        if (sessionIdRef.current !== currentSession.sessionId) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Could not sync calibration file.";
        commitSession({
          ...currentSession,
          message,
        });
      }
    },
    [commitSession, onStatusMessage],
  );

  const openCalibrationFileForSession = useCallback(
    async (currentSession: OperatorCalibrationFileEditSession) => {
      if (currentSession.busy) {
        return;
      }
      commitSession({
        ...currentSession,
        busy: true,
        message: "Opening calibration file.",
      });
      try {
        const result = await openOperatorLeRobotCalibrationFile(
          currentSession.calibrationSource,
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
        if (sessionIdRef.current !== currentSession.sessionId) {
          return;
        }
        const message =
          result.message ||
          (result.opened
            ? "Opened LeRobot calibration file."
            : `Open ${result.path} on the robot gateway machine.`);
        commitSession({
          ...currentSession,
          busy: false,
          message,
        });
        onStatusMessage(message);
        void syncCalibrationFileForSession({
          ...currentSession,
          busy: false,
          message,
        });
      } catch (error) {
        if (sessionIdRef.current !== currentSession.sessionId) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Could not open calibration file.";
        commitSession({
          ...currentSession,
          busy: false,
          message,
        });
        onStatusMessage(message);
      }
    },
    [commitSession, onStatusMessage, syncCalibrationFileForSession],
  );

  const startLeaderFileEdit = useCallback(
    async (leader: OperatorLeaderDevice, controlPartId: string | null) => {
      const controlPart =
        leader.controlParts.find((part) => part.id === controlPartId) ?? null;
      const catalogEntry = findCalibrationCatalogEntryForLeaderControlPart(
        lerobotCalibrationCatalog.entries,
        controlPart,
      );
      if (!controlPart || !catalogEntry) {
        onStatusMessage("Calibration file not found for this target.");
        return;
      }
      const jointNames = resolveCalibrationFileEditJointNames({
        targetJointNames: controlPart.jointNames,
        catalogJointNames: catalogEntry.jointNames,
      });
      if (!jointNames) {
        onStatusMessage("Calibration file edit needs the full arm joint list.");
        return;
      }
      const guidedJointNames =
        resolveOperatorCalibrationFileEditGuidedJointNames(jointNames);
      const calibrationMapping = buildCalibrationFileEditMapping(catalogEntry);
      const zeroPositionsRad = buildCalibrationFileEditZeroPositions(catalogEntry);
      const nextSessionId =
        sessionIdRef.current +
        OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_SESSION_ID_INCREMENT;
      sessionIdRef.current = nextSessionId;
      const nextSession: OperatorCalibrationFileEditSession = {
        sessionId: nextSessionId,
        role: "leader",
        targetKey: leader.identityKey,
        calibrationSource: buildCalibrationFileEditSource(catalogEntry),
        jointNames: guidedJointNames,
        motorRows: buildCalibrationFileEditMotorRows({
          jointNames: guidedJointNames,
          mapping: calibrationMapping,
        }),
        syncedMapping: calibrationMapping,
        syncedZeroPositionsRad: zeroPositionsRad,
        syncRevision: OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
        lastSyncedMtimeNs: null,
        leaderPort: leader.path,
        leaderMotorIds: controlPart.motorIds,
        leaderMotorModel: controlPart.motorModel,
        busy: false,
        message: buildCalibrationFileEditReadyMessage(guidedJointNames),
      };
      commitSession(nextSession);
      void openCalibrationFileForSession(nextSession);
    },
    [
      commitSession,
      lerobotCalibrationCatalog.entries,
      onStatusMessage,
      openCalibrationFileForSession,
    ],
  );

  const startFollowerFileEdit = useCallback(async () => {
    if (!followerHardwareProfile || !selectedFollowerCalibrationCatalogEntry) {
      onStatusMessage("Calibration file not found for this follower target.");
      return;
    }
    const jointNames = resolveCalibrationFileEditJointNames({
      targetJointNames: followerHardwareProfile.controlledJointNames,
      catalogJointNames: selectedFollowerCalibrationCatalogEntry.jointNames,
    });
    if (!jointNames) {
      onStatusMessage(
        "Calibration file edit needs follower joint names to match the calibration file.",
      );
      return;
    }
    const guidedJointNames =
      resolveOperatorCalibrationFileEditGuidedJointNames(jointNames);
    const calibrationMapping = buildCalibrationFileEditMapping(
      selectedFollowerCalibrationCatalogEntry,
    );
    const zeroPositionsRad = buildCalibrationFileEditZeroPositions(
      selectedFollowerCalibrationCatalogEntry,
    );
    const nextSessionId =
      sessionIdRef.current +
      OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_SESSION_ID_INCREMENT;
    sessionIdRef.current = nextSessionId;
    const nextSession: OperatorCalibrationFileEditSession = {
      sessionId: nextSessionId,
      role: "follower",
      targetKey:
        selectedFollowerHardwareDeviceKey || followerHardwareProfile.id,
      calibrationSource: buildCalibrationFileEditSource(
        selectedFollowerCalibrationCatalogEntry,
      ),
      jointNames: guidedJointNames,
      motorRows: buildCalibrationFileEditMotorRows({
        jointNames: guidedJointNames,
        mapping: calibrationMapping,
      }),
      syncedMapping: calibrationMapping,
      syncedZeroPositionsRad: zeroPositionsRad,
      syncRevision: OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
      lastSyncedMtimeNs: null,
      leaderPort: null,
      leaderMotorIds: [],
      leaderMotorModel: null,
      busy: false,
      message: buildCalibrationFileEditReadyMessage(guidedJointNames),
    };
    commitSession(nextSession);
    void openCalibrationFileForSession(nextSession);
  }, [
    commitSession,
    followerHardwareProfile,
    onStatusMessage,
    openCalibrationFileForSession,
    selectedFollowerCalibrationCatalogEntry,
    selectedFollowerHardwareDeviceKey,
  ]);

  const openCalibrationFile = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      return;
    }
    await openCalibrationFileForSession(currentSession);
  }, [openCalibrationFileForSession]);

  const closeCalibrationFileEdit = useCallback(() => {
    sessionIdRef.current +=
      OPERATOR_LEROBOT_CALIBRATION_FILE_EDIT_SESSION_ID_INCREMENT;
    commitSession(null);
  }, [commitSession]);

  const activeSessionId = session?.sessionId ?? null;

  useEffect(() => {
    if (activeSessionId === null) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      const currentSession = sessionRef.current;
      if (!currentSession || currentSession.busy || syncInFlightRef.current) {
        return;
      }
      syncInFlightRef.current = true;
      void syncCalibrationFileForSession(currentSession).finally(() => {
        syncInFlightRef.current = false;
      });
    }, OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [activeSessionId, syncCalibrationFileForSession]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  return {
    session,
    startLeaderFileEdit,
    startFollowerFileEdit,
    openCalibrationFile,
    closeCalibrationFileEdit,
  };
};
