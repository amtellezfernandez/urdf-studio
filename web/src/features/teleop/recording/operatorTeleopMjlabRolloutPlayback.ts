import * as THREE from "three";

import type { Episode } from "@/features/dataset/episodes";
import type {
  OperatorTeleopMjlabRolloutFrame,
  OperatorTeleopMjlabRolloutObjectPose,
  OperatorTeleopMjlabRolloutResult,
} from "@/features/teleop/recording/operatorTeleopReplayApi";
import type { ViewerObjectFramePoseMap } from "@/shared/types/feature";

const STUDIO_TO_SIM_MATRIX = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);
const SIM_TO_STUDIO_MATRIX = STUDIO_TO_SIM_MATRIX.clone().transpose();

const toTrackId = (pose: OperatorTeleopMjlabRolloutObjectPose): string =>
  pose.name.trim() || pose.objectId;

const toViewerPosition = (
  positionXyz: [number, number, number],
  frameMap: OperatorTeleopMjlabRolloutResult["frameMap"]
) => {
  const position = new THREE.Vector3(...positionXyz);
  if (frameMap === "studio-y-up-to-z-up") {
    position.applyMatrix4(SIM_TO_STUDIO_MATRIX);
  }
  return { x: position.x, y: position.y, z: position.z };
};

const toViewerRotation = (
  quatWxyz: [number, number, number, number],
  frameMap: OperatorTeleopMjlabRolloutResult["frameMap"]
) => {
  const rotation = new THREE.Quaternion(
    quatWxyz[1],
    quatWxyz[2],
    quatWxyz[3],
    quatWxyz[0]
  ).normalize();
  if (frameMap === "studio-y-up-to-z-up") {
    const simRotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
    const studioRotationMatrix = SIM_TO_STUDIO_MATRIX.clone()
      .multiply(simRotationMatrix)
      .multiply(STUDIO_TO_SIM_MATRIX);
    rotation.setFromRotationMatrix(studioRotationMatrix);
  }
  const euler = new THREE.Euler().setFromQuaternion(rotation, "XYZ");
  return { x: euler.x, y: euler.y, z: euler.z };
};

export const buildMjlabRolloutObjectPoseMap = (
  frame: OperatorTeleopMjlabRolloutFrame,
  frameMap: OperatorTeleopMjlabRolloutResult["frameMap"]
): ViewerObjectFramePoseMap =>
  Object.fromEntries(
    frame.objectPoses.map((pose) => [
      toTrackId(pose),
      {
        position: toViewerPosition(pose.positionXyz, frameMap),
        rotation: toViewerRotation(pose.quatWxyz, frameMap),
        isHidden: false,
      },
    ])
  );

export const applyMjlabRolloutObjectPosesToEpisode = (
  episode: Episode,
  rollout: OperatorTeleopMjlabRolloutResult
): Episode => {
  const rolloutFrameBySampleIndex = new Map(
    rollout.frames.map((frame) => [frame.sampleIndex, frame])
  );
  return {
    ...episode,
    frames: episode.frames.map((frame, frameIndex) => {
      const rolloutFrame =
        rolloutFrameBySampleIndex.get(frameIndex) ?? rollout.frames[frameIndex];
      if (!rolloutFrame) return frame;
      return {
        ...frame,
        objectPoses: buildMjlabRolloutObjectPoseMap(rolloutFrame, rollout.frameMap),
      };
    }),
    metadata: episode.metadata
      ? {
          ...episode.metadata,
          additional: {
            ...(episode.metadata.additional ?? {}),
            mjlab_rollout_schema_version: rollout.schemaVersion,
            mjlab_rollout_frame_count: rollout.frameCount,
            mjlab_rollout_contact_count: rollout.contactCount,
          },
        }
      : episode.metadata,
  };
};
