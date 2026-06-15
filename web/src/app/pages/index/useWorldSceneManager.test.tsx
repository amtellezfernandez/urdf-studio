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

  it("packages the default world layout in the same tick it is imported for transfer", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
    };
    let manager: ReturnType<typeof useWorldSceneManager> | null = null;

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(true);
      const [objects, setObjects] = useState<CreatedObject[]>([]);
      const [cameras, setCameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});
      const nextGeneratedIdRef = useRef(0);

      manager = useWorldSceneManager({
        addCamera: (camera) => {
          setCameras((previous) => [
            ...previous,
            { ...camera, id: `camera-${previous.length}` },
          ]);
        },
        addObject: (object) => {
          const fallbackId = `object-${nextGeneratedIdRef.current++}`;
          setObjects((previous) => [...previous, toCreatedObject(object, fallbackId)]);
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

    let objects: Array<{ id: string; source: string }> = [];
    await act(async () => {
      await manager?.ensureWorldLayoutForTransfer();
      const manifest = await manager?.buildCurrentWorldScenePackageManifest();
      objects =
        manifest?.world_snapshot.objects.map((object) => ({
          id: object.id,
          source: object.source,
        })) ?? [];
    });

    expect(objects).toEqual([{ id: "layout-crate", source: "demo-world" }]);

    await act(async () => {
      root.unmount();
    });
  });

  it("merges the default world layout for transfer when only user objects are present", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
    };
    const userObject: CreatedObject = {
      id: "manual-target",
      type: "point",
      position: new Vector3(0.1, 0.2, 0.3),
      rotation: normalizeWorldObjectRotationEuler(null),
      size: new Vector3(0.04, 0.04, 0.04),
      color: "#f472b6",
      source: "user",
      trackedJointName: null,
      isIkTarget: true,
      ikTargetType: "punctual",
    };
    let manager: ReturnType<typeof useWorldSceneManager> | null = null;

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(true);
      const [objects, setObjects] = useState<CreatedObject[]>([userObject]);
      const [cameras, setCameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});
      const nextGeneratedIdRef = useRef(0);

      manager = useWorldSceneManager({
        addCamera: (camera) => {
          setCameras((previous) => [
            ...previous,
            { ...camera, id: `camera-${previous.length}` },
          ]);
        },
        addObject: (object) => {
          const fallbackId = `object-${nextGeneratedIdRef.current++}`;
          setObjects((previous) => [...previous, toCreatedObject(object, fallbackId)]);
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

    let objects: Array<{ id: string; source: string }> = [];
    await act(async () => {
      await manager?.ensureWorldLayoutForTransfer();
      const manifest = await manager?.buildCurrentWorldScenePackageManifest();
      objects =
        manifest?.world_snapshot.objects.map((object) => ({
          id: object.id,
          source: object.source,
        })) ?? [];
    });

    expect(objects).toEqual([
      { id: "manual-target", source: "user" },
      { id: "layout-crate", source: "demo-world" },
    ]);

    await act(async () => {
      root.unmount();
    });
  });

  it("adds the default transfer layout when an explicit scene is empty", async () => {
    const fixture = {
      urdf: '<robot name="demo"><link name="base"/></robot>',
    };
    let manager: ReturnType<typeof useWorldSceneManager> | null = null;

    const Harness = () => {
      const skipDefaultWorldLayoutAutoImportRef = useRef(true);
      const [objects, setObjects] = useState<CreatedObject[]>([]);
      const [cameras, setCameras] = useState<Camera[]>([]);
      const [jointValues, setJointValues] = useState<Record<string, number>>({});
      const nextGeneratedIdRef = useRef(0);

      manager = useWorldSceneManager({
        addCamera: (camera) => {
          setCameras((previous) => [
            ...previous,
            { ...camera, id: `camera-${previous.length}` },
          ]);
        },
        addObject: (object) => {
          const fallbackId = `object-${nextGeneratedIdRef.current++}`;
          setObjects((previous) => [...previous, toCreatedObject(object, fallbackId)]);
        },
        cameras,
        clearCameras: () => setCameras([]),
        clearObjects: () => setObjects([]),
        hasExplicitWorldImport: true,
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

    let objectSources: string[] = [];
    await act(async () => {
      await manager?.ensureWorldLayoutForTransfer();
      const manifest = await manager?.buildCurrentWorldScenePackageManifest();
      objectSources = manifest?.world_snapshot.objects.map((object) => object.source) ?? [];
    });

    expect(objectSources).toEqual(["demo-world"]);

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
});
