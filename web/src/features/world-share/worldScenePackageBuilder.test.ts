import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  buildWorldScenePackageManifest,
  stableStringify,
  toSerializableWorldObject,
  toWorldSceneLayerDownloadName,
  toWorldScenePackageDownloadName,
} from "@/features/world-share/worldScenePackageBuilder";
import type { CreatedObject } from "@/features/objects";
import {
  WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE,
  WORLD_SCENE_PACKAGE_URI_SCHEME,
} from "@/features/world-share/worldScenePackageParams";
import type { Camera } from "@/shared/types/camera";
import { WORLD_OBJECT_GEOMETRY_PARAMS } from "@/features/objects/worldObjectGeometryParams";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";

const TEST_SCENARIO_TIME_MS = 200;
const TEST_SCENARIO_DURATION_MS = 12_000;
const TEST_JOINT_POSITION_RAD = 0.5;
const TEST_OBJECT_ORBIT_RADIUS = 0.45;
const TEST_OBJECT_ORBIT_INCLINATION_DEG = 30;
const TEST_OBJECT_ORBIT_PHASE_DEG = 20;
const TEST_OBJECT_ORBIT_SECONDARY_OFFSET_DEG = 160;
const WORLD_SCENE_PACKAGE_BUILDER_TEST_FIXTURES = {
  expectedWorldSnapshotDigest: "d8dbd551c2b41b1311022aa1e522c58ccc9062e6b9f729786f4427e84d7c8102",
};

const TEST_CAMERA: Camera = {
  id: "cam-1",
  name: "cam-1",
  parent_joint: "base_joint",
  pose: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  intrinsics: {
    width: 640,
    height: 480,
    fov_deg: 60,
  },
};

const TEST_OBJECT: CreatedObject = {
  id: "obj-1",
  type: "cube",
  position: new THREE.Vector3(1, 2, 3),
  rotation: new THREE.Euler(0.1, 0.2, 0.3, "XYZ"),
  size: new THREE.Vector3(0.2, 0.2, 0.2),
  color: "#ff0000",
  source: "user",
  trackedJointName: "joint_1",
  isIkTarget: true,
  ikTargetType: "orbit",
  orbitRadius: TEST_OBJECT_ORBIT_RADIUS,
  orbitInclination: TEST_OBJECT_ORBIT_INCLINATION_DEG,
  orbitPhase: TEST_OBJECT_ORBIT_PHASE_DEG,
  orbitSecondaryOffset: TEST_OBJECT_ORBIT_SECONDARY_OFFSET_DEG,
  orbitTargetPoint: "secondary",
};

const TEST_PUNCTUAL_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "obj-2",
  ikTargetType: "punctual",
};

const TEST_HIDDEN_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "obj-3",
  isHidden: true,
};

const TEST_SPHERE_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "obj-sphere",
  type: "sphere",
  size: new THREE.Vector3(0.3, 0.2, 0.1),
};

const TEST_CYLINDER_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "obj-cylinder",
  type: "cylinder",
  size: new THREE.Vector3(0.1, 0.2, 0.4),
};

const TEST_POINT_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "obj-point",
  type: "point",
  size: new THREE.Vector3(0.08, 0.08, 0.08),
};

const TEST_INVALID_GEOMETRY_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "obj-4",
  position: new THREE.Vector3(Number.NaN, 2, Number.POSITIVE_INFINITY),
  size: new THREE.Vector3(Number.NaN, -0.2, 0.3),
};

describe("buildWorldScenePackageManifest", () => {
  it("canonicalizes JSON like backend world snapshot hashing", () => {
    expect(
      stableStringify({
        b: undefined,
        a: 1,
        c: [undefined, { z: undefined, y: "ok" }],
      })
    ).toBe('{"a":1,"c":[null,{"y":"ok"}]}');
  });

  it("canonicalizes exponent numbers and unicode like backend world snapshot hashing", () => {
    expect(
      stableStringify({
        urdf_xml: "<robot name='café'/>",
        joint_positions: {
          tiny: 1e-7,
          micro: 1e-6,
          large: 1e20,
        },
      })
    ).toBe(
      '{"joint_positions":{"large":100000000000000000000,"micro":0.000001,"tiny":1e-7},"urdf_xml":"<robot name=\'café\'/>"}'
    );
  });

  it("rejects non-finite numbers before hashing a world snapshot", () => {
    expect(() => stableStringify({ position_xyz: [0, Number.NaN, 1] })).toThrow(
      "Cannot canonicalize a non-finite world scene package number."
    );
    expect(() => stableStringify({ position_xyz: [0, Number.POSITIVE_INFINITY, 1] })).toThrow(
      "Cannot canonicalize a non-finite world scene package number."
    );
  });

  it("rejects camera payloads with non-finite numbers before package export", async () => {
    const invalidCamera: Camera = {
      ...TEST_CAMERA,
      pose: {
        xyz: [0, Number.NaN, 0],
        rpy: [0, 0, 0],
      },
    };

    await expect(
      buildWorldScenePackageManifest({
        packageId: "Demo World",
        version: "1.0.0",
        urdfXml: "<robot name='demo'/>",
        jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
        cameras: [invalidCamera],
        objects: [],
        scenarioTimeMs: TEST_SCENARIO_TIME_MS,
        scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
      })
    ).rejects.toThrow("Cannot canonicalize a non-finite world scene package number.");
  });

  it("emits a scene-first world manifest without model-planning coupling", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    expect("planning" in manifest.interface).toBe(false);
    expect(manifest.world_snapshot.objects[0].name).toBe(TEST_OBJECT.id);
    expect(manifest.world_snapshot.objects[0]).not.toHaveProperty("is_hidden");
    expect(manifest.world_snapshot.objects[0].rotation_rpy_rad).toEqual([0.1, 0.2, 0.3]);
    expect(manifest.world_snapshot.objects[0].orbit_radius).toBe(TEST_OBJECT_ORBIT_RADIUS);
    expect(manifest.world_snapshot.objects[0].orbit_inclination_deg).toBe(
      TEST_OBJECT_ORBIT_INCLINATION_DEG
    );
  });

  it("serializes rotation for non-point primitives and normalizes primitive size semantics", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_SPHERE_OBJECT, TEST_CYLINDER_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    expect(manifest.world_snapshot.objects[0].type).toBe("sphere");
    expect(manifest.world_snapshot.objects[0].rotation_rpy_rad).toEqual([0.1, 0.2, 0.3]);
    expect(manifest.world_snapshot.objects[0].size_xyz).toEqual([0.3, 0.3, 0.3]);
    expect(manifest.world_snapshot.objects[1].type).toBe("cylinder");
    expect(manifest.world_snapshot.objects[1].rotation_rpy_rad).toEqual([0.1, 0.2, 0.3]);
    expect(manifest.world_snapshot.objects[1].size_xyz).toEqual([0.2, 0.2, 0.4]);
  });

  it("exports point markers at the same size Studio renders", () => {
    expect(toSerializableWorldObject(TEST_POINT_OBJECT).size_xyz).toEqual([
      WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM,
      WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM,
      WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM,
    ]);
  });

  it("omits orbit fields for non-orbit objects", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_PUNCTUAL_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    const exportedObject = manifest.world_snapshot.objects[0];
    expect(exportedObject.ik_target_type).toBe("punctual");
    expect(exportedObject).not.toHaveProperty("orbit_radius");
    expect(exportedObject).not.toHaveProperty("orbit_inclination_deg");
    expect(exportedObject).not.toHaveProperty("orbit_phase_deg");
    expect(exportedObject).not.toHaveProperty("orbit_secondary_offset_deg");
    expect(exportedObject).not.toHaveProperty("orbit_target_point");
  });

  it("preserves hidden-state only when object is hidden", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_OBJECT, TEST_HIDDEN_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    expect(manifest.world_snapshot.objects[0]).not.toHaveProperty("is_hidden");
    expect(manifest.world_snapshot.objects[1].is_hidden).toBe(true);
  });

  it("normalizes invalid object geometry when serializing world snapshots", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_INVALID_GEOMETRY_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    const exportedObject = manifest.world_snapshot.objects[0];
    expect(exportedObject.position_xyz).toEqual([
      WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM,
      2,
      WORLD_OBJECT_GEOMETRY_PARAMS.fallbackPositionM,
    ]);
    expect(exportedObject.size_xyz[0]).toBeGreaterThanOrEqual(
      WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM
    );
    expect(exportedObject.size_xyz[1]).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(exportedObject.size_xyz[2]).toBe(0.3);
  });

  it("sanitizes package id and falls back to proprio modality without cameras", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "  Demo @ World  ",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [],
      objects: [],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    expect(manifest.package_id).toBe("demo-world");
    expect(manifest.interface.observation_modalities).toEqual(["proprio"]);
  });

  it("emits a backend-compatible world snapshot digest artifact", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    expect(manifest.artifacts).toContainEqual({
      kind: "world_snapshot",
      digest_sha256: WORLD_SCENE_PACKAGE_BUILDER_TEST_FIXTURES.expectedWorldSnapshotDigest,
      uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
    });
  });

  it("emits stable download filenames for world packages and world layouts", () => {
    expect(toWorldScenePackageDownloadName(" Demo World ", "1.2.3")).toBe(
      "demo-world-1.2.3.world-package.json"
    );
    expect(toWorldSceneLayerDownloadName(" Demo World ", "1.2.3")).toBe(
      "demo-world-1.2.3.world-layout.json"
    );
  });

  it("rejects package build when secure hashing is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      await expect(
        buildWorldScenePackageManifest({
          packageId: "Demo World",
          version: "1.0.0",
          urdfXml: "<robot name='demo'/>",
          jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
          cameras: [TEST_CAMERA],
          objects: [TEST_OBJECT],
          scenarioTimeMs: TEST_SCENARIO_TIME_MS,
          scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
        })
      ).rejects.toMatchObject({
        name: "WorldScenePackageBuildError",
        code: WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE,
      });
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
      vi.unstubAllGlobals();
    }
  });
});
