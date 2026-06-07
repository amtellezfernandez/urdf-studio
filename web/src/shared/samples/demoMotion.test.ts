import { describe, expect, it } from "vitest";

import {
  SO101_GRABBABLE_CONTAINER_FINAL_POSITION,
  SO101_GRABBABLE_CONTAINER_INITIAL_POSITION,
  SO101_GRABBABLE_CONTAINER_TRACK_ID,
  createDemoEpisodes,
} from "@/shared/samples/demoMotion";

const SO101_JOINT_NAMES = [
  "shoulder_pan",
  "shoulder_lift",
  "elbow_flex",
  "wrist_flex",
  "wrist_roll",
  "gripper",
];

describe("createDemoEpisodes", () => {
  it("creates a prerecorded SO101 container pickup episode", () => {
    const episodes = createDemoEpisodes({
      jointNames: SO101_JOINT_NAMES,
      jointLimits: {
        shoulder_pan: { type: "revolute", lower: -1.91986, upper: 1.91986 },
        shoulder_lift: { type: "revolute", lower: -1.74533, upper: 1.74533 },
        elbow_flex: { type: "revolute", lower: -1.69, upper: 1.69 },
        wrist_flex: { type: "revolute", lower: -1.65806, upper: 1.65806 },
        wrist_roll: { type: "revolute", lower: -2.74385, upper: 2.84121 },
        gripper: { type: "revolute", lower: -0.17453, upper: 1.74533 },
      },
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.metadata?.label).toBe("Pick Container");
    expect(episodes[0]?.metadata?.additional?.demoType).toBe(
      "so101_container_pickup_prerecorded"
    );
    expect(episodes[0]?.metadata?.additional?.physics_backend).toBe("prebaked");
    expect(episodes[0]?.metadata?.additional?.physics_rollout_required).toBe(false);
    expect(episodes[0]?.metadata?.additional?.object_initial_position_xyz).toEqual([
      SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.x,
      SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.y,
      SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.z,
    ]);
    expect(episodes[0]?.metadata?.additional?.object_final_position_xyz).toEqual([
      SO101_GRABBABLE_CONTAINER_FINAL_POSITION.x,
      SO101_GRABBABLE_CONTAINER_FINAL_POSITION.y,
      SO101_GRABBABLE_CONTAINER_FINAL_POSITION.z,
    ]);

    const frames = episodes[0]?.frames ?? [];
    expect(frames.length).toBeGreaterThan(1);
    expect(
      frames.every((frame) => frame.objectPoses?.[SO101_GRABBABLE_CONTAINER_TRACK_ID])
    ).toBe(true);
    expect(
      frames[0]?.objectPoses?.[SO101_GRABBABLE_CONTAINER_TRACK_ID]?.position
    ).toEqual(SO101_GRABBABLE_CONTAINER_INITIAL_POSITION);
    expect(
      frames.at(-1)?.objectPoses?.[SO101_GRABBABLE_CONTAINER_TRACK_ID]?.position
    ).toEqual(SO101_GRABBABLE_CONTAINER_FINAL_POSITION);
    expect(frames[0]?.jointPositions.gripper).toBeGreaterThan(
      frames[Math.floor(frames.length * 0.5)]?.jointPositions.gripper ?? 1
    );
    expect(frames.at(-1)?.jointPositions.gripper).toBeGreaterThan(
      frames[Math.floor(frames.length * 0.5)]?.jointPositions.gripper ?? 1
    );
  });

  it("keeps the generic demo profiles for non-SO101 robots", () => {
    const episodes = createDemoEpisodes({
      jointNames: ["joint_a", "joint_b"],
      jointLimits: {},
    });

    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes[0]?.metadata?.additional?.demoType).not.toBe(
      "so101_container_pickup_prerecorded"
    );
  });
});
