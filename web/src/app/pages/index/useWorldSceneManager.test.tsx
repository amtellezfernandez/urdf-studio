/** @vitest-environment jsdom */
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_WORLD_IMPORT_PARAMS } from "@/app/pages/index/indexPageParams";
import { useWorldSceneManager } from "@/app/pages/index/useWorldSceneManager";
import type { CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import type { Camera } from "@/shared/types/camera";

const createWorldLayoutResponse = () => ({
  world_layout: {
    name: "Default Test Layout",
    objects: [
      {
        id: "layout-crate",
        name: "Layout crate",
        type: "cube",
        position_xyz: [0.2, 0.1, 0.3],
        rotation_rpy_rad: [0.0, 0.0, 0.0],
        size_xyz: [0.4, 0.5, 0.6],
        color: "#22c55e",
      },
    ],
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
  },
});

const toCreatedObject = (
  object: Omit<CreatedObject, "id"> & Partial<Pick<CreatedObject, "id">>,
  fallbackId: string
): CreatedObject => ({
  ...object,
  id: object.id ?? fallbackId,
  position: object.position.clone(),
  rotation: normalizeWorldObjectRotationEuler(object.rotation),
  size: object.size.clone(),
  assetScale: object.assetScale?.clone(),
  trackedJointName: object.trackedJointName,
  isIkTarget: object.isIkTarget,
});

describe("useWorldSceneManager", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => createWorldLayoutResponse(),
      } as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not auto-import default background objects when the active manifest suppresses them", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
    };

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(false);
      const [objects] = useState<CreatedObject[]>([]);
      const [cameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});

      useWorldSceneManager({
        addCamera: vi.fn(),
        addObject: vi.fn(),
        cameras,
        clearCameras: vi.fn(),
        clearObjects: vi.fn(),
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
        hasLoadedFiles: true,
        jointValues,
        objects,
        originalUrdfContent: fixture.urdf,
        resolvedRobotName: "demo",
        skipDefaultWorldLayoutAutoImportRef,
        suppressDefaultWorldLayoutAutoImport: true,
        setJointValues,
        updateUrdfFile: vi.fn(),
        vizUrdfContent: fixture.urdf,
        worldImportParams: EMPTY_WORLD_IMPORT_PARAMS,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("does not auto-import default background objects for normal loaded robots", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
    };

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(false);
      const [objects] = useState<CreatedObject[]>([]);
      const [cameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});

      useWorldSceneManager({
        addCamera: vi.fn(),
        addObject: vi.fn(),
        cameras,
        clearCameras: vi.fn(),
        clearObjects: vi.fn(),
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
        hasLoadedFiles: true,
        jointValues,
        objects,
        originalUrdfContent: fixture.urdf,
        resolvedRobotName: "demo",
        skipDefaultWorldLayoutAutoImportRef,
        setJointValues,
        updateUrdfFile: vi.fn(),
        vizUrdfContent: fixture.urdf,
        worldImportParams: EMPTY_WORLD_IMPORT_PARAMS,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("builds transfer packages from the live object source when provided", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
    };
    const liveObject: CreatedObject = {
      id: "live-crate",
      type: "cube",
      position: new Vector3(0.3, 0.2, 0.1),
      rotation: normalizeWorldObjectRotationEuler(null),
      size: new Vector3(0.2, 0.2, 0.2),
      color: "#22c55e",
      source: "user",
      trackedJointName: null,
      isIkTarget: true,
      ikTargetType: "punctual",
    };
    let manager: ReturnType<typeof useWorldSceneManager> | null = null;

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(true);
      const [objects, setObjects] = useState<CreatedObject[]>([]);
      const [cameras, setCameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});

      manager = useWorldSceneManager({
        addCamera: (camera) => {
          setCameras((previous) => [
            ...previous,
            { ...camera, id: `camera-${previous.length}` },
          ]);
        },
        addObject: (object) => {
          setObjects((previous) => [...previous, toCreatedObject(object, "object-0")]);
        },
        cameras,
        clearCameras: () => setCameras([]),
        clearObjects: () => setObjects([]),
        getObjectsForTransfer: () => [liveObject],
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
        hasLoadedFiles: true,
        jointValues,
        objects,
        originalUrdfContent: fixture.urdf,
        resolvedRobotName: "demo",
        skipDefaultWorldLayoutAutoImportRef,
        setJointValues,
        updateUrdfFile: vi.fn(),
        vizUrdfContent: fixture.urdf,
        worldImportParams: EMPTY_WORLD_IMPORT_PARAMS,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    let objectIds: string[] = [];
    await act(async () => {
      const manifest = await manager?.buildCurrentWorldScenePackageManifest();
      objectIds = manifest?.world_snapshot.objects.map((object) => object.id) ?? [];
    });

    expect(objectIds).toEqual(["live-crate"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("applies embedded robot state from world layout imports when present", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
      importedUrdf: '<robot name="layout-demo"><link name="layout_base"/></robot>',
    };
    const updateUrdfFile = vi.fn();
    let manager: ReturnType<typeof useWorldSceneManager> | null = null;
    let camerasSnapshot: Camera[] = [];
    let jointValuesSnapshot: Record<string, number> = {};

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        url: "https://cdn.example.test/worlds/layout.json",
        json: async () => ({
          world_layout: {
            name: "Imported layout",
            urdf_xml: fixture.importedUrdf,
            joint_positions: { shoulder: 0.5 },
            cameras: [
              {
                id: "overview-camera",
                name: "Overview Camera",
                parent_joint: "base",
                pose: {
                  xyz: [1, 2, 3],
                  rpy: [0, 0, 0],
                },
                intrinsics: {
                  width: 1280,
                  height: 720,
                  fov_deg: 60,
                },
              },
            ],
            objects: [
              {
                id: "layout-crate",
                name: "Layout crate",
                type: "cube",
                position_xyz: [0.2, 0.1, 0.3],
                rotation_rpy_rad: [0.0, 0.0, 0.0],
                size_xyz: [0.4, 0.5, 0.6],
                color: "#22c55e",
              },
            ],
            scenario_time_ms: 0,
            scenario_duration_ms: 0,
          },
        }),
      } as Response;
    });

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(true);
      const [objects, setObjects] = useState<CreatedObject[]>([]);
      const [cameras, setCameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});
      camerasSnapshot = cameras;
      jointValuesSnapshot = jointValues;

      manager = useWorldSceneManager({
        addCamera: (camera) => {
          setCameras((previous) => [
            ...previous,
            { ...camera, id: `camera-${previous.length}` },
          ]);
        },
        addObject: (object) => {
          setObjects((previous) => [...previous, toCreatedObject(object, `object-${previous.length}`)]);
        },
        cameras,
        clearCameras: () => setCameras([]),
        clearObjects: () => setObjects([]),
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
        hasLoadedFiles: true,
        jointValues,
        objects,
        originalUrdfContent: fixture.urdf,
        resolvedRobotName: "demo",
        skipDefaultWorldLayoutAutoImportRef,
        setJointValues,
        updateUrdfFile,
        vizUrdfContent: fixture.urdf,
        worldImportParams: EMPTY_WORLD_IMPORT_PARAMS,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    await act(async () => {
      await manager?.handleImportWorldLayoutFromEntry("https://example.test/layout.json");
    });

    expect(updateUrdfFile).toHaveBeenCalledWith(fixture.importedUrdf, "Imported layout.urdf");
    expect(jointValuesSnapshot).toEqual({ shoulder: 0.5 });
    expect(camerasSnapshot).toHaveLength(1);
    expect(camerasSnapshot[0]?.name).toBe("Overview Camera");

    await act(async () => {
      root.unmount();
    });
  });
});
