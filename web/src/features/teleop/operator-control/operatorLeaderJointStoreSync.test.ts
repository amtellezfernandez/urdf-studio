import { afterEach, describe, expect, it } from "vitest";

import {
  resolveOperatorLeaderJointStorePatch,
  syncOperatorLeaderJointTargetsToJointStore,
  syncOperatorLeaderTelemetryToJointStore,
} from "@/features/teleop/operator-control/operatorLeaderJointStoreSync";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import { useJointStore } from "@/shared/store/useJointStore";

const buildTelemetry = (positionRad: number): OperatorLiveJointTelemetry => ({
  positionRad,
  velocityRadPerSec: Number.NaN,
  torqueNm: Number.NaN,
  tempMos: Number.NaN,
  tempRotor: Number.NaN,
  sourceId: "leader",
  sourceLabel: "Leader",
  sourceTsMs: 1,
});

afterEach(() => {
  useJointStore.getState().setJointValues({});
  useJointStore.getState().setAvailableJoints([]);
});

describe("operatorLeaderJointStoreSync", () => {
  it("filters leader targets to loaded Studio joints and finite positions", () => {
    const patch = resolveOperatorLeaderJointStorePatch({
      availableJointNames: ["shoulder_pan", "gripper"],
      currentJointValues: { shoulder_pan: 0 },
      jointTargets: {
        shoulder_pan: 0.2,
        gripper: Number.NaN,
        unknown: 1,
      },
      positionEpsilonRad: 0.001,
    });

    expect(patch).toEqual({
      jointValues: {
        shoulder_pan: 0.2,
      },
      changed: true,
    });
  });

  it("updates the shared joint store so Genesis receives leader teleop changes", () => {
    useJointStore.getState().setAvailableJoints(["shoulder_pan", "gripper"]);
    useJointStore.getState().setJointValues({
      shoulder_pan: 0,
      unrelated_joint: -0.5,
    });
    const publishedSnapshots: Record<string, number>[] = [];
    const unsubscribe = useJointStore.subscribe((state, previousState) => {
      if (state.jointValues !== previousState.jointValues) {
        publishedSnapshots.push(state.jointValues);
      }
    });

    const changed = syncOperatorLeaderJointTargetsToJointStore({
      availableJointNames: useJointStore.getState().availableJoints,
      jointTargets: {
        shoulder_pan: 0.35,
        gripper: 0.8,
      },
    });
    unsubscribe();

    expect(changed).toBe(true);
    expect(useJointStore.getState().jointValues).toEqual({
      shoulder_pan: 0.35,
      gripper: 0.8,
      unrelated_joint: -0.5,
    });
    expect(publishedSnapshots).toHaveLength(1);
    expect(publishedSnapshots[0]).toMatchObject({
      shoulder_pan: 0.35,
      gripper: 0.8,
    });
  });

  it("does not rewrite the shared store when leader telemetry is unchanged", () => {
    useJointStore.getState().setJointValues({ shoulder_pan: 0.35 });
    const changed = syncOperatorLeaderJointTargetsToJointStore({
      availableJointNames: ["shoulder_pan"],
      jointTargets: {
        shoulder_pan: 0.35,
      },
    });

    expect(changed).toBe(false);
    expect(useJointStore.getState().jointValues).toEqual({ shoulder_pan: 0.35 });
  });

  it("maps leader telemetry positions into joint targets", () => {
    const changed = syncOperatorLeaderTelemetryToJointStore({
      availableJointNames: ["shoulder_pan"],
      telemetryByName: {
        shoulder_pan: buildTelemetry(0.4),
      },
    });

    expect(changed).toBe(true);
    expect(useJointStore.getState().jointValues.shoulder_pan).toBe(0.4);
  });
});
