import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  buildWorldSceneRegistryEnvelope,
  buildWorldScenePackageManifest,
  computeWorldSnapshotDigest,
  refreshWorldSceneRegistryEnvelopeSnapshotDigest,
  refreshWorldScenePackageSnapshotDigest,
  stableStringify,
  toWorldSceneDocument,
  toWorldSceneRegistryEnvelope,
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

const TEST_MESH_OBJECT: CreatedObject = {
  ...TEST_OBJECT,
  id: "mesh-crate",
  type: "mesh",
  position: new THREE.Vector3(0.1, 0.2, 0.3),
  size: new THREE.Vector3(0.4, 0.5, 0.6),
  assetRef: "assets/crate.obj",
  assetScale: new THREE.Vector3(1, 1.2, 1.4),
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

  it("sorts object keys with browser UTF-16 ordering for backend hashing", () => {
    expect(
      stableStringify({
        joint_positions: {
          a: 1,
          z: 2,
          é: 3,
          "𝌆": 4,
          "😀": 5,
          "\ue000": 6,
          "\uffff": 7,
        },
      })
    ).toBe('{"joint_positions":{"a":1,"z":2,"é":3,"𝌆":4,"😀":5,"\ue000":6,"\uffff":7}}');
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
    ).rejects.toThrow("cameras.cam-1.pose.xyz[1] must be a finite number.");
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

  it("converts package manifests to thin registry envelopes", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
      provenance: {
        owner: "scene-team",
        environment: {
          preset: "default",
        },
      },
    });

    const envelope = toWorldSceneRegistryEnvelope(manifest);

    expect(envelope.package_id).toBe(manifest.package_id);
    expect(envelope.version).toBe(manifest.version);
    expect(envelope.provenance).toEqual(manifest.provenance);
    expect(envelope.world.name).toBe(manifest.title);
    expect(envelope.world.urdf_xml).toBe(manifest.world_snapshot.urdf_xml);
    expect(envelope.world.joint_positions).toEqual(manifest.world_snapshot.joint_positions);
    expect(envelope.world.cameras).toEqual(manifest.world_snapshot.cameras);
    expect(envelope.world.objects).toEqual(manifest.world_snapshot.objects);
    expect(envelope.world.environment).toEqual({
      preset: "default",
      frame_convention: manifest.interface.frame_convention,
    });
    expect(envelope).not.toHaveProperty("created_at");
    expect(envelope).not.toHaveProperty("runtime_targets");
    expect(envelope).not.toHaveProperty("interface");
    expect(envelope).not.toHaveProperty("security");
  });

  it("builds thin registry envelopes directly from scene state", async () => {
    const envelope = await buildWorldSceneRegistryEnvelope({
      packageId: "Demo World",
      version: "1.0.0",
      name: "Demo World",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
      provenance: {
        owner: "scene-team",
      },
    });

    expect(envelope).toEqual(
      expect.objectContaining({
        package_id: "demo-world",
        version: "1.0.0",
        provenance: {
          owner: "scene-team",
        },
        world: expect.objectContaining({
          name: "Demo World",
          urdf_xml: "<robot name='demo'/>",
          joint_positions: { joint_1: TEST_JOINT_POSITION_RAD },
          cameras: [TEST_CAMERA],
          scenario_time_ms: TEST_SCENARIO_TIME_MS,
          scenario_duration_ms: TEST_SCENARIO_DURATION_MS,
        }),
      })
    );
    expect(envelope.artifacts).toEqual([
      expect.objectContaining({
        kind: "world_snapshot",
        uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
      }),
    ]);
  });

  it("converts package manifests to authored world documents", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [TEST_CAMERA],
      objects: [TEST_OBJECT],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
      provenance: {
        environment: {
          preset: "default",
        },
      },
    });

    expect(toWorldSceneDocument(manifest)).toEqual({
      name: manifest.title,
      urdf_xml: manifest.world_snapshot.urdf_xml,
      joint_positions: manifest.world_snapshot.joint_positions,
      cameras: manifest.world_snapshot.cameras,
      objects: manifest.world_snapshot.objects,
      scenario_time_ms: manifest.world_snapshot.scenario_time_ms,
      scenario_duration_ms: manifest.world_snapshot.scenario_duration_ms,
      environment: {
        preset: "default",
        frame_convention: "ros-rep-103",
      },
    });
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

  it("preserves mesh asset metadata when serializing world objects", () => {
    expect(toSerializableWorldObject(TEST_MESH_OBJECT)).toEqual(
      expect.objectContaining({
        id: "mesh-crate",
        type: "mesh",
        asset_ref: "assets/crate.obj",
        asset_scale_xyz: [1, 1.2, 1.4],
        position_xyz: [0.1, 0.2, 0.3],
        size_xyz: [0.4, 0.5, 0.6],
      })
    );
  });

  it("preserves imported world layout metadata when serializing world objects", () => {
    const serializable = toSerializableWorldObject({
      ...TEST_MESH_OBJECT,
      assetRef: undefined,
      assetScale: undefined,
      worldMetadata: {
        mesh: {
          path: "assets/crate.glb",
          scale_xyz: [1, 1.2, 1.4],
        },
        physics: {
          fixed: false,
          collision: true,
          mass_kg: 1.5,
          friction: 0.8,
          restitution: 0.1,
          semantic_role: "fixture",
          collision_geometry: {
            id: "crate-proxy",
            kind: "box",
            size_xyz: [0.2, 0.3, 0.4],
          },
          inertia: {
            ixx: 0.01,
            iyy: 0.02,
            izz: 0.03,
          },
        },
        appearance: {
          representations: [
            {
              id: "crate-mesh",
              kind: "mesh",
              asset_ref: "assets/crate.glb",
              scale_xyz: [1, 1, 1],
            },
          ],
        },
        consistency: {
          appearance_ref: "crate-mesh",
          physics_ref: "crate-proxy",
          method: "bbox-fit",
          status: "valid",
          metrics: { coverage: 0.95 },
        },
        simulation: {
          fixed: true,
          collision: true,
          mass_kg: 1.2,
        },
      },
    });

    expect(serializable).toEqual(
      expect.objectContaining({
        mesh: {
          path: "assets/crate.glb",
          scale_xyz: [1, 1.2, 1.4],
        },
        physics: {
          fixed: false,
          collision: true,
          mass_kg: 1.5,
          friction: 0.8,
          restitution: 0.1,
          semantic_role: "fixture",
          collision_geometry: {
            id: "crate-proxy",
            kind: "box",
            size_xyz: [0.2, 0.3, 0.4],
          },
          inertia: {
            ixx: 0.01,
            iyy: 0.02,
            izz: 0.03,
          },
        },
        appearance: {
          representations: [
            {
              id: "crate-mesh",
              kind: "mesh",
              asset_ref: "assets/crate.glb",
              scale_xyz: [1, 1, 1],
            },
          ],
        },
        consistency: {
          appearance_ref: "crate-mesh",
          physics_ref: "crate-proxy",
          method: "bbox-fit",
          status: "valid",
          metrics: { coverage: 0.95 },
        },
        simulation: {
          fixed: true,
          collision: true,
          mass_kg: 1.2,
        },
      })
    );
    expect(serializable.asset_ref).toBeUndefined();
    expect(serializable.asset_scale_xyz).toBeUndefined();
  });

  it("does not export browser-resolved mesh URLs as portable mesh URIs", () => {
    const serializable = toSerializableWorldObject({
      ...TEST_MESH_OBJECT,
      assetRef: undefined,
      assetScale: undefined,
      meshUri: "https://example.test/world-layouts/mesh-demo/collider.glb",
    });

    expect(serializable.asset_ref).toBeUndefined();
    expect(serializable.mesh).toBeUndefined();
  });

  it("exports locally imported splat backgrounds by their portable asset name", () => {
    const serializable = toSerializableWorldObject({
      ...TEST_MESH_OBJECT,
      type: "splat",
      assetRef: "port-background.spz",
      meshUri: "blob:http://localhost/8b2c1f7e-0d3a-4b6e-9f21-3f9d8a2c5e11",
    });

    expect(serializable.type).toBe("splat");
    expect(serializable.asset_ref).toBe("port-background.spz");
    expect(serializable.mesh).toEqual({ uri: "port-background.spz" });
  });

  it("rejects non-positive mesh asset scale before package export", () => {
    expect(() =>
      toSerializableWorldObject({
        ...TEST_MESH_OBJECT,
        assetScale: new THREE.Vector3(1, 0, 1),
      })
    ).toThrow("asset_scale_xyz[1] must be > 0.");
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

  it("detaches camera state before hashing the manifest", async () => {
    const cameras = [TEST_CAMERA];
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras,
      objects: [],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });

    cameras[0].pose.xyz[0] = 99;

    expect(manifest.world_snapshot.cameras[0].pose.xyz[0]).toBe(0);
    expect(manifest.artifacts[0].digest_sha256).toBe(
      await computeWorldSnapshotDigest(manifest.world_snapshot)
    );
  });

  it("rejects non-numeric joint positions before hashing the manifest", async () => {
    await expect(
      buildWorldScenePackageManifest({
        packageId: "Demo World",
        version: "1.0.0",
        urdfXml: "<robot name='demo'/>",
        jointPositions: {
          joint_1: "0.5" as unknown as number,
        },
        cameras: [],
        objects: [],
        scenarioTimeMs: TEST_SCENARIO_TIME_MS,
        scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
      })
    ).rejects.toThrow("joint_positions.joint_1 must be a finite number.");
  });

  it("refreshes stale world snapshot digest artifacts for transfer", async () => {
    const manifest = await buildWorldScenePackageManifest({
      packageId: "Demo World",
      version: "1.0.0",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [],
      objects: [],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
    });
    manifest.artifacts[0].digest_sha256 = "0".repeat(64);

    const refreshed = await refreshWorldScenePackageSnapshotDigest(manifest);

    expect(refreshed.artifacts).toContainEqual({
      kind: "world_snapshot",
      digest_sha256: await computeWorldSnapshotDigest(refreshed.world_snapshot),
      uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
    });
    expect(refreshed.artifacts).not.toContainEqual({
      kind: "world_snapshot",
      digest_sha256: "0".repeat(64),
      uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
    });
  });

  it("refreshes stale world snapshot digest artifacts for thin registry envelopes", async () => {
    const envelope = await buildWorldSceneRegistryEnvelope({
      packageId: "Demo World",
      version: "1.0.0",
      name: "Demo World",
      urdfXml: "<robot name='demo'/>",
      jointPositions: { joint_1: TEST_JOINT_POSITION_RAD },
      cameras: [],
      objects: [],
      scenarioTimeMs: TEST_SCENARIO_TIME_MS,
      scenarioDurationMs: TEST_SCENARIO_DURATION_MS,
      provenance: {},
    });
    envelope.artifacts[0].digest_sha256 = "0".repeat(64);

    const refreshed = await refreshWorldSceneRegistryEnvelopeSnapshotDigest(envelope);

    expect(refreshed.artifacts).toContainEqual({
      kind: "world_snapshot",
      digest_sha256: await computeWorldSnapshotDigest({
        urdf_xml: refreshed.world.urdf_xml ?? "",
        joint_positions: refreshed.world.joint_positions ?? {},
        cameras: refreshed.world.cameras ?? [],
        objects: refreshed.world.objects,
        scenario_time_ms: refreshed.world.scenario_time_ms,
        scenario_duration_ms: refreshed.world.scenario_duration_ms,
      }),
      uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
    });
    expect(refreshed.artifacts).not.toContainEqual({
      kind: "world_snapshot",
      digest_sha256: "0".repeat(64),
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
