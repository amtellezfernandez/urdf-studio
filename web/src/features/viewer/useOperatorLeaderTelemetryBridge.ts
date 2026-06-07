import { useEffect, useRef } from "react";

import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import { syncOperatorLeaderTelemetryToJointStore } from "@/features/teleop/operator-control/operatorLeaderJointStoreSync";
import {
  OPERATOR_LEADER_DETECTION_REFRESH_MS,
  OPERATOR_LEADER_STATE_POLL_INTERVAL_MS,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
  fetchOperatorLeaderDetection,
  fetchOperatorLeaderState,
  releaseOperatorLeaderHardwareKeepalive,
  type OperatorLeaderDetection,
} from "@/features/teleop/transport/operatorHelperApi";
import { readOperatorLeaderAssignments } from "@/features/teleop/transport/operatorLeaderAssignments";
import {
  applyOperatorLeaderTelemetryPoseReferences,
  buildMappedOperatorLeaderTelemetry,
  buildOperatorLeaderTelemetrySourceId,
  buildOperatorLeaderTelemetryZeroOffsetKey,
  pruneOperatorLeaderTelemetryZeroOffsets,
  resolveOperatorLeaderTelemetryTargets,
  type OperatorLeaderTelemetryZeroOffsets,
} from "@/features/teleop/transport/operatorLeaderTelemetry";
import { resolveJointDataZeroReference } from "@/shared/lib/jointDataZero";
import { startVisiblePageInterval } from "@/shared/lib/pageVisibility";
import { useJointStore } from "@/shared/store/useJointStore";

type UseOperatorLeaderTelemetryBridgeParams = {
  active: boolean;
  availableJointNames: readonly string[];
};

export const useOperatorLeaderTelemetryBridge = ({
  active,
  availableJointNames,
}: UseOperatorLeaderTelemetryBridgeParams): void => {
  const leaderTelemetryZeroOffsetsRef =
    useRef<OperatorLeaderTelemetryZeroOffsets>({});

  useEffect(() => {
    if (!active) {
      leaderTelemetryZeroOffsetsRef.current = {};
      useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
      releaseOperatorLeaderHardwareKeepalive(
        {},
        OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
      );
      return;
    }

    let cancelled = false;
    let pollInFlight = false;
    let cachedDetection: OperatorLeaderDetection | null = null;
    let nextDetectionRefreshAtMs = 0;
    const getLeaderDetection = async () => {
      const nowMs = Date.now();
      if (!cachedDetection || nowMs >= nextDetectionRefreshAtMs) {
        cachedDetection = await fetchOperatorLeaderDetection(
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
        nextDetectionRefreshAtMs =
          nowMs + OPERATOR_LEADER_DETECTION_REFRESH_MS;
      }
      return cachedDetection;
    };

    const pollAssignedLeaderTelemetry = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      const assignments = readOperatorLeaderAssignments();
      const assignedEntries = Object.entries(assignments);
      try {
        if (assignedEntries.length === 0) {
          useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
          return;
        }

        const detection = await getLeaderDetection();
        if (cancelled) return;

        const targets = resolveOperatorLeaderTelemetryTargets({
          leaders: detection.leaders,
          assignments,
          availableJointNames,
        });
        const telemetryByName: Record<string, OperatorLiveJointTelemetry> = {};
        const activeZeroOffsetKeys = new Set<string>();
        await Promise.all(
          targets.map(async (target) => {
            const state = await fetchOperatorLeaderState(
              target.path,
              target.side,
              OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
              {
                motorIds: target.motorIds,
                motorModel: target.motorModel,
                calibrationCategory: target.calibrationCategory,
                calibrationProfile: target.calibrationProfile,
                calibrationId: target.calibrationId,
                calibrationGroup: target.calibrationGroup,
              },
            );
            if (cancelled || !state.connected || state.error) return;
            const mappedTelemetry = buildMappedOperatorLeaderTelemetry({
              state,
              sourceId: buildOperatorLeaderTelemetrySourceId(
                target.identityKey,
              ),
              sourceLabel: target.label,
              sourceJointNames: target.sourceJointNames,
              targetJointNames: target.targetJointNames,
              targetJointDirections: target.targetJointDirections,
            });
            const zeroOffsetKey =
              buildOperatorLeaderTelemetryZeroOffsetKey(target);
            activeZeroOffsetKeys.add(zeroOffsetKey);
            Object.assign(
              telemetryByName,
              applyOperatorLeaderTelemetryPoseReferences({
                telemetryByName: mappedTelemetry,
                zeroOffsetKey,
                sourceNeutralPositionsByTargetJointName:
                  target.sourceNeutralPositionsByTargetJointName,
                targetZeroPositionsByJointName: resolveJointDataZeroReference({
                  dataZeroJointValues:
                    useJointStore.getState().dataZeroJointValues,
                  fallbackJointValues:
                    useJointStore.getState().initialJointValues,
                }),
                fallbackReferencePositionsByJointName:
                  useJointStore.getState().jointValues,
                zeroOffsetsByKey: leaderTelemetryZeroOffsetsRef.current,
              }),
            );
          }),
        );
        if (cancelled) return;
        pruneOperatorLeaderTelemetryZeroOffsets(
          leaderTelemetryZeroOffsetsRef.current,
          activeZeroOffsetKeys,
        );
        const perceptionStore = useOperatorPerceptionStore.getState();
        if (Object.keys(telemetryByName).length === 0) {
          perceptionStore.clearActiveLeaderJointTelemetry();
          return;
        }
        perceptionStore.upsertActiveLeaderJointTelemetry(telemetryByName);
        perceptionStore.upsertActiveJointTelemetry(telemetryByName);
        syncOperatorLeaderTelemetryToJointStore({
          telemetryByName,
          availableJointNames,
        });
      } catch {
        nextDetectionRefreshAtMs = 0;
      } finally {
        pollInFlight = false;
      }
    };

    void pollAssignedLeaderTelemetry();
    const stopPolling = startVisiblePageInterval(() => {
      void pollAssignedLeaderTelemetry();
    }, OPERATOR_LEADER_STATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
      leaderTelemetryZeroOffsetsRef.current = {};
      useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
      releaseOperatorLeaderHardwareKeepalive(
        {},
        OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
      );
    };
  }, [active, availableJointNames]);
};
