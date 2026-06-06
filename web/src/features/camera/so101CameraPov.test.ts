import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import type { Camera } from "@/shared/types/camera";
import {
  applyIntrinsicsToPerspectiveCamera,
  normalizeCameraIntrinsics,
} from "@/shared/lib/cameraIntrinsics";
import { parseCameraConfig } from "@/features/camera/cameraConfig";
import { toThreeViewQuaternionFromUrdf } from "@/features/camera/cameraOrientationContract";
import {
  getCameraWorldPose,
  resolveCameraParentJointObject,
} from "@/features/camera/cameraWorldPose";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../public/", import.meta.url));
const SO101_URDF_PATH = `${PUBLIC_ROOT}/demo/robot.urdf`;
const SO101_CAMERA_CONFIG_PATH = `${PUBLIC_ROOT}/demo/so101/camera-config.json`;
const HK_WORLD_LAYOUT_PATH = `${PUBLIC_ROOT}/world-layouts/hk-cargo-port.world-layout.json`;
const THREE_CAMERA_FORWARD = new THREE.Vector3(0, 0, -1);
const THREE_CAMERA_UP = new THREE.Vector3(0, 1, 0);
const RED_CONTAINER_PILE_CENTER = new THREE.Vector3(0.02, 0.29, 0.035);

let originalDomParser: typeof globalThis.DOMParser | undefined;
let originalDocument: typeof globalThis.Document | undefined;
let originalElement: typeof globalThis.Element | undefined;

type HkWorldLayout = {
  environment?: {
    elements?: Array<{
      id?: string;
      position_xyz?: [number, number, number];
    }>;
  };
};

beforeAll(() => {
  const dom = new JSDOM("");
  originalDomParser = globalThis.DOMParser;
  originalDocument = globalThis.Document;
  originalElement = globalThis.Element;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.Document = dom.window.Document;
  globalThis.Element = dom.window.Element;
});

afterAll(() => {
  if (originalDomParser) {
    globalThis.DOMParser = originalDomParser;
  }
  if (originalDocument) {
    globalThis.Document = originalDocument;
  }
  if (originalElement) {
    globalThis.Element = originalElement;
  }
});

const loadSo101Robot = (): URDFRobot => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_path, _manager, done) => {
    done(new THREE.Group());
  };
  const robot = loader.parse(readFileSync(SO101_URDF_PATH, "utf8")) as URDFRobot;
  robot.updateMatrixWorld(true);
  return robot;
};

const loadSo101Cameras = (): Camera[] =>
  parseCameraConfig(readFileSync(SO101_CAMERA_CONFIG_PATH, "utf8"), "camera-config.json").cameras;

const loadRedContainerCenters = (): THREE.Vector3[] => {
  const layout = JSON.parse(readFileSync(HK_WORLD_LAYOUT_PATH, "utf8")) as HkWorldLayout;
  return (layout.environment?.elements ?? [])
    .filter((element) => element.id?.startsWith("grabbable-container-"))
    .map((element) => new THREE.Vector3(...(element.position_xyz ?? [0, 0, 0])));
};

const buildPovReport = (robot: URDFRobot, camera: Camera, targets: THREE.Vector3[]) => {
  const parent = resolveCameraParentJointObject(robot, camera.parent_joint);
  const worldPose = getCameraWorldPose(robot, camera, { updateRobotWorld: true });
  const displayQuaternion = toThreeViewQuaternionFromUrdf(worldPose.quaternion);
  const intrinsics = normalizeCameraIntrinsics(camera.intrinsics);
  const previewCamera = new THREE.PerspectiveCamera(
    intrinsics.fov_deg,
    intrinsics.width / intrinsics.height,
    0.01,
    50
  );
  previewCamera.position.copy(worldPose.position);
  previewCamera.quaternion.copy(displayQuaternion);
  applyIntrinsicsToPerspectiveCamera(previewCamera, intrinsics, 0.01, 50);
  previewCamera.updateMatrixWorld(true);

  const visibleTargets = targets.filter((target) => {
    const ndc = target.clone().project(previewCamera);
    return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1;
  });

  return {
    parentResolved: Boolean(parent),
    position: worldPose.position,
    forward: THREE_CAMERA_FORWARD.clone().applyQuaternion(displayQuaternion).normalize(),
    up: THREE_CAMERA_UP.clone().applyQuaternion(displayQuaternion).normalize(),
    visibleTargetCount: visibleTargets.length,
  };
};

describe("SO101 training camera POVs", () => {
  it("keeps the bundled camera set useful for VLA port-scene training", () => {
    const robot = loadSo101Robot();
    const cameras = loadSo101Cameras();
    const redContainerCenters = loadRedContainerCenters();

    expect(cameras.map((camera) => camera.name)).toEqual([
      "so101_overhead_scene",
      "so101_gripper_down",
      "so101_port_oblique",
    ]);
    expect(redContainerCenters).toHaveLength(6);

    const reports = new Map(
      cameras.map((camera) => [camera.name, buildPovReport(robot, camera, redContainerCenters)])
    );
    expect(Array.from(reports.values()).every((report) => report.parentResolved)).toBe(true);

    const overheadReport = reports.get("so101_overhead_scene");
    const gripperReport = reports.get("so101_gripper_down");
    const portReport = reports.get("so101_port_oblique");

    expect(overheadReport).toBeDefined();
    expect(gripperReport).toBeDefined();
    expect(portReport).toBeDefined();
    if (!overheadReport || !gripperReport || !portReport) {
      throw new Error("SO101 camera report was not generated");
    }

    expect(overheadReport.forward.z).toBeLessThan(-0.9);
    expect(overheadReport.visibleTargetCount).toBe(6);

    expect(gripperReport.visibleTargetCount).toBe(6);
    expect(gripperReport.up.z).toBeGreaterThan(0.9);
    expect(gripperReport.forward.dot(
      RED_CONTAINER_PILE_CENTER.clone().sub(gripperReport.position).normalize()
    )).toBeGreaterThan(0.999);

    expect(portReport.visibleTargetCount).toBe(6);
    expect(portReport.up.z).toBeGreaterThan(0.9);
    expect(portReport.forward.dot(
      RED_CONTAINER_PILE_CENTER.clone().sub(portReport.position).normalize()
    )).toBeGreaterThan(0.999);
  });
});
