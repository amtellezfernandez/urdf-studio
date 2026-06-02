import { describe, expect, it } from "vitest";
import {
  STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR,
  WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS,
} from "@/features/world-share/worldScenePackageParams";

import {
  createStaticWorldSceneLayerSnapshot,
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

  it("rejects legacy scene-key payloads", () => {
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
