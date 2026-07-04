import { describe, expect, it } from "vitest";
import {
  STATIC_WORLD_LAYOUT_KIND,
  STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
} from "@/features/world-share/worldScenePackageParams";
import type { WorldSceneLayerSnapshot } from "@/features/world-share/worldSceneManifest";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";
import {
  applyWorldSceneLayerObjectSourceOverride,
  toImportedCreatedObjects,
  toImportedWorldSceneCameras,
} from "@/app/pages/index/worldSceneManagerHelpers";

describe("world scene manager helper conversions", () => {
  const createSerializableWorldObject = (
    overrides: Partial<WorldScenePackageManifest["world_snapshot"]["objects"][number]> = {}
  ): WorldScenePackageManifest["world_snapshot"]["objects"][number] => ({
    id: "crate",
    name: "Crate",
    type: "mesh",
    position_xyz: [0.1, 0.2, 0.3],
    rotation_rpy_rad: [0.4, 0.5, 0.6],
    size_xyz: [0.7, 0.8, 0.9],
    color: "#336699",
    asset_ref: "meshes/crate.stl",
    asset_scale_xyz: [2, 3, 4],
    source: "user",
    tracked_joint_name: "wrist_roll",
    is_ik_target: true,
    ik_target_type: "orbit",
    orbit_radius: 0.25,
    orbit_inclination_deg: 15,
    orbit_phase_deg: 45,
    orbit_secondary_offset_deg: 90,
    orbit_target_point: "secondary",
    ...overrides,
  });

  it("maps serializable objects into editable created objects", () => {
    const importedObjects = toImportedCreatedObjects([createSerializableWorldObject()]);
    const importedObject = importedObjects[0];

    expect(importedObject).toMatchObject({
      id: "crate",
      type: "mesh",
      color: "#336699",
      assetRef: "meshes/crate.stl",
      source: "user",
      trackedJointName: "wrist_roll",
      isIkTarget: true,
      ikTargetType: "orbit",
      orbitRadius: 0.25,
      orbitInclination: 15,
      orbitPhase: 45,
      orbitSecondaryOffset: 90,
      orbitTargetPoint: "secondary",
    });
    expect(importedObject?.position.toArray()).toEqual([0.1, 0.2, 0.3]);
    expect(importedObject?.size.toArray()).toEqual([0.7, 0.8, 0.9]);
    expect(importedObject?.assetScale?.toArray()).toEqual([2, 3, 4]);
    expect(importedObject?.rotation?.x).toBe(0.4);
    expect(importedObject?.rotation?.y).toBe(0.5);
    expect(importedObject?.rotation?.z).toBe(0.6);
  });

  it("maps package cameras into camera inputs without persisted ids", () => {
    const importedCameras = toImportedWorldSceneCameras([
      {
        id: "cam-1",
        name: "Wrist camera",
        parent_joint: "wrist_roll",
        pose: {
          xyz: [0.1, 0.2, 0.3],
          rpy: [0.4, 0.5, 0.6],
        },
        intrinsics: {
          width: 640,
          height: 480,
          fov_deg: 70,
        },
      },
    ]);

    expect(importedCameras).toEqual([
      {
        name: "Wrist camera",
        parent_joint: "wrist_roll",
        pose: {
          xyz: [0.1, 0.2, 0.3],
          rpy: [0.4, 0.5, 0.6],
        },
        intrinsics: {
          width: 640,
          height: 480,
          fov_deg: 70,
        },
      },
    ]);
    expect(importedCameras[0]).not.toHaveProperty("id");
  });

  it("applies source overrides to world layout objects without mutating the input layout", () => {
    const worldLayout: WorldSceneLayerSnapshot = {
      kind: STATIC_WORLD_LAYOUT_KIND,
      name: "Shared layout",
      objects: [createSerializableWorldObject()],
      scenario_time_ms: STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
      scenario_duration_ms: STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
      environment: null,
    };

    const importedWorldLayout = applyWorldSceneLayerObjectSourceOverride(worldLayout, "demo-world");

    expect(importedWorldLayout.objects[0]?.source).toBe("demo-world");
    expect(worldLayout.objects[0]?.source).toBe("user");
    expect(importedWorldLayout.objects[0]).not.toBe(worldLayout.objects[0]);
  });

  it("preserves existing object sources when no source override is provided", () => {
    const worldLayout: WorldSceneLayerSnapshot = {
      kind: STATIC_WORLD_LAYOUT_KIND,
      objects: [createSerializableWorldObject({ source: "world-scenario" })],
      scenario_time_ms: STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
      scenario_duration_ms: STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
      environment: null,
    };

    const importedWorldLayout = applyWorldSceneLayerObjectSourceOverride(worldLayout);

    expect(importedWorldLayout.objects[0]?.source).toBe("world-scenario");
  });
});
