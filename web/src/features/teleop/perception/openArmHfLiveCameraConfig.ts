import * as THREE from "three";
import type { Camera } from "@/shared/types/camera";
import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import {
  OPENARM_HF_LIVE_CAMERA_ID,
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
  type OpenArmHfLiveCameraPose,
} from "@/features/teleop/perception/openArmHfLiveParams";

const OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS = {
  rpyOrder: "ZYX",
  pointCloudImageLeftInUrdfCamera: [0, 1, 0] as [number, number, number],
  pointCloudImageUpInUrdfCamera: [0, 0, 1] as [number, number, number],
  pointCloudForwardInUrdfCamera: [1, 0, 0] as [number, number, number],
  rotationPrecisionFactor: 1_000_000_000_000,
  halfTurnDeg: 180,
  zeroDeg: 0,
} as const;

export type OpenArmHfLiveCameraConfigPose = {
  rpy: [number, number, number];
  xyz: [number, number, number];
};

const cameraConfigNameMatchesOpenArmLiveCamera = (camera: Camera, cameraId: string): boolean =>
  camera.id === cameraId || camera.name === cameraId || camera.name === OPENARM_HF_LIVE_CAMERA_ID;

const buildOpenArmPointCloudOpticalQuaternion = (): THREE.Quaternion =>
  new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(
        ...OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.pointCloudImageLeftInUrdfCamera,
      ),
      new THREE.Vector3(
        ...OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.pointCloudImageUpInUrdfCamera,
      ),
      new THREE.Vector3(
        ...OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.pointCloudForwardInUrdfCamera,
      ),
    ),
  );

const toStableOpenArmCameraDeg = (radians: number) => {
  const stableDeg = Math.round(
    THREE.MathUtils.radToDeg(radians) *
      OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.rotationPrecisionFactor,
  ) / OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.rotationPrecisionFactor;
  if (Object.is(stableDeg, -OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.zeroDeg)) {
    return OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.zeroDeg;
  }
  return stableDeg === -OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.halfTurnDeg
    ? OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.halfTurnDeg
    : stableDeg;
};

const toStableOpenArmCameraRad = (radians: number) =>
  THREE.MathUtils.degToRad(toStableOpenArmCameraDeg(radians));

const toOpenArmPointCloudRotationRpyDeg = (
  cameraConfigRpyRad: [number, number, number],
): [number, number, number] => {
  const cameraConfigQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      ...cameraConfigRpyRad,
      OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.rpyOrder,
    ),
  );
  const pointCloudOpticalQuaternion = buildOpenArmPointCloudOpticalQuaternion();
  const pointCloudQuaternion = cameraConfigQuaternion
    .multiply(pointCloudOpticalQuaternion)
    .normalize();
  const pointCloudEuler = new THREE.Euler().setFromQuaternion(
    pointCloudQuaternion,
    "XYZ",
  );
  return [
    toStableOpenArmCameraDeg(pointCloudEuler.x),
    toStableOpenArmCameraDeg(pointCloudEuler.y),
    toStableOpenArmCameraDeg(pointCloudEuler.z),
  ];
};

export const resolveOpenArmHfLiveCameraConfigPoseFromPointCloudPose = (
  cameraPose: OpenArmHfLiveCameraPose,
): OpenArmHfLiveCameraConfigPose => {
  const pointCloudTransform = buildOperatorPointCloudPoseTransform(cameraPose);
  const pointCloudOpticalQuaternion = buildOpenArmPointCloudOpticalQuaternion();
  const cameraConfigQuaternion = pointCloudTransform.quaternion
    .clone()
    .multiply(pointCloudOpticalQuaternion.clone().invert())
    .normalize();
  const cameraConfigEuler = new THREE.Euler().setFromQuaternion(
    cameraConfigQuaternion,
    OPENARM_HF_LIVE_CAMERA_CONFIG_FRAME_PARAMS.rpyOrder,
  );

  return {
    xyz: [...pointCloudTransform.position],
    rpy: [
      toStableOpenArmCameraRad(cameraConfigEuler.x),
      toStableOpenArmCameraRad(cameraConfigEuler.y),
      toStableOpenArmCameraRad(cameraConfigEuler.z),
    ],
  };
};

export const resolveOpenArmHfLiveCameraConfigPose = (
  cameras: readonly Camera[],
  cameraId: string,
): OpenArmHfLiveCameraPose | null => {
  const camera = cameras.find((candidate) =>
    cameraConfigNameMatchesOpenArmLiveCamera(candidate, cameraId),
  );
  if (!camera) return null;

  return {
    position: [...camera.pose.xyz],
    rotationRpyDeg: toOpenArmPointCloudRotationRpyDeg(camera.pose.rpy),
    scale: OPENARM_HF_LIVE_REAL_SENSE_POSE.scale,
    worldFrame: "urdf_z_up",
    useGravityOrientation: false,
  };
};
