import { useCallback, useEffect, useMemo, useState } from "react";

import {
  OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
  OPERATOR_HELPER_POLL_INTERVAL_MS,
  OPERATOR_OPENARM_LEADER_SIDES,
  OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  fetchOperatorLeRobotDirectTeleopStatus,
  startOperatorLeRobotDirectTeleop,
  stopOperatorLeRobotDirectTeleop,
  type OperatorLeRobotDirectTeleopLeaderRequest,
  type OperatorLeRobotDirectTeleopStatus,
} from "@/features/teleop/transport/operatorLeRobotDirectTeleopApi";
import type { OperatorCollaborationAuthorization } from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorLeaderTelemetryTarget } from "@/features/teleop/transport/operatorLeaderTelemetry";
import { startVisiblePageInterval } from "@/shared/lib/pageVisibility";

type OperatorLeRobotDirectTeleopLeaderResolution = {
  leader: OperatorLeRobotDirectTeleopLeaderRequest | null;
  issue: string | null;
};

type OperatorLeRobotDirectTeleopCardView = {
  available: true;
  busy: boolean;
  disabled: boolean;
  issue: string | null;
  running: boolean;
  statusLabel: string;
  onStart: () => void;
  onStop: () => void;
};

type UseOperatorLeRobotDirectTeleopParams = {
  available: boolean;
  followerConnected: boolean;
  leaderTargets: readonly OperatorLeaderTelemetryTarget[];
  baseUrl: string;
  authorization: OperatorCollaborationAuthorization | null;
  operatorId: string;
  onBeforeStart: () => void;
  onStatusMessage: (message: string) => void;
};

type UseOperatorLeRobotDirectTeleopResult = {
  running: boolean;
  card: OperatorLeRobotDirectTeleopCardView | undefined;
};

const buildLeRobotDirectTeleopLeaderRequest = (
  targets: readonly OperatorLeaderTelemetryTarget[],
): OperatorLeRobotDirectTeleopLeaderResolution => {
  const primaryTarget = targets[0] ?? null;
  if (!primaryTarget) {
    return { leader: null, issue: "Connect a leader first." };
  }
  if (!primaryTarget.calibrationProfile) {
    return { leader: null, issue: "Calibrate the leader first." };
  }
  if (
    primaryTarget.calibrationProfile === OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE
  ) {
    const leftTarget = targets.find(
      (target) =>
        target.side === OPERATOR_OPENARM_LEADER_SIDES.left ||
        target.calibrationGroup === OPERATOR_OPENARM_LEADER_SIDES.left,
    );
    const rightTarget = targets.find(
      (target) =>
        target.side === OPERATOR_OPENARM_LEADER_SIDES.right ||
        target.calibrationGroup === OPERATOR_OPENARM_LEADER_SIDES.right,
    );
    if (!leftTarget || !rightTarget) {
      return {
        leader: null,
        issue: "Connect left and right leaders first.",
      };
    }
    return {
      leader: {
        port: primaryTarget.path,
        portLeft: leftTarget.path,
        portRight: rightTarget.path,
        calibrationCategory: primaryTarget.calibrationCategory,
        calibrationProfile: primaryTarget.calibrationProfile,
        calibrationId: primaryTarget.calibrationId,
        calibrationGroup: primaryTarget.calibrationGroup,
      },
      issue: null,
    };
  }
  return {
    leader: {
      port: primaryTarget.path,
      calibrationCategory: primaryTarget.calibrationCategory,
      calibrationProfile: primaryTarget.calibrationProfile,
      calibrationId: primaryTarget.calibrationId,
      calibrationGroup: primaryTarget.calibrationGroup,
    },
    issue: null,
  };
};

export const useOperatorLeRobotDirectTeleop = ({
  available,
  followerConnected,
  leaderTargets,
  baseUrl,
  authorization,
  operatorId,
  onBeforeStart,
  onStatusMessage,
}: UseOperatorLeRobotDirectTeleopParams): UseOperatorLeRobotDirectTeleopResult => {
  const [status, setStatus] = useState<OperatorLeRobotDirectTeleopStatus | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const leaderResolution = useMemo(
    () => buildLeRobotDirectTeleopLeaderRequest(leaderTargets),
    [leaderTargets],
  );
  const running =
    status?.running === true ||
    status?.state === "running" ||
    status?.state === "stopping";

  useEffect(() => {
    if (!available || !followerConnected) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    const refreshDirectTeleopStatus = async () => {
      try {
        const nextStatus = await fetchOperatorLeRobotDirectTeleopStatus(
          baseUrl,
          "",
          authorization,
        );
        if (!cancelled) {
          setStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      }
    };

    void refreshDirectTeleopStatus();
    const stopPolling = startVisiblePageInterval(() => {
      void refreshDirectTeleopStatus();
    }, OPERATOR_HELPER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [authorization, available, baseUrl, followerConnected]);

  const handleStart = useCallback(async () => {
    const leader = leaderResolution.leader;
    if (!leader) {
      onStatusMessage(
        leaderResolution.issue ??
          "Connect a leader before starting LeRobot direct teleop.",
      );
      return;
    }
    if (!followerConnected) {
      onStatusMessage("Connect follower hardware first.");
      return;
    }
    setBusy(true);
    onBeforeStart();
    try {
      const nextStatus = await startOperatorLeRobotDirectTeleop(
        {
          operatorId: operatorId.trim() || OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
          leader,
        },
        baseUrl,
        "",
        authorization,
      );
      setStatus(nextStatus);
      onStatusMessage(
        nextStatus.lastError ??
          (nextStatus.running
            ? "LeRobot direct teleop started."
            : "LeRobot direct teleop did not start."),
      );
    } catch (error) {
      onStatusMessage(
        error instanceof Error
          ? error.message
          : "LeRobot direct teleop failed to start.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    authorization,
    baseUrl,
    followerConnected,
    leaderResolution,
    onBeforeStart,
    onStatusMessage,
    operatorId,
  ]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      const nextStatus = await stopOperatorLeRobotDirectTeleop(
        baseUrl,
        "",
        authorization,
      );
      setStatus(nextStatus);
      onStatusMessage("LeRobot direct teleop stopped.");
    } catch (error) {
      onStatusMessage(
        error instanceof Error
          ? error.message
          : "LeRobot direct teleop failed to stop.",
      );
    } finally {
      setBusy(false);
    }
  }, [authorization, baseUrl, onStatusMessage]);

  const issue = running
    ? null
    : !followerConnected
    ? "Connect follower first."
    : leaderResolution.issue;
  const disabled =
    !running && (!followerConnected || leaderResolution.leader === null);
  const statusLabel =
    status?.lastError ??
    (running ? `LeRobot direct ${status?.state ?? "running"}.` : "LeRobot direct ready.");

  return {
    running,
    card: available
      ? {
          available: true,
          busy,
          disabled,
          issue,
          running,
          statusLabel,
          onStart: handleStart,
          onStop: handleStop,
        }
      : undefined,
  };
};
