import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset/episodes";
import {
  applyMjlabRolloutObjectPosesToEpisode,
  buildMjlabRolloutObjectPoseByObjectIdMap,
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
    acceleratorDependencies: [],
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
          objectId: "grabbable-container-a",
          name: "small grabbable shipping container",
          simName: "wl_grabbable_container_a",
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

    expect(objectPoses["small grabbable shipping container"]?.position).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
    expect(
      objectPoses["small grabbable shipping container"]?.rotation?.x
    ).toBeCloseTo(0);
  });

  it("can map rollout poses by object id for duplicate world-layout element names", () => {
    const rollout = createRollout("identity");
    rollout.frames[0].objectPoses.push({
      objectId: "grabbable-container-b",
      name: "small grabbable shipping container",
      simName: "wl_grabbable_container_b",
      positionXyz: [4, 5, 6],
      quatWxyz: [1, 0, 0, 0],
    });

    const objectPoses = buildMjlabRolloutObjectPoseByObjectIdMap(
      rollout.frames[0],
      rollout.frameMap
    );

    expect(objectPoses["grabbable-container-a"]?.position).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
    expect(objectPoses["grabbable-container-b"]?.position).toEqual({
      x: 4,
      y: 5,
      z: 6,
    });
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

    expect(
      updated.frames[0]?.objectPoses?.["small grabbable shipping container"]
        ?.position
    ).toEqual({ x: 1, y: 3, z: -2 });
    expect(updated.metadata?.additional?.mjlab_rollout_frame_count).toBe(1);
    expect(updated.metadata?.additional?.mjlab_rollout_contact_count).toBe(2);
  });
});
