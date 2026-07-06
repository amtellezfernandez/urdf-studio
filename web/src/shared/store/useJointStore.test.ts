import { beforeEach, describe, expect, it } from "vitest";
import { useJointStore } from "./useJointStore";

const TEST_JOINT_STORE_POSES = {
  initialShoulderRad: 0.4,
  mutatedInitialShoulderRad: 3,
  liveShoulderRad: 0.8,
} as const;

const resetStore = () => {
  useJointStore.setState({
    jointValues: {},
    initialJointValues: {},
    dataZeroJointValues: {},
    importedDataZeroJointValues: {},
    dataZeroJointSource: "auto",
    jointUpdateTimes: {},
    availableJoints: [],
    jointTopologyByName: {},
    velocityLimitEnabled: true,
    globalMaxJointVelocity: 1,
    jointVelocityLimits: {},
  });
};

describe("useJointStore velocity limiting", () => {
  beforeEach(() => {
    resetStore();
  });

  it("uses a strict fallback dt when timestamps are identical", () => {
    useJointStore.setState({
      jointValues: { j1: 0 },
      jointUpdateTimes: { j1: 1000 },
      velocityLimitEnabled: true,
      globalMaxJointVelocity: 1,
    });

    useJointStore.getState().setJointValue("j1", 1, { timestamp: 1000 });
    const next = useJointStore.getState().jointValues.j1;
    expect(next).toBeCloseTo(0.001, 6);
  });

  it("keeps strict mode enabled when disable is requested", () => {
    useJointStore.getState().setVelocityLimitEnabled(false);
    expect(useJointStore.getState().velocityLimitEnabled).toBe(true);
  });

  it("limits delta by velocity * dt for positive dt updates", () => {
    useJointStore.setState({
      jointValues: { j1: 0 },
      jointUpdateTimes: { j1: 1000 },
      velocityLimitEnabled: true,
      globalMaxJointVelocity: 2,
    });

    useJointStore.getState().setJointValue("j1", 10, { timestamp: 1100 });
    const next = useJointStore.getState().jointValues.j1;
    expect(next).toBeCloseTo(0.2, 6);
  });

  it("normalizes global and per-joint velocity limits", () => {
    useJointStore.getState().setGlobalMaxJointVelocity(0);
    expect(useJointStore.getState().globalMaxJointVelocity).toBe(1);

    useJointStore.getState().setGlobalMaxJointVelocity(1e-8);
    expect(useJointStore.getState().globalMaxJointVelocity).toBe(1e-4);

    useJointStore.getState().setJointMaxVelocity("j1", 1e-8);
    expect(useJointStore.getState().jointVelocityLimits.j1).toBe(1e-4);

    useJointStore.getState().setJointMaxVelocity("j1", null);
    expect(useJointStore.getState().jointVelocityLimits.j1).toBeUndefined();
  });

  it("stores loaded URDF reset joint values separately from live joint values", () => {
    const initialJointValues: Record<string, number> = {
      shoulder: TEST_JOINT_STORE_POSES.initialShoulderRad,
    };
    useJointStore.getState().setJointValues({
      shoulder: TEST_JOINT_STORE_POSES.liveShoulderRad,
    });

    useJointStore.getState().setInitialJointValues(initialJointValues);
    initialJointValues.shoulder =
      TEST_JOINT_STORE_POSES.mutatedInitialShoulderRad;

    expect(useJointStore.getState().initialJointValues).toEqual({
      shoulder: TEST_JOINT_STORE_POSES.initialShoulderRad,
    });
    expect(useJointStore.getState().jointValues).toEqual({
      shoulder: TEST_JOINT_STORE_POSES.liveShoulderRad,
    });
  });

  it("stores captured data-zero joint values separately from live joint values", () => {
    const zeroJointValues: Record<string, number> = {
      shoulder: TEST_JOINT_STORE_POSES.initialShoulderRad,
    };
    useJointStore.getState().setJointValues({
      shoulder: TEST_JOINT_STORE_POSES.liveShoulderRad,
    });

    useJointStore.getState().setDataZeroJointValues(zeroJointValues);
    zeroJointValues.shoulder =
      TEST_JOINT_STORE_POSES.mutatedInitialShoulderRad;

    expect(useJointStore.getState().dataZeroJointValues).toEqual({
      shoulder: TEST_JOINT_STORE_POSES.initialShoulderRad,
    });
    expect(useJointStore.getState().jointValues).toEqual({
      shoulder: TEST_JOINT_STORE_POSES.liveShoulderRad,
    });
  });

  it("switches the active data-zero joint values by source", () => {
    useJointStore.getState().setDataZeroJointValues({
      shoulder: TEST_JOINT_STORE_POSES.initialShoulderRad,
    });
    useJointStore.getState().setImportedDataZeroJointValues({
      shoulder: TEST_JOINT_STORE_POSES.liveShoulderRad,
    });

    expect(useJointStore.getState().getActiveDataZeroJointValues()).toEqual({
      shoulder: TEST_JOINT_STORE_POSES.initialShoulderRad,
    });

    useJointStore.getState().setDataZeroJointSource("imported");

    expect(useJointStore.getState().getActiveDataZeroJointValues()).toEqual({
      shoulder: TEST_JOINT_STORE_POSES.liveShoulderRad,
    });
  });
});
