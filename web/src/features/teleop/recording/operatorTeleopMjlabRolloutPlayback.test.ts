import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset/episodes";
import {
  applyMjlabRolloutObjectPosesToEpisode,
  buildMjlabRolloutObjectPoseMap,
} from "@/features/teleop/recording/operatorTeleopMjlabRolloutPlayback";
import type { OperatorTeleopMjlabRolloutResult } from "@/features/teleop/recording/operatorTeleopReplayApi";

const createRollout = (
  frameMap: OperatorTeleopMjlabRolloutResult["frameMap"]
): OperatorTeleopMjlabRolloutResult => ({
  success: true,
  schemaVersion: "urdf-studio.teleop-mjlab-rollout.v1",
  recordingId: "pickup",
  runtime: {
    runtimeName: "mjlab",
    available: true,
    status: "available",
    dependencies: [],
  },
  frameCount: 1,
  dynamicObjectCount: 1,
  contactCount: 2,
  frameMap,
  issues: [],
  worldWarnings: [],
  frames: [
    {
      sampleIndex: 0,
      timestampMs: 120,
      jointPositionsRad: { shoulder_pan: 0.1 },
      objectPoses: [
        {
          objectId: "hk-red-pickup-cube",
          name: "red pickup cube",
          simName: "wl_hk_red_pickup_cube",
          positionXyz: [1, 2, 3],
          quatWxyz: [1, 0, 0, 0],
        },
      ],
      contacts: [],
    },
  ],
});

describe("MJLab rollout playback", () => {
  it("builds viewer object pose maps in identity frame", () => {
    const rollout = createRollout("identity");
    const objectPoses = buildMjlabRolloutObjectPoseMap(
      rollout.frames[0],
      rollout.frameMap
    );

    expect(objectPoses["red pickup cube"]?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(objectPoses["red pickup cube"]?.rotation?.x).toBeCloseTo(0);
  });

  it("maps MuJoCo z-up object poses back into Studio y-up episode frames", () => {
    const rollout = createRollout("studio-y-up-to-z-up");
    const episode = createEpisode(
      "episode-1",
      1,
      [
        {
          timestamp: 120,
          jointPositions: { shoulder_pan: 0.1 },
        },
      ],
      { joint_names: ["shoulder_pan"], additional: {} }
    );

    const updated = applyMjlabRolloutObjectPosesToEpisode(episode, rollout);

    expect(updated.frames[0]?.objectPoses?.["red pickup cube"]?.position).toEqual({
      x: 1,
      y: 3,
      z: -2,
    });
    expect(updated.metadata?.additional?.mjlab_rollout_frame_count).toBe(1);
    expect(updated.metadata?.additional?.mjlab_rollout_contact_count).toBe(2);
  });
});
