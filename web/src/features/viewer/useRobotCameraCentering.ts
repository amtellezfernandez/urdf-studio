import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";
import { computeRobotFocusBounds } from "@/features/viewer/cameraBounds";
import { extractRobotBasePose } from "@/features/viewer/viewer-helpers";
import {
  ROBOT_CAMERA_CENTERING_BASE_MOTION_ROTATION_EPSILON_RAD,
  ROBOT_CAMERA_CENTERING_BASE_MOTION_TRANSLATION_EPSILON_M,
  ROBOT_CAMERA_CENTERING_CONTINUOUS_DELTA_EPSILON_M,
  ROBOT_CAMERA_CENTERING_CONTINUOUS_MAX_STEP_M,
  ROBOT_CAMERA_CENTERING_DISTANCE_FLOOR_M,
  ROBOT_CAMERA_CENTERING_DISTANCE_PADDING_RATIO,
  ROBOT_CAMERA_CENTERING_DISTANCE_RADIUS_RATIO,
  ROBOT_CAMERA_CENTERING_MAX_DISTANCE_FLOOR_M,
  ROBOT_CAMERA_CENTERING_MAX_DISTANCE_MIN_DISTANCE_RATIO,
  ROBOT_CAMERA_CENTERING_MAX_DISTANCE_RADIUS_RATIO,
  ROBOT_CAMERA_CENTERING_MIN_DISTANCE_FLOOR_M,
  ROBOT_CAMERA_CENTERING_MIN_DISTANCE_RADIUS_RATIO,
  ROBOT_CAMERA_CENTERING_MIN_HALF_FOV_RAD,
  ROBOT_CAMERA_CENTERING_MIN_RADIUS_M,
  ROBOT_CAMERA_CENTERING_RADIUS_FALLBACK_M,
} from "@/features/viewer/robotCameraCenteringParams";
import {
  cloneRobotBasePose,
  hasMeaningfulRobotBasePoseDelta,
} from "@/shared/lib/robotBasePose";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { RobotBasePose } from "@/shared/types/feature";
import {
  applyIntrinsicsToPerspectiveCamera,
  normalizeCameraIntrinsics,
} from "@/shared/lib/cameraIntrinsics";

type UseRobotCameraCenteringParams = {
  robot: URDFRobot | null;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  followContinuously?: boolean;
};

export const shouldSkipContinuousCameraFollowForBaseMotion = (
  previousBasePose: RobotBasePose | null | undefined,
  currentBasePose: RobotBasePose | null | undefined
): boolean =>
  hasMeaningfulRobotBasePoseDelta(
    previousBasePose,
    currentBasePose,
    ROBOT_CAMERA_CENTERING_BASE_MOTION_TRANSLATION_EPSILON_M,
    ROBOT_CAMERA_CENTERING_BASE_MOTION_ROTATION_EPSILON_RAD
  );

export const useRobotCameraCentering = ({
  robot,
  controlsRef,
  followContinuously = false,
}: UseRobotCameraCenteringParams) => {
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);

  useEffect(() => {
    if (!robot || !controlsRef.current) return;

    const controls = controlsRef.current;
    const camera = controls.object as THREE.PerspectiveCamera;
    const focusBounds = computeRobotFocusBounds(robot);
    const center = focusBounds?.center ?? new THREE.Vector3(0, 0, 0);
    const radius = Math.max(
      focusBounds?.radius ?? ROBOT_CAMERA_CENTERING_RADIUS_FALLBACK_M,
      ROBOT_CAMERA_CENTERING_MIN_RADIUS_M
    );
    const minDistance = Math.max(
      radius * ROBOT_CAMERA_CENTERING_MIN_DISTANCE_RADIUS_RATIO,
      ROBOT_CAMERA_CENTERING_MIN_DISTANCE_FLOOR_M
    );
    const maxDistance = Math.max(
      radius * ROBOT_CAMERA_CENTERING_MAX_DISTANCE_RADIUS_RATIO,
      minDistance * ROBOT_CAMERA_CENTERING_MAX_DISTANCE_MIN_DISTANCE_RATIO,
      ROBOT_CAMERA_CENTERING_MAX_DISTANCE_FLOOR_M
    );

    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;

    // Keep the user's default view direction, only solve for distance.
    const viewDir = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    if (viewDir.lengthSq() < 1e-6) {
      viewDir.set(1, 1, 0.6).normalize();
    }

    // Fit full bounding sphere to both vertical and horizontal FOV.
    // Use sin() form for conservative "always inside frustum" distance.
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const minHalfFov = Math.max(
      ROBOT_CAMERA_CENTERING_MIN_HALF_FOV_RAD,
      Math.min(vFov, hFov) * 0.5
    );
    const distance =
      Math.max(
        radius / Math.sin(minHalfFov),
        radius * ROBOT_CAMERA_CENTERING_DISTANCE_RADIUS_RATIO,
        ROBOT_CAMERA_CENTERING_DISTANCE_FLOOR_M
      ) * ROBOT_CAMERA_CENTERING_DISTANCE_PADDING_RATIO;

    const updateClipPlanes = () => {
      const distanceToTarget = Math.max(
        camera.position.distanceTo(controls.target),
        minDistance
      );
      const near = Math.max(distanceToTarget / 200, 0.001);
      const far = Math.max(distanceToTarget * 80, radius * 120, 50);
      if (selectedCameraId) {
        const selectedCamera = cameras.find((item) => item.id === selectedCameraId);
        if (selectedCamera) {
          applyIntrinsicsToPerspectiveCamera(
            camera,
            normalizeCameraIntrinsics(selectedCamera.intrinsics),
            near,
            far
          );
          return;
        }
      }
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    };

    camera.position.copy(center).addScaledVector(viewDir, distance);
    controls.target.copy(center);
    updateClipPlanes();
    controls.update();

    const handleControlsChange = () => {
      updateClipPlanes();
    };

    controls.addEventListener("change", handleControlsChange);
    return () => {
      controls.removeEventListener("change", handleControlsChange);
    };
  }, [robot, controlsRef, cameras, selectedCameraId]);

  useEffect(() => {
    if (!followContinuously || !robot || !controlsRef.current) return;

    const controls = controlsRef.current;
    const camera = controls.object as THREE.PerspectiveCamera;
    const centerDelta = new THREE.Vector3();
    const lastCenter = new THREE.Vector3();
    let lastBasePose: RobotBasePose | null = null;
    let hasLastCenter = false;
    let frameId = 0;

    const tick = () => {
      const bounds = computeRobotFocusBounds(robot);
      const currentBasePose = extractRobotBasePose(robot);
      if (bounds) {
        if (!hasLastCenter) {
          lastCenter.copy(bounds.center);
          lastBasePose = cloneRobotBasePose(currentBasePose) ?? null;
          hasLastCenter = true;
          frameId = requestAnimationFrame(tick);
          return;
        }

        // Smooth camera follow: move lastCenter toward the robot centroid by a
        // lerp factor each frame, then apply only that incremental step to the
        // camera. This prevents the hard-snap behaviour that made the camera
        // feel coupled to robot jitter.
        // α=0.20 → reaches 99% of target in ~20 frames (~333 ms at 60 fps).
        // Faster than 0.12 so the camera doesn't visibly lag behind a moving robot.
        // Snap to exact position once within epsilon so the geometric series
        // fully converges (no permanent sub-epsilon drift).
        const CAMERA_FOLLOW_LERP = 0.20;
        const CAMERA_SNAP_EPSILON_M = 0.0002;
        if (!shouldSkipContinuousCameraFollowForBaseMotion(lastBasePose, currentBasePose)) {
          const totalDelta = new THREE.Vector3().subVectors(bounds.center, lastCenter);
          const totalLen = totalDelta.length();
          if (totalLen < CAMERA_SNAP_EPSILON_M) {
            // Fully converged — snap lastCenter to avoid permanent drift.
            lastCenter.copy(bounds.center);
          } else {
            centerDelta.copy(totalDelta).multiplyScalar(CAMERA_FOLLOW_LERP);
            const deltaLen = centerDelta.length();
            if (deltaLen > ROBOT_CAMERA_CENTERING_CONTINUOUS_DELTA_EPSILON_M) {
              if (deltaLen > ROBOT_CAMERA_CENTERING_CONTINUOUS_MAX_STEP_M) {
                centerDelta.setLength(ROBOT_CAMERA_CENTERING_CONTINUOUS_MAX_STEP_M);
              }
              controls.target.add(centerDelta);
              camera.position.add(centerDelta);
              lastCenter.add(centerDelta);
              controls.update();
            }
          }
        }
        lastBasePose = cloneRobotBasePose(currentBasePose) ?? null;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [followContinuously, robot, controlsRef]);
};
