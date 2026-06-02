import { describe, expect, it } from "vitest";
import {
  advanceJointActivityState,
  createInitialJointActivityState,
  resolveActiveJointNameSet,
} from "@/features/layout/jointActivity";
import { JOINT_ACTIVITY_PARAMS } from "@/features/layout/jointActivityParams";

const NOW_MS = 1_000;

describe("jointActivity", () => {
  it("does not mark joints active on first snapshot", () => {
    const next = advanceJointActivityState({
      state: createInitialJointActivityState(),
      trackedJointNames: ["joint_a"],
      currentJointValues: { joint_a: 0.3 },
      nowMs: NOW_MS,
      changeEpsilonRad: JOINT_ACTIVITY_PARAMS.changeEpsilonRad,
      visibleHoldMs: JOINT_ACTIVITY_PARAMS.visibleHoldMs,
    });

    expect(resolveActiveJointNameSet(next.activeUntilByJointName, NOW_MS).size).toBe(0);
  });

  it("marks joints active when value delta exceeds epsilon", () => {
    const first = advanceJointActivityState({
      state: createInitialJointActivityState(),
      trackedJointNames: ["joint_a"],
      currentJointValues: { joint_a: 0 },
      nowMs: NOW_MS,
      changeEpsilonRad: JOINT_ACTIVITY_PARAMS.changeEpsilonRad,
      visibleHoldMs: JOINT_ACTIVITY_PARAMS.visibleHoldMs,
    });
    const second = advanceJointActivityState({
      state: first,
      trackedJointNames: ["joint_a"],
      currentJointValues: { joint_a: 0.01 },
      nowMs: NOW_MS + 1,
      changeEpsilonRad: JOINT_ACTIVITY_PARAMS.changeEpsilonRad,
      visibleHoldMs: JOINT_ACTIVITY_PARAMS.visibleHoldMs,
    });

    expect(
      resolveActiveJointNameSet(second.activeUntilByJointName, NOW_MS + 1).has("joint_a")
    ).toBe(true);
  });

  it("prunes joints when hold window expires", () => {
    const activeState = advanceJointActivityState({
      state: {
        previousJointValues: { joint_a: 0 },
        activeUntilByJointName: { joint_a: NOW_MS + 5 },
      },
      trackedJointNames: ["joint_a"],
      currentJointValues: { joint_a: 0 },
      nowMs: NOW_MS + JOINT_ACTIVITY_PARAMS.visibleHoldMs + 20,
      changeEpsilonRad: JOINT_ACTIVITY_PARAMS.changeEpsilonRad,
      visibleHoldMs: JOINT_ACTIVITY_PARAMS.visibleHoldMs,
    });

    expect(
      resolveActiveJointNameSet(
        activeState.activeUntilByJointName,
        NOW_MS + JOINT_ACTIVITY_PARAMS.visibleHoldMs + 20
      ).size
    ).toBe(0);
  });
});
