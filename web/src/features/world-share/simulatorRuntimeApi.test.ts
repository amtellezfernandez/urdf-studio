import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applySimulatorWorkspaceChangeSet,
  buildSimulatorMeshAssetUploads,
  fetchSimulatorRuntimeStatus,
  fetchSimulatorRuntimes,
  prepareSimulatorWorkspace,
} from "@/features/world-share/simulatorRuntimeApi";
import {
  SIMULATOR_GENESIS_ID,
  SIMULATOR_MJLAB_ID,
} from "@/features/world-share/simulatorRuntimeParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

const { guardedFetchMock } = vi.hoisted(() => ({
  guardedFetchMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: guardedFetchMock,
}));

const createWorldPackage = (): WorldScenePackageManifest => ({
  schema_version: "urdf-studio.world-scene-package.v1",
  package_id: "demo_world",
  version: "1.0.0",
  title: "Demo World",
  description: undefined,
  created_at: "2026-01-01T00:00:00.000Z",
  runtime_targets: [],
  interface: {
    observation_modalities: ["state"],
    action_semantics: "joint_position",
    timestep_ms: 10,
    frame_convention: "ros-rep-103",
  },
  artifacts: [],
  world_snapshot: {
    urdf_xml: "<robot name=\"demo\"><link name=\"base\"/></robot>",
    joint_positions: {},
    cameras: [],
    objects: [],
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
  },
  provenance: {},
  security: {
    signature_ref: null,
    attestation_refs: [],
    sbom_ref: null,
  },
});

describe("simulatorRuntimeApi", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("prepares a simulator workspace through the neutral simulator endpoint", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          simulator_id: "genesis",
          started: true,
          pid: 1234,
          command: ["python", "-m", "backend.scripts.genesis_workspace_prepare"],
          log_path: "/tmp/genesis.log",
          world_package_path: "/tmp/world-package.json",
          robot_urdf_path: "/tmp/robot.urdf",
          simulator_asset_path: "/tmp/robot.urdf",
          simulator_asset_format: "urdf",
          bundled_mesh_count: 0,
          unresolved_mesh_refs: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const prepared = await prepareSimulatorWorkspace({
      simulatorId: SIMULATOR_GENESIS_ID,
      worldPackage: createWorldPackage(),
      meshFiles: {},
      simulatorLabel: "Genesis",
    });

    expect(prepared.pid).toBe(1234);
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/simulators/genesis/workspace/prepare"),
      expect.objectContaining({
        method: "POST",
      }),
      {
        requiredBackends: ["core-api"],
        context: "Open Genesis",
      }
    );
  });

  it("builds package-root aliases for browser mesh uploads", async () => {
    const mesh = new Blob(["solid base\nendsolid base\n"], { type: "model/stl" });

    const uploads = await buildSimulatorMeshAssetUploads(
      {
        "meshes/base.stl": mesh,
      },
      {
        demo_description: ["demo_description"],
      }
    );

    expect(uploads).toHaveLength(1);
    expect([uploads[0].path, ...uploads[0].aliases]).toContain("meshes/base.stl");
    expect([uploads[0].path, ...uploads[0].aliases]).toContain(
      "demo_description/meshes/base.stl"
    );
    expect(uploads[0].mime).toBe("model/stl");
    expect(uploads[0].content_base64.length).toBeGreaterThan(0);
  });

  it("applies a Blender layout change-set through the guarded backend", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          world_package: createWorldPackage(),
          simulator_id: "blender",
          applied_change_count: 1,
          review_only_count: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await applySimulatorWorkspaceChangeSet(
      "blender",
      createWorldPackage(),
      {
        schema: "urdf-studio.blender-change-set.v1",
        changes: [],
      }
    );

    expect(response.applied_change_count).toBe(1);
    expect(response.simulator_id).toBe("blender");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/simulators/blender/workspace/change-set/apply"),
      expect.objectContaining({
        method: "POST",
      }),
      {
        requiredBackends: ["core-api"],
        context: "Import blender workspace changes",
      }
    );
  });

  it("does not assign the same alias to different mesh blobs", async () => {
    const first = new Blob(["first"], { type: "model/stl" });
    const second = new Blob(["second"], { type: "model/stl" });

    const uploads = await buildSimulatorMeshAssetUploads(
      {
        "meshes/base.stl": first,
        "demo_description/meshes/base.stl": second,
      },
      {
        demo_description: ["demo_description"],
      }
    );
    const aliasOwners = uploads.flatMap((upload) =>
      [upload.path, ...upload.aliases].map((alias) => [alias, upload.content_base64] as const)
    );
    const demoAliasOwners = aliasOwners.filter(
      ([alias]) => alias === "demo_description/meshes/base.stl"
    );

    expect(demoAliasOwners).toHaveLength(1);
  });

  it("fetches simulator runtime descriptors through the guarded backend", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          simulators: [
            {
              simulatorId: "genesis",
              label: "Genesis",
              capabilities: {
                workspaceTarget: true,
                motionValidation: false,
                layoutRoundTrip: false,
              },
              transferPolicy: {
                robotAssetFormat: "urdf",
                sceneAssetFormat: "urdf",
                frameConvention: "ros-rep-103",
                transferStrategy: "direct",
              },
            },
            {
              simulatorId: "mjlab",
              label: "MJLab",
              capabilities: {
                workspaceTarget: true,
                motionValidation: true,
                layoutRoundTrip: false,
              },
              transferPolicy: {
                robotAssetFormat: "mjcf",
                sceneAssetFormat: "mjcf",
                frameConvention: "ros-rep-103",
                transferStrategy: "convert",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const descriptors = await fetchSimulatorRuntimes();

    expect(descriptors.map((descriptor) => descriptor.simulatorId)).toEqual([
      "genesis",
      "mjlab",
    ]);
    expect(descriptors[0].capabilities.workspaceTarget).toBe(true);
    expect(descriptors[1].transferPolicy.robotAssetFormat).toBe("mjcf");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/simulators"),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      {
        requiredBackends: ["core-api"],
        context: "List simulator runtimes",
      }
    );
  });

  it("fetches a simulator runtime status through the guarded backend", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          runtimeName: "mjlab",
          available: true,
          status: "ready",
          dependencies: [{ name: "mujoco", available: true }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const status = await fetchSimulatorRuntimeStatus(SIMULATOR_MJLAB_ID);

    expect(status.available).toBe(true);
    expect(status.runtimeName).toBe("mjlab");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/simulators/mjlab/runtime"),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      {
        requiredBackends: ["core-api"],
        context: "Check mjlab runtime",
      }
    );
  });
});
