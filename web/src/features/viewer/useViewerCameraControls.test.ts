import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { applyIntrinsicsToPerspectiveCamera } from "@/shared/lib/cameraIntrinsics";
import {
  applyGlobalCameraFitState,
  captureGlobalCameraSnapshotState,
  restoreGlobalCameraSnapshotState,
  resolveCameraPovDisplayQuaternion,
  shouldSyncSelectedViewerCamera,
} from "@/features/viewer/useViewerCameraControls";
import { toThreeViewQuaternionFromStudioCamera } from "@/features/camera/cameraOrientationContract";
import { VIEWER_CAMERA_CONTROL_PARAMS } from "@/features/viewer/viewerCameraControlParams";

const TEST_VIEWER_CAMERA_CONTROLS = {
  globalAspect: 1.6,
  globalFovDeg: 50,
  globalNear: 0.1,
  globalFar: 100,
  globalMinDistance: 0.2,
  globalMaxDistance: 20,
  resizedCanvasWidthPx: 1500,
  resizedCanvasHeightPx: 500,
  globalFitCanvasWidthPx: 1200,
  globalFitCanvasHeightPx: 600,
  globalFitCenter: new THREE.Vector3(1, 2, 3),
  globalFitRadiusM: 0.7,
  povNear: 0.02,
  povFar: 40,
  povIntrinsics: {
    width: 1280,
    height: 720,
    fov_deg: 70,
    fx: 920,
    fy: 920,
    cx: 640,
    cy: 360,
  },
  portraitPovIntrinsics: {
    width: 600,
    height: 800,
    fov_deg: 65,
    fx: 760,
    fy: 760,
    cx: 300,
    cy: 400,
  },
} as const;

const buildControlsStub = (
  canvasSize?: { widthPx: number; heightPx: number }
): OrbitControlsImpl =>
  ({
    domElement: canvasSize
      ? ({
          clientWidth: canvasSize.widthPx,
          clientHeight: canvasSize.heightPx,
        } as HTMLElement)
      : undefined,
    maxDistance: TEST_VIEWER_CAMERA_CONTROLS.globalMaxDistance,
    minDistance: TEST_VIEWER_CAMERA_CONTROLS.globalMinDistance,
    target: new THREE.Vector3(),
    update: vi.fn(),
  }) as unknown as OrbitControlsImpl;

describe("useViewerCameraControls", () => {
  it("keeps selected camera sync active when no interaction suspends it", () => {
    expect(shouldSyncSelectedViewerCamera("wrist_cam", false)).toBe(true);
  });

  it("suspends selected camera sync while IK drag interaction is active", () => {
    expect(shouldSyncSelectedViewerCamera("wrist_cam", true)).toBe(false);
  });

  it("does not sync when no selected camera exists", () => {
    expect(shouldSyncSelectedViewerCamera(null, false)).toBe(false);
  });

  it("restores global projection after a camera POV applies custom intrinsics", () => {
    const camera = new THREE.PerspectiveCamera(
      TEST_VIEWER_CAMERA_CONTROLS.globalFovDeg,
      TEST_VIEWER_CAMERA_CONTROLS.globalAspect,
      TEST_VIEWER_CAMERA_CONTROLS.globalNear,
      TEST_VIEWER_CAMERA_CONTROLS.globalFar,
    );
    camera.updateProjectionMatrix();
    const controls = buildControlsStub();
    const snapshot = captureGlobalCameraSnapshotState(camera, controls);
    const originalProjection = camera.projectionMatrix.clone();

    applyIntrinsicsToPerspectiveCamera(
      camera,
      TEST_VIEWER_CAMERA_CONTROLS.povIntrinsics,
      TEST_VIEWER_CAMERA_CONTROLS.povNear,
      TEST_VIEWER_CAMERA_CONTROLS.povFar,
    );

    expect(camera.aspect).not.toBe(TEST_VIEWER_CAMERA_CONTROLS.globalAspect);

    restoreGlobalCameraSnapshotState(camera, controls, snapshot);

    expect(camera.aspect).toBe(TEST_VIEWER_CAMERA_CONTROLS.globalAspect);
    expect(camera.fov).toBe(TEST_VIEWER_CAMERA_CONTROLS.globalFovDeg);
    expect(camera.projectionMatrix.equals(originalProjection)).toBe(true);
  });

  it("restores global snapshots with the current canvas aspect", () => {
    const camera = new THREE.PerspectiveCamera(
      TEST_VIEWER_CAMERA_CONTROLS.globalFovDeg,
      TEST_VIEWER_CAMERA_CONTROLS.globalAspect,
      TEST_VIEWER_CAMERA_CONTROLS.globalNear,
      TEST_VIEWER_CAMERA_CONTROLS.globalFar,
    );
    camera.updateProjectionMatrix();
    const snapshotControls = buildControlsStub();
    const snapshot = captureGlobalCameraSnapshotState(camera, snapshotControls);
    const resizedControls = buildControlsStub({
      widthPx: TEST_VIEWER_CAMERA_CONTROLS.resizedCanvasWidthPx,
      heightPx: TEST_VIEWER_CAMERA_CONTROLS.resizedCanvasHeightPx,
    });

    applyIntrinsicsToPerspectiveCamera(
      camera,
      TEST_VIEWER_CAMERA_CONTROLS.povIntrinsics,
      TEST_VIEWER_CAMERA_CONTROLS.povNear,
      TEST_VIEWER_CAMERA_CONTROLS.povFar,
    );

    restoreGlobalCameraSnapshotState(camera, resizedControls, snapshot);

    expect(camera.aspect).toBeCloseTo(
      TEST_VIEWER_CAMERA_CONTROLS.resizedCanvasWidthPx /
        TEST_VIEWER_CAMERA_CONTROLS.resizedCanvasHeightPx
    );
    expect(camera.fov).toBe(TEST_VIEWER_CAMERA_CONTROLS.globalFovDeg);
    expect(resizedControls.update).toHaveBeenCalled();
  });

  it("fits a normal global projection from canvas aspect when no global snapshot exists", () => {
    const camera = new THREE.PerspectiveCamera(
      TEST_VIEWER_CAMERA_CONTROLS.globalFovDeg,
      TEST_VIEWER_CAMERA_CONTROLS.globalAspect,
      TEST_VIEWER_CAMERA_CONTROLS.globalNear,
      TEST_VIEWER_CAMERA_CONTROLS.globalFar,
    );
    camera.position.set(3, 4, 5);
    camera.updateProjectionMatrix();
    const controls = buildControlsStub({
      widthPx: TEST_VIEWER_CAMERA_CONTROLS.globalFitCanvasWidthPx,
      heightPx: TEST_VIEWER_CAMERA_CONTROLS.globalFitCanvasHeightPx,
    });

    applyIntrinsicsToPerspectiveCamera(
      camera,
      TEST_VIEWER_CAMERA_CONTROLS.portraitPovIntrinsics,
      TEST_VIEWER_CAMERA_CONTROLS.povNear,
      TEST_VIEWER_CAMERA_CONTROLS.povFar,
    );
    expect(camera.aspect).toBeCloseTo(
      TEST_VIEWER_CAMERA_CONTROLS.portraitPovIntrinsics.width /
        TEST_VIEWER_CAMERA_CONTROLS.portraitPovIntrinsics.height
    );

    applyGlobalCameraFitState(camera, controls, {
      center: TEST_VIEWER_CAMERA_CONTROLS.globalFitCenter,
      radius: TEST_VIEWER_CAMERA_CONTROLS.globalFitRadiusM,
    });

    expect(camera.aspect).toBeCloseTo(
      TEST_VIEWER_CAMERA_CONTROLS.globalFitCanvasWidthPx /
        TEST_VIEWER_CAMERA_CONTROLS.globalFitCanvasHeightPx
    );
    expect(camera.fov).toBe(VIEWER_CAMERA_CONTROL_PARAMS.globalFallbackFovDeg);
    expect(camera.view).toBeNull();
    expect(controls.target.equals(TEST_VIEWER_CAMERA_CONTROLS.globalFitCenter)).toBe(true);
    expect(controls.update).toHaveBeenCalled();
  });

  it("uses the exact camera roll for camera POV views", () => {
    const cameraQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.31, -0.24, 0.73, "ZYX"),
    );

    expect(
      resolveCameraPovDisplayQuaternion(cameraQuaternion).dot(
        toThreeViewQuaternionFromStudioCamera(cameraQuaternion),
      ),
    ).toBeCloseTo(1);
  });
});
