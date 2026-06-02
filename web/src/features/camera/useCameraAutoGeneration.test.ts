/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { Camera } from "@/shared/types/camera";
import { useCameraAutoGeneration } from "./useCameraAutoGeneration";

const CAMERA_LINK_NAME = "camera_link";
const CAMERA_JOINT_NAME = "camera_joint";
const INITIAL_LINK_OFFSET_X = 0.02;
const UPDATED_LINK_OFFSET_X = 0.08;
const AUTO_CAMERA_NAME = `Auto Camera: ${CAMERA_LINK_NAME}`;
const DEFAULT_LOAD_SIGNATURE = "sig-1";
const NEXT_LOAD_SIGNATURE = "sig-2";

type HookResult = ReturnType<typeof useCameraAutoGeneration> | null;

const createRobotWithCameraLink = () => {
  const robot = new THREE.Group() as unknown as URDFRobot;
  const link = new THREE.Group();
  link.name = CAMERA_LINK_NAME;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.02));
  mesh.position.set(INITIAL_LINK_OFFSET_X, 0, 0);
  link.add(mesh);
  robot.add(link);

  const joint = new THREE.Group() as THREE.Group & { childLink?: string };
  joint.name = CAMERA_JOINT_NAME;
  joint.childLink = CAMERA_LINK_NAME;
  robot.add(joint);

  (robot as URDFRobot & { links: URDFRobot["links"] }).links = {
    [CAMERA_LINK_NAME]: link,
  } as unknown as URDFRobot["links"];
  (robot as URDFRobot & { joints: URDFRobot["joints"] }).joints = {
    [CAMERA_JOINT_NAME]: joint,
  } as unknown as URDFRobot["joints"];
  robot.updateMatrixWorld(true);

  return { robot, mesh };
};

const createUrdfAnalysis = (): UrdfAnalysis =>
  ({
    isValid: true,
    robotName: "test",
    linkNames: [CAMERA_LINK_NAME],
    rootLinks: [CAMERA_LINK_NAME],
    childLinks: [CAMERA_LINK_NAME],
    jointByChildLink: {},
    jointLimits: {},
    jointAxes: {},
    jointHierarchy: {
      rootJoints: [],
      allJoints: new Map(),
      orderedJoints: [
        {
          jointName: CAMERA_JOINT_NAME,
          childLink: CAMERA_LINK_NAME,
          parentLink: "base_link",
          type: "fixed",
          children: [],
          depth: 0,
          order: 0,
        },
      ],
    },
    sensors: [],
    meshReferences: [],
    absoluteFileMeshRefs: [],
    inertials: [],
    collisionEntries: [],
    collisionsByLink: {},
    linkDataByName: {},
  } as UrdfAnalysis);

const createCameraStoreStubs = () => {
  let cameraIndex = 0;
  const cameras: Camera[] = [];

  const addCamera = vi.fn((camera: Omit<Camera, "id">) => {
    cameraIndex += 1;
    cameras.push({ ...camera, id: `cam-${cameraIndex}` });
  });
  const updateCamera = vi.fn((id: string, updates: Partial<Omit<Camera, "id">>) => {
    const index = cameras.findIndex((camera) => camera.id === id);
    if (index < 0) return;
    cameras[index] = { ...cameras[index], ...updates };
  });
  const removeCamera = vi.fn((id: string) => {
    const index = cameras.findIndex((camera) => camera.id === id);
    if (index < 0) return;
    cameras.splice(index, 1);
  });

  return { cameras, addCamera, updateCamera, removeCamera };
};

describe("useCameraAutoGeneration load stability", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("freezes auto camera pose after first valid solve for the same load signature", async () => {
    const { robot, mesh } = createRobotWithCameraLink();
    const urdfAnalysis = createUrdfAnalysis();
    const { cameras, addCamera, updateCamera, removeCamera } = createCameraStoreStubs();
    const optionsRef: {
      current: Parameters<typeof useCameraAutoGeneration>[0];
    } = {
      current: {
        robot,
        urdfAnalysis,
        availableLinks: [CAMERA_LINK_NAME],
        thumbnailMode: false,
        loadSignature: DEFAULT_LOAD_SIGNATURE,
        addCamera,
        updateCamera,
        removeCamera,
      },
    };
    let hookResult: HookResult = null;

    const Harness = () => {
      hookResult = useCameraAutoGeneration(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      hookResult?.ensureDetectedCamerasForLoadedRobot(cameras);
    });
    expect(addCamera).toHaveBeenCalledTimes(1);
    expect(cameras[0]?.name).toBe(AUTO_CAMERA_NAME);
    const frozenPose = cameras[0]?.pose;

    mesh.position.set(UPDATED_LINK_OFFSET_X, 0, 0);
    robot.updateMatrixWorld(true);

    await act(async () => {
      hookResult?.ensureDetectedCamerasForLoadedRobot(cameras);
    });
    expect(updateCamera).toHaveBeenCalledTimes(0);
    expect(cameras[0]?.pose).toEqual(frozenPose);

    await act(async () => {
      root.unmount();
    });
  });

  it("resets frozen auto camera state when load signature changes", async () => {
    const { robot, mesh } = createRobotWithCameraLink();
    const urdfAnalysis = createUrdfAnalysis();
    const { cameras, addCamera, updateCamera, removeCamera } = createCameraStoreStubs();
    const optionsRef: {
      current: Parameters<typeof useCameraAutoGeneration>[0];
    } = {
      current: {
        robot,
        urdfAnalysis,
        availableLinks: [CAMERA_LINK_NAME],
        thumbnailMode: false,
        loadSignature: DEFAULT_LOAD_SIGNATURE,
        addCamera,
        updateCamera,
        removeCamera,
      },
    };
    let hookResult: HookResult = null;

    const Harness = () => {
      hookResult = useCameraAutoGeneration(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      hookResult?.ensureDetectedCamerasForLoadedRobot(cameras);
    });
    expect(addCamera).toHaveBeenCalledTimes(1);

    mesh.position.set(UPDATED_LINK_OFFSET_X, 0, 0);
    robot.updateMatrixWorld(true);
    optionsRef.current = {
      ...optionsRef.current,
      loadSignature: NEXT_LOAD_SIGNATURE,
    };
    await act(async () => {
      root.render(createElement(Harness));
    });
    await act(async () => {
      hookResult?.ensureDetectedCamerasForLoadedRobot(cameras);
    });

    expect(removeCamera).toHaveBeenCalledTimes(1);
    expect(addCamera).toHaveBeenCalledTimes(2);
    expect(cameras[0]?.name).toBe(AUTO_CAMERA_NAME);

    await act(async () => {
      root.unmount();
    });
  });

  it("tracks pending geometry until an auto camera mount resolves", async () => {
    const robot = new THREE.Group() as unknown as URDFRobot;
    const link = new THREE.Group();
    link.name = CAMERA_LINK_NAME;
    robot.add(link);

    const joint = new THREE.Group() as THREE.Group & { childLink?: string };
    joint.name = CAMERA_JOINT_NAME;
    joint.childLink = CAMERA_LINK_NAME;
    robot.add(joint);

    (robot as URDFRobot & { links: URDFRobot["links"] }).links = {
      [CAMERA_LINK_NAME]: link,
    } as unknown as URDFRobot["links"];
    (robot as URDFRobot & { joints: URDFRobot["joints"] }).joints = {
      [CAMERA_JOINT_NAME]: joint,
    } as unknown as URDFRobot["joints"];
    robot.updateMatrixWorld(true);

    const urdfAnalysis = createUrdfAnalysis();
    const { cameras, addCamera, updateCamera, removeCamera } = createCameraStoreStubs();
    const optionsRef: {
      current: Parameters<typeof useCameraAutoGeneration>[0];
    } = {
      current: {
        robot,
        urdfAnalysis,
        availableLinks: [CAMERA_LINK_NAME],
        thumbnailMode: false,
        loadSignature: DEFAULT_LOAD_SIGNATURE,
        addCamera,
        updateCamera,
        removeCamera,
      },
    };
    let hookResult: HookResult = null;

    const Harness = () => {
      hookResult = useCameraAutoGeneration(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      hookResult?.ensureDetectedCamerasForLoadedRobot(cameras);
    });
    expect(hookResult?.autoCameraBootstrapState).toBe("pending-geometry");
    expect(addCamera).toHaveBeenCalledTimes(0);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.02));
    mesh.position.set(INITIAL_LINK_OFFSET_X, 0, 0);
    link.add(mesh);
    robot.updateMatrixWorld(true);

    await act(async () => {
      hookResult?.ensureDetectedCamerasForLoadedRobot(cameras);
    });
    expect(hookResult?.autoCameraBootstrapState).toBe("settled");
    expect(addCamera).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
