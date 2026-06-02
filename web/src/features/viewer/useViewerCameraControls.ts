import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { computeRobotFocusBounds } from "@/features/viewer/cameraBounds";
import {
  getWorldForwardFromThreeViewQuaternion,
  toThreeViewQuaternionFromUrdf,
} from "@/features/camera/cameraOrientationContract";
import { getCameraWorldPose } from "@/features/camera/cameraWorldPose";
import {
  applyOperatorPointCloudFloorCalibrationToWorldPose,
  type OperatorPointCloudFloorCalibrationByCameraId,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import { applyIntrinsicsToPerspectiveCamera, normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import { VIEWER_CAMERA_CONTROL_PARAMS } from "@/features/viewer/viewerCameraControlParams";

type UseViewerCameraControlsParams = {
  robot: URDFRobot | null;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  jointValues?: Record<string, number>;
  camerasOverride?: ReturnType<typeof useCameraStore.getState>["cameras"];
  floorCalibrationsByCameraId?: OperatorPointCloudFloorCalibrationByCameraId;
  suspendSelectedCameraSync?: boolean;
};

type GlobalCameraSnapshot = {
  aspect: number;
  far: number;
  filmGauge: number;
  filmOffset: number;
  fov: number;
  maxDistance: number;
  minDistance: number;
  near: number;
  position: THREE.Vector3;
  projectionMatrix: THREE.Matrix4;
  projectionMatrixInverse: THREE.Matrix4;
  quaternion: THREE.Quaternion;
  target: THREE.Vector3;
  up: THREE.Vector3;
  view: THREE.PerspectiveCamera["view"];
  zoom: number;
};

type ViewDirection = "front" | "back" | "top" | "bottom" | "left" | "right";

const CAMERA_CONTROL_PARAMS = VIEWER_CAMERA_CONTROL_PARAMS;
const DEFAULT_FOCUS_CENTER = new THREE.Vector3(...CAMERA_CONTROL_PARAMS.defaultFocusCenter);
const VIEW_DIRECTION_OFFSETS: Record<ViewDirection, THREE.Vector3> = {
  front: new THREE.Vector3(...CAMERA_CONTROL_PARAMS.viewDirectionOffsets.front),
  back: new THREE.Vector3(...CAMERA_CONTROL_PARAMS.viewDirectionOffsets.back),
  left: new THREE.Vector3(...CAMERA_CONTROL_PARAMS.viewDirectionOffsets.left),
  right: new THREE.Vector3(...CAMERA_CONTROL_PARAMS.viewDirectionOffsets.right),
  top: new THREE.Vector3(...CAMERA_CONTROL_PARAMS.viewDirectionOffsets.top),
  bottom: new THREE.Vector3(...CAMERA_CONTROL_PARAMS.viewDirectionOffsets.bottom),
};
const SET_VIEW_DISTANCE_SCALE = CAMERA_CONTROL_PARAMS.setViewDistanceScale;
const SET_VIEW_MIN_DISTANCE = CAMERA_CONTROL_PARAMS.setViewMinDistance;
const CAMERA_LOOK_AT_DISTANCE = CAMERA_CONTROL_PARAMS.cameraLookAtDistance;
const CAMERA_MIN_FOCUS_RADIUS = CAMERA_CONTROL_PARAMS.cameraMinFocusRadius;
const CAMERA_MIN_NEAR_PLANE = CAMERA_CONTROL_PARAMS.cameraMinNearPlane;
const CAMERA_NEAR_PLANE_SCALE = CAMERA_CONTROL_PARAMS.cameraNearPlaneScale;
const CAMERA_MIN_FAR_PLANE = CAMERA_CONTROL_PARAMS.cameraMinFarPlane;
const CAMERA_FAR_PLANE_SCALE = CAMERA_CONTROL_PARAMS.cameraFarPlaneScale;
const CAMERA_FAR_TO_NEAR_RATIO = CAMERA_CONTROL_PARAMS.cameraFarToNearRatio;
const FIT_MIN_FOCUS_RADIUS = CAMERA_CONTROL_PARAMS.fitMinFocusRadius;
const FIT_MIN_HALF_FOV = CAMERA_CONTROL_PARAMS.fitMinHalfFov;
const FIT_BOUNDS_DIAMETER_SCALE = CAMERA_CONTROL_PARAMS.fitBoundsDiameterScale;
const FIT_DISTANCE_SINE_SCALE = CAMERA_CONTROL_PARAMS.fitDistanceSineScale;
const FIT_DISTANCE_MIN_FALLBACK = CAMERA_CONTROL_PARAMS.fitDistanceMinFallback;
const FIT_DISTANCE_PADDING = CAMERA_CONTROL_PARAMS.fitDistancePadding;
const FIT_DIRECTION_EPSILON = CAMERA_CONTROL_PARAMS.fitDirectionEpsilon;
const FIT_DEFAULT_DIRECTION = new THREE.Vector3(...CAMERA_CONTROL_PARAMS.fitDefaultDirection).normalize();
const FIT_MIN_DISTANCE_SCALE = CAMERA_CONTROL_PARAMS.fitMinDistanceScale;
const FIT_MIN_DISTANCE_FALLBACK = CAMERA_CONTROL_PARAMS.fitMinDistanceFallback;
const FIT_MAX_DISTANCE_SCALE = CAMERA_CONTROL_PARAMS.fitMaxDistanceScale;
const FIT_MAX_TO_MIN_DISTANCE_RATIO = CAMERA_CONTROL_PARAMS.fitMaxToMinDistanceRatio;
const FIT_MAX_DISTANCE_FALLBACK = CAMERA_CONTROL_PARAMS.fitMaxDistanceFallback;
const GLOBAL_FALLBACK_ASPECT = CAMERA_CONTROL_PARAMS.globalFallbackAspect;
const GLOBAL_FALLBACK_FOV_DEG = CAMERA_CONTROL_PARAMS.globalFallbackFovDeg;

export const shouldSyncSelectedViewerCamera = (
  selectedCameraId: string | null,
  suspendSelectedCameraSync: boolean
): selectedCameraId is string => selectedCameraId !== null && !suspendSelectedCameraSync;

export const resolveCameraPovDisplayQuaternion = (
  cameraQuaternion: THREE.Quaternion,
): THREE.Quaternion => toThreeViewQuaternionFromUrdf(cameraQuaternion);

export const captureGlobalCameraSnapshotState = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
): GlobalCameraSnapshot => ({
  aspect: camera.aspect,
  far: camera.far,
  filmGauge: camera.filmGauge,
  filmOffset: camera.filmOffset,
  fov: camera.fov,
  maxDistance: controls.maxDistance,
  minDistance: controls.minDistance,
  near: camera.near,
  position: camera.position.clone(),
  projectionMatrix: camera.projectionMatrix.clone(),
  projectionMatrixInverse: camera.projectionMatrixInverse.clone(),
  quaternion: camera.quaternion.clone(),
  target: controls.target.clone(),
  up: camera.up.clone(),
  view: camera.view ? { ...camera.view } : null,
  zoom: camera.zoom,
});

const resolveControlsCanvasAspect = (
  controls: OrbitControlsImpl,
  fallbackAspect = GLOBAL_FALLBACK_ASPECT
): number => {
  const domElement = controls.domElement as HTMLElement | undefined;
  const width = domElement?.clientWidth ?? 0;
  const height = domElement?.clientHeight ?? 0;
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return width / height;
  }
  return fallbackAspect;
};

export const restoreGlobalCameraSnapshotState = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
  snapshot: GlobalCameraSnapshot,
): void => {
  camera.position.copy(snapshot.position);
  camera.quaternion.copy(snapshot.quaternion);
  camera.up.copy(snapshot.up);
  camera.aspect = resolveControlsCanvasAspect(controls, snapshot.aspect);
  camera.fov = snapshot.fov;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.zoom = snapshot.zoom;
  camera.filmGauge = snapshot.filmGauge;
  camera.filmOffset = snapshot.filmOffset;
  camera.view = snapshot.view ? { ...snapshot.view } : null;
  camera.updateProjectionMatrix();

  controls.target.copy(snapshot.target);
  controls.minDistance = snapshot.minDistance;
  controls.maxDistance = snapshot.maxDistance;
  controls.update();
};

const resolveFitDistance = (radius: number, fovDegrees: number, aspect: number): number => {
  const vFov = THREE.MathUtils.degToRad(fovDegrees);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const minHalfFov = Math.max(FIT_MIN_HALF_FOV, Math.min(vFov, hFov) * 0.5);
  return (
    Math.max(
      radius / Math.sin(minHalfFov),
      radius * FIT_DISTANCE_SINE_SCALE,
      FIT_DISTANCE_MIN_FALLBACK
    ) * FIT_DISTANCE_PADDING
  );
};

const resolveFitDirection = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl
): THREE.Vector3 => {
  const direction = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();

  return direction.length() < FIT_DIRECTION_EPSILON ? FIT_DEFAULT_DIRECTION.clone() : direction;
};

const applyFitDistanceLimits = (controls: OrbitControlsImpl, radius: number): void => {
  controls.minDistance = Math.max(
    radius * FIT_MIN_DISTANCE_SCALE,
    FIT_MIN_DISTANCE_FALLBACK
  );
  controls.maxDistance = Math.max(
    radius * FIT_MAX_DISTANCE_SCALE,
    controls.minDistance * FIT_MAX_TO_MIN_DISTANCE_RATIO,
    FIT_MAX_DISTANCE_FALLBACK
  );
};

export const applyGlobalCameraFitState = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
  focusBounds: { center: THREE.Vector3; radius: number } | null,
): void => {
  const center = focusBounds?.center ?? DEFAULT_FOCUS_CENTER;
  const radius = Math.max(focusBounds?.radius ?? CAMERA_MIN_FOCUS_RADIUS, FIT_MIN_FOCUS_RADIUS);
  const aspect = resolveControlsCanvasAspect(controls);
  const distance = resolveFitDistance(radius, GLOBAL_FALLBACK_FOV_DEG, aspect);
  const direction = resolveFitDirection(camera, controls);

  camera.aspect = aspect;
  camera.fov = GLOBAL_FALLBACK_FOV_DEG;
  camera.near = Math.max(CAMERA_MIN_NEAR_PLANE, radius * CAMERA_NEAR_PLANE_SCALE);
  camera.far = Math.max(
    CAMERA_MIN_FAR_PLANE,
    radius * CAMERA_FAR_PLANE_SCALE,
    camera.near * CAMERA_FAR_TO_NEAR_RATIO
  );
  camera.zoom = 1;
  camera.filmOffset = 0;
  camera.view = null;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.updateProjectionMatrix();
  applyFitDistanceLimits(controls, radius);
  controls.target.copy(center);
  controls.update();
};

export const useViewerCameraControls = ({
  robot,
  controlsRef,
  cameraRef,
  jointValues,
  camerasOverride,
  floorCalibrationsByCameraId = {},
  suspendSelectedCameraSync = false,
}: UseViewerCameraControlsParams) => {
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const storeCameras = useCameraStore((state) => state.cameras);
  const cameras = camerasOverride ?? storeCameras;
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);
  const globalCameraSnapshotRef = useRef<GlobalCameraSnapshot | null>(null);
  const lastSnapshotRobotRef = useRef<URDFRobot | null>(null);

  const getControlsAndCamera = useCallback(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return null;
    return { controls, camera };
  }, [cameraRef, controlsRef]);

  const findCameraConfigById = useCallback(
    (cameraId: string) => cameras.find((item) => item.id === cameraId) ?? null,
    [cameras]
  );

  const resolveCalibratedCameraWorldPose = useCallback(
    (cameraConfig: NonNullable<ReturnType<typeof findCameraConfigById>>) => {
      const { position, quaternion } = getCameraWorldPose(
        robot,
        cameraConfig,
        { updateRobotWorld: true }
      );
      const calibration =
        floorCalibrationsByCameraId[cameraConfig.id] ??
        floorCalibrationsByCameraId[cameraConfig.name] ??
        null;
      return applyOperatorPointCloudFloorCalibrationToWorldPose(
        position,
        quaternion,
        calibration,
      );
    },
    [floorCalibrationsByCameraId, robot],
  );

  const resolveFocusBoundsWithCameras = useCallback(() => {
    if (!robot) return null;
    const robotFocusBounds = computeRobotFocusBounds(robot);
    const focusBox = new THREE.Box3();
    if (robotFocusBounds) {
      focusBox.setFromCenterAndSize(
        robotFocusBounds.center,
        new THREE.Vector3(
          robotFocusBounds.radius * FIT_BOUNDS_DIAMETER_SCALE,
          robotFocusBounds.radius * FIT_BOUNDS_DIAMETER_SCALE,
          robotFocusBounds.radius * FIT_BOUNDS_DIAMETER_SCALE,
        ),
      );
    }
    for (const cameraConfig of cameras) {
      focusBox.expandByPoint(resolveCalibratedCameraWorldPose(cameraConfig).position);
    }
    if (focusBox.isEmpty()) return robotFocusBounds;
    const sphere = focusBox.getBoundingSphere(new THREE.Sphere());
    return {
      center: sphere.center,
      radius: sphere.radius,
    };
  }, [cameras, resolveCalibratedCameraWorldPose, robot]);

  const resolveDisplayQuaternion = useCallback(
    (_cameraId: string, cameraQuaternion: THREE.Quaternion) =>
      resolveCameraPovDisplayQuaternion(cameraQuaternion),
    [],
  );

  const setView = useCallback(
    (direction: ViewDirection) => {
      if (!robot) return;
      const controlsAndCamera = getControlsAndCamera();
      if (!controlsAndCamera) return;
      const { controls, camera } = controlsAndCamera;
      const focusBounds = computeRobotFocusBounds(robot);
      const center = focusBounds?.center ?? DEFAULT_FOCUS_CENTER;
      const distance = Math.max(
        (focusBounds?.radius ?? 1) * SET_VIEW_DISTANCE_SCALE,
        SET_VIEW_MIN_DISTANCE
      );

      camera.position.copy(center).addScaledVector(VIEW_DIRECTION_OFFSETS[direction], distance);
      controls.target.copy(center);
      controls.update();
    },
    [getControlsAndCamera, robot]
  );

  const handleCameraViewChange = useCallback(
    (cameraId: string) => {
      if (!robot) return;
      const controlsAndCamera = getControlsAndCamera();
      if (!controlsAndCamera) return;
      const { controls, camera: viewCamera } = controlsAndCamera;

      const cameraConfig = findCameraConfigById(cameraId);
      if (!cameraConfig) return;

      const {
        position: cameraPosition,
        quaternion: cameraQuaternion,
      } = resolveCalibratedCameraWorldPose(cameraConfig);

      const finalQuaternion = resolveDisplayQuaternion(cameraId, cameraQuaternion);
      const forward = getWorldForwardFromThreeViewQuaternion(finalQuaternion);
      const lookAtPoint = cameraPosition
        .clone()
        .add(forward.multiplyScalar(CAMERA_LOOK_AT_DISTANCE));
      const focusBounds = computeRobotFocusBounds(robot);
      const focusRadius = Math.max(CAMERA_MIN_FOCUS_RADIUS, focusBounds?.radius ?? 0.5);
      const near = Math.max(CAMERA_MIN_NEAR_PLANE, focusRadius * CAMERA_NEAR_PLANE_SCALE);
      const far = Math.max(
        CAMERA_MIN_FAR_PLANE,
        focusRadius * CAMERA_FAR_PLANE_SCALE,
        near * CAMERA_FAR_TO_NEAR_RATIO
      );
      applyIntrinsicsToPerspectiveCamera(
        viewCamera,
        normalizeCameraIntrinsics(cameraConfig.intrinsics),
        near,
        far
      );

      viewCamera.position.copy(cameraPosition);
      viewCamera.quaternion.copy(finalQuaternion);
      controls.target.copy(lookAtPoint);
      controls.update();
    },
    [
      findCameraConfigById,
      getControlsAndCamera,
      resolveDisplayQuaternion,
      resolveCalibratedCameraWorldPose,
      robot,
    ]
  );

  const fitToView = useCallback(() => {
    if (!robot) return;
    const controlsAndCamera = getControlsAndCamera();
    if (!controlsAndCamera) return;
    const { controls, camera } = controlsAndCamera;
    const focusBounds = resolveFocusBoundsWithCameras();
    const center = focusBounds?.center ?? DEFAULT_FOCUS_CENTER;
    const radius = Math.max(focusBounds?.radius ?? 0.5, FIT_MIN_FOCUS_RADIUS);
    const distance = resolveFitDistance(radius, camera.fov, camera.aspect);
    const direction = resolveFitDirection(camera, controls);

    const newPosition = center.clone().add(direction.multiplyScalar(distance));
    camera.position.copy(newPosition);
    applyFitDistanceLimits(controls, radius);
    controls.target.copy(center);
    controls.update();
  }, [getControlsAndCamera, resolveFocusBoundsWithCameras, robot]);

  const captureGlobalCameraSnapshot = useCallback(() => {
    const controlsAndCamera = getControlsAndCamera();
    if (!controlsAndCamera) return;
    const { controls, camera } = controlsAndCamera;
    globalCameraSnapshotRef.current = captureGlobalCameraSnapshotState(camera, controls);
  }, [getControlsAndCamera]);

  const handleGlobalCameraViewChange = useCallback(() => {
    const controlsAndCamera = getControlsAndCamera();
    if (!controlsAndCamera) return;
    const { controls, camera } = controlsAndCamera;

    const snapshot = globalCameraSnapshotRef.current;
    if (snapshot) {
      restoreGlobalCameraSnapshotState(camera, controls, snapshot);
      return;
    }
    applyGlobalCameraFitState(camera, controls, resolveFocusBoundsWithCameras());
  }, [getControlsAndCamera, resolveFocusBoundsWithCameras]);

  useEffect(() => {
    if (!isCameraMenuOpen) return;
    const handleClick = () => setIsCameraMenuOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [isCameraMenuOpen]);

  useEffect(() => {
    if (lastSnapshotRobotRef.current === robot) return;
    lastSnapshotRobotRef.current = robot;
    globalCameraSnapshotRef.current = null;
  }, [robot]);

  useEffect(() => {
    if (!robot) return;
    if (globalCameraSnapshotRef.current) return;
    if (selectedCameraId !== null) return;
    captureGlobalCameraSnapshot();
  }, [captureGlobalCameraSnapshot, robot, selectedCameraId]);

  const syncSelectedCameraView = useCallback(() => {
    if (!shouldSyncSelectedViewerCamera(selectedCameraId, suspendSelectedCameraSync)) {
      return;
    }
    handleCameraViewChange(selectedCameraId);
  }, [handleCameraViewChange, selectedCameraId, suspendSelectedCameraSync]);

  useEffect(() => {
    syncSelectedCameraView();
  }, [jointValues, syncSelectedCameraView]);

  useEffect(() => {
    if (!shouldSyncSelectedViewerCamera(selectedCameraId, suspendSelectedCameraSync)) {
      return undefined;
    }
    let rafId = 0;
    const syncSelectedCameraViewFrame = () => {
      handleCameraViewChange(selectedCameraId);
      rafId = requestAnimationFrame(syncSelectedCameraViewFrame);
    };
    const handleResize = () => {
      handleCameraViewChange(selectedCameraId);
    };
    window.addEventListener("resize", handleResize);
    rafId = requestAnimationFrame(syncSelectedCameraViewFrame);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [handleCameraViewChange, selectedCameraId, suspendSelectedCameraSync]);

  useEffect(() => {
    if (selectedCameraId !== null) return;
    handleGlobalCameraViewChange();
  }, [handleGlobalCameraViewChange, selectedCameraId]);

  return {
    cameras,
    selectedCameraId,
    selectCamera,
    isCameraMenuOpen,
    setIsCameraMenuOpen,
    setView,
    fitToView,
    handleGlobalCameraViewChange,
    handleCameraViewChange,
  };
};
