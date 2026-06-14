import { describe, expect, it } from "vitest";
import {
  STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR,
  WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS,
} from "@/features/world-share/worldScenePackageParams";

import {
  createStaticWorldSceneLayerSnapshot,
  isWorldSceneManifest,
  parseStaticWorldSceneLayerSnapshot,
  readWorldSceneLayerFromUnknown,
  validateLocalWorldSceneManifest,
  validateWorldSceneLayerSnapshot,
} from "@/features/world-share/worldSceneManifest";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

const createWorldLayoutObject = () => ({
  id: "desk-cube",
  name: "Desk cube",
  type: "cube" as const,
  position_xyz: [0.2, 0.1, 0.3] as [number, number, number],
  rotation_rpy_rad: [0.1, 0.2, 0.3] as [number, number, number],
  size_xyz: [0.4, 0.5, 0.6] as [number, number, number],
  color: "#ff0000",
  tracked_joint_name: null,
  is_ik_target: false,
  ik_target_type: "punctual" as const,
});

const createWorldCamera = () => ({
  id: "cam",
  name: "Scene camera",
  parent_joint: "base_link",
  pose: {
    xyz: [0, 0, 0] as [number, number, number],
    rpy: [0, 0, 0] as [number, number, number],
  },
  intrinsics: {
    width: 640,
    height: 480,
    fov_deg: 60,
    fx: 501,
    fy: 502,
    cx: 319.5,
    cy: 241.25,
  },
});

const createManifest = (
  overrides?: Partial<WorldScenePackageManifest["world_snapshot"]>
): WorldScenePackageManifest => ({
  schema_version: "1.0.0",
  package_id: "demo-scene",
  version: "0.1.0",
  title: "Demo Scene",
  created_at: new Date().toISOString(),
  runtime_targets: [],
  interface: {
    observation_modalities: ["proprio"],
    action_semantics: "joint_position_rad",
    timestep_ms: 33,
    frame_convention: "ros-rep-103",
  },
  artifacts: [],
  world_snapshot: {
    urdf_xml: "<robot name='demo'/>",
    joint_positions: {},
    cameras: [],
    objects: [createWorldLayoutObject()],
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
    ...overrides,
  },
  provenance: {},
  security: {
    signature_ref: null,
    attestation_refs: [],
    sbom_ref: null,
  },
});

describe("worldSceneManifest static scene validation", () => {
  it("accepts static scene package snapshots (duration 0, time 0)", () => {
    const errors = validateLocalWorldSceneManifest(createManifest());
    expect(errors).toEqual([]);
  });

  it("rejects static scene snapshots when time is not zero", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        scenario_time_ms: 100,
        scenario_duration_ms: 0,
      })
    );
    expect(errors).toContain(
      "world_snapshot.scenario_time_ms must be 0 when scenario_duration_ms is 0"
    );
  });

  it("rejects scene package snapshots exceeding max scenario duration", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        scenario_duration_ms: WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS + 1,
      })
    );
    expect(errors).toContain(
      `world_snapshot.scenario_duration_ms must be between 0 and ${WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS}`
    );
  });

  it("rejects fractional scene package timing", () => {
    const manifest = createManifest({
      scenario_time_ms: 0.5,
      scenario_duration_ms: 1.5,
    });
    const errors = validateLocalWorldSceneManifest(manifest);

    expect(errors).toContain("world_snapshot.scenario_time_ms must be an integer");
    expect(errors).toContain("world_snapshot.scenario_duration_ms must be an integer");
    expect(isWorldSceneManifest(manifest)).toBe(false);
  });

  it("rejects malformed top-level WSP metadata locally", () => {
    const errors = validateLocalWorldSceneManifest({
      ...createManifest(),
      schema_version: "0.0.1",
      title: "",
      description: 7,
      created_at: "not-a-date",
      runtime_targets: [
        {
          name: "",
          mode: "docker",
          min_version: 1,
          debug: true,
        },
      ],
      interface: {
        observation_modalities: ["", 3],
        action_semantics: "",
        timestep_ms: 0.5,
        frame_convention: "",
      },
      artifacts: [
        {
          kind: "",
          digest_sha256: "abc",
          uri: "",
          extra: true,
        },
      ],
      provenance: [],
      security: {
        signature_ref: 1,
        attestation_refs: ["ok", 2],
        sbom_ref: 3,
        extra: true,
      },
    } as unknown as WorldScenePackageManifest);

    expect(errors).toContain("schema_version must be 1.0.0");
    expect(errors).toContain("title is required");
    expect(errors).toContain("description must be a string");
    expect(errors).toContain("created_at must be an ISO date-time string");
    expect(errors).toContain("runtime_targets[0] has unsupported field(s): debug");
    expect(errors).toContain("runtime_targets[0].name must be a non-empty string");
    expect(errors).toContain("runtime_targets[0].mode must be one of: native, python, container");
    expect(errors).toContain("runtime_targets[0].min_version must be a string");
    expect(errors).toContain("interface.observation_modalities[0] must be a non-empty string");
    expect(errors).toContain("interface.observation_modalities[1] must be a non-empty string");
    expect(errors).toContain("interface.action_semantics must be a non-empty string");
    expect(errors).toContain("interface.timestep_ms must be a positive integer");
    expect(errors).toContain("interface.frame_convention must be a non-empty string");
    expect(errors).toContain("artifacts[0] has unsupported field(s): extra");
    expect(errors).toContain("artifacts[0].kind must be a non-empty string");
    expect(errors).toContain("artifacts[0].digest_sha256 must be a SHA-256 hex digest");
    expect(errors).toContain("artifacts[0].uri must be a non-empty string");
    expect(errors).toContain("provenance must be an object");
    expect(errors).toContain("security has unsupported field(s): extra");
    expect(errors).toContain("security.signature_ref must be a string or null");
    expect(errors).toContain("security.attestation_refs[1] must be a string");
    expect(errors).toContain("security.sbom_ref must be a string or null");
  });

  it("keeps interface extension metadata importable", () => {
    const errors = validateLocalWorldSceneManifest({
      ...createManifest(),
      interface: {
        ...createManifest().interface,
        planning: {
          representation_space: "latent",
        },
      },
    } as unknown as WorldScenePackageManifest);

    expect(errors).toEqual([]);
  });

  it("rejects malformed package world objects", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            size_xyz: [0.4, -0.5, 0.6],
          },
        ],
      })
    );
    expect(errors).toContain("world layout objects[0].size_xyz[y] must be > 0");
  });

  it("accepts sphere and cylinder world layout objects", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            id: "sphere-1",
            type: "sphere",
            size_xyz: [0.3, 0.3, 0.3],
          },
          {
            ...createWorldLayoutObject(),
            id: "cylinder-1",
            type: "cylinder",
            size_xyz: [0.2, 0.2, 0.5],
          },
        ],
      })
    );
    expect(errors).toEqual([]);
  });

  it("accepts valid world cameras", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        cameras: [createWorldCamera()],
      })
    );

    expect(errors).toEqual([]);
  });

  it("rejects malformed world cameras", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        cameras: [
          {
            ...createWorldCamera(),
            parent_joint: "",
            pose: {
              xyz: [0, 0],
              rpy: [0, 0, 0],
            },
            intrinsics: {
              width: 0,
              height: 480,
              cx: null,
            },
          } as unknown as WorldScenePackageManifest["world_snapshot"]["cameras"][number],
        ],
      })
    );

    expect(errors).toContain("world snapshot cameras[0].parent_joint must be a non-empty string");
    expect(errors).toContain(
      "world snapshot cameras[0].pose.xyz must be an array of 3 finite numbers"
    );
    expect(errors).toContain("world snapshot cameras[0].intrinsics.width must be a positive integer");
    expect(errors).toContain("world snapshot cameras[0].intrinsics.cx must be a finite number");
    expect(errors).toContain("world snapshot cameras[0].intrinsics must include fov_deg, fx, or fy");
  });

  it("rejects arrays where WSP requires object records", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        joint_positions: [] as unknown as WorldScenePackageManifest["world_snapshot"]["joint_positions"],
        cameras: [
          {
            ...createWorldCamera(),
            intrinsics: {
              ...createWorldCamera().intrinsics,
              distortion: [],
            },
          } as unknown as WorldScenePackageManifest["world_snapshot"]["cameras"][number],
        ],
        objects: [
          {
            ...createWorldLayoutObject(),
            simulation: [],
            mesh: [],
          } as unknown as WorldScenePackageManifest["world_snapshot"]["objects"][number],
        ],
      })
    );

    expect(errors).toContain("world_snapshot.joint_positions must be an object");
    expect(errors).toContain("world snapshot cameras[0].intrinsics.distortion must be an object");
    expect(errors).toContain("world layout objects[0].simulation must be an object");
    expect(errors).toContain("world layout objects[0].mesh must be an object");
  });

  it("accepts Blender-imported world objects with simulator metadata", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            id: "blender_added_cube",
            name: "Added cube",
            simulation: {
              fixed: true,
              collision: true,
              mass_kg: null,
              friction: 0.8,
              restitution: 0.1,
              semantic_role: "blender_import",
            },
          },
        ],
      })
    );
    expect(errors).toEqual([]);
  });

  it("accepts mesh world objects with explicit asset metadata", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            id: "mesh-crate",
            name: "Mesh crate",
            type: "mesh",
            asset_ref: "assets/crate.obj",
            asset_scale_xyz: [1, 1.2, 1.4],
            mesh: {
              path: "assets/crate.obj",
              scale: [1, 1.2, 1.4],
            },
          },
        ],
      })
    );
    expect(errors).toEqual([]);
  });

  it("accepts portable mesh asset refs with local relative syntax", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            id: "mesh-crate",
            name: "Mesh crate",
            type: "mesh",
            asset_ref: "./assets\\crate.obj",
          },
        ],
      })
    );
    expect(errors).toEqual([]);
  });

  it("rejects non-portable mesh asset refs", () => {
    const invalidRefs = [
      ".",
      "./",
      " assets/crate.obj",
      "assets/crate.obj ",
      "/tmp/crate.obj",
      "../crate.obj",
      "assets/../crate.obj",
      "assets/./crate.obj",
      "assets//crate.obj",
      "package://demo/crate.obj",
      "https://example.test/crate.obj",
      "C:\\tmp\\crate.obj",
    ];

    invalidRefs.forEach((assetRef) => {
      const errors = validateLocalWorldSceneManifest(
        createManifest({
          objects: [
            {
              ...createWorldLayoutObject(),
              id: `mesh-${assetRef}`,
              name: "Mesh crate",
              type: "mesh",
              asset_ref: assetRef,
            },
          ],
        })
      );
      expect(errors).toContain(
        "world layout objects[0].asset_ref must be a portable relative asset reference"
      );
    });
  });

  it("rejects malformed simulator metadata", () => {
    const malformedObject = {
      ...createWorldLayoutObject(),
      simulation: {
        fixed: "yes",
        mass_kg: -1,
        friction: 0,
        restitution: 1.1,
        semantic_role: 3,
      },
    } as unknown as WorldScenePackageManifest["world_snapshot"]["objects"][number];
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [malformedObject],
      })
    );
    expect(errors).toContain("world layout objects[0].simulation.fixed must be a boolean");
    expect(errors).toContain("world layout objects[0].simulation.mass_kg must be >= 0");
    expect(errors).toContain("world layout objects[0].simulation.friction must be >= 0.01");
    expect(errors).toContain("world layout objects[0].simulation.restitution must be <= 1");
    expect(errors).toContain(
      "world layout objects[0].simulation.semantic_role must be a string or null"
    );
  });

  it("rejects mesh world objects without an asset reference", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            type: "mesh",
          },
        ],
      })
    );
    expect(errors).toContain(
      "world layout objects[0].mesh asset reference is required for mesh objects"
    );
  });

  it("rejects malformed mesh asset scales", () => {
    const errors = validateLocalWorldSceneManifest(
      createManifest({
        objects: [
          {
            ...createWorldLayoutObject(),
            type: "mesh",
            mesh: {
              path: "assets/crate.obj",
              scale: [1, 0, 1],
            },
          },
        ],
      })
    );
    expect(errors).toContain("world layout objects[0].mesh.scale[y] must be > 0");
  });

  it("accepts static world layout snapshots", () => {
    const snapshot = createStaticWorldSceneLayerSnapshot({
      name: "Desk setup",
      objects: [createWorldLayoutObject()],
      environment: null,
    });
    expect(validateWorldSceneLayerSnapshot(snapshot)).toEqual([]);
  });

  it("reads optional world layout name from world-layout payload", () => {
    const parsed = readWorldSceneLayerFromUnknown({
      world_layout: {
        name: "Desk setup",
        objects: [createWorldLayoutObject()],
        scenario_time_ms: 0,
        scenario_duration_ms: 0,
      },
    });
    expect(parsed?.name).toBe("Desk setup");
  });

  it("rejects non-static world layout snapshots for now", () => {
    const payload = {
      world_layout: {
        name: "Future timeline",
        objects: [createWorldLayoutObject()],
        scenario_time_ms: 50,
        scenario_duration_ms: 100,
      },
    };
    const parsed = readWorldSceneLayerFromUnknown(payload);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(validateWorldSceneLayerSnapshot(parsed)).toContain(
      STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR
    );
    expect(parseStaticWorldSceneLayerSnapshot(payload).snapshot).toBeNull();
  });

  it("rejects fractional world layout timing before application", () => {
    const payload = {
      world_layout: {
        name: "Fractional timeline",
        objects: [createWorldLayoutObject()],
        scenario_time_ms: 0.5,
        scenario_duration_ms: 1.5,
      },
    };
    const parsed = readWorldSceneLayerFromUnknown(payload);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(validateWorldSceneLayerSnapshot(parsed)).toEqual([
      "world layout scenario_time_ms must be an integer",
      "world layout scenario_duration_ms must be an integer",
    ]);
    expect(parseStaticWorldSceneLayerSnapshot(payload).snapshot).toBeNull();
  });

  it("rejects malformed world layout objects before application", () => {
    const payload = {
      world_layout: {
        name: "Broken layout",
        objects: [
          {
            ...createWorldLayoutObject(),
            position_xyz: [0.1, Number.NaN, 0.3],
          },
        ],
        scenario_time_ms: 0,
        scenario_duration_ms: 0,
      },
    };
    const parsed = readWorldSceneLayerFromUnknown(payload);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(validateWorldSceneLayerSnapshot(parsed)).toContain(
      "world layout objects[0].position_xyz[y] must be a finite number"
    );
    expect(parseStaticWorldSceneLayerSnapshot(payload).snapshot).toBeNull();
  });

  it("rejects malformed world layout rotations before application", () => {
    const payload = {
      world_layout: {
        name: "Broken rotation",
        objects: [
          {
            ...createWorldLayoutObject(),
            rotation_rpy_rad: [0.1, Number.NaN, 0.3],
          },
        ],
        scenario_time_ms: 0,
        scenario_duration_ms: 0,
      },
    };
    const parsed = readWorldSceneLayerFromUnknown(payload);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(validateWorldSceneLayerSnapshot(parsed)).toContain(
      "world layout objects[0].rotation_rpy_rad[y] must be a finite number"
    );
    expect(parseStaticWorldSceneLayerSnapshot(payload).snapshot).toBeNull();
  });

  it("rejects previous scene-key payloads", () => {
    const parsed = readWorldSceneLayerFromUnknown({
      scene: {
        objects: [createWorldLayoutObject()],
        scenario_time_ms: 0,
        scenario_duration_ms: 0,
      },
    });
    expect(parsed).toBeNull();
  });
});
