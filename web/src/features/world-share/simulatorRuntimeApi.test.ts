import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSimulatorMeshAssetUploads,
  fetchSimulatorRuntimeStatus,
  fetchSimulatorRuntimes,
  openSimulatorWorld,
} from "@/features/world-share/simulatorRuntimeApi";
import {
  SIMULATOR_GENESIS_ID,
  SIMULATOR_MJLAB_ID,
} from "@/features/world-share/simulatorRuntimeParams";

const { guardedFetchMock } = vi.hoisted(() => ({
  guardedFetchMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: guardedFetchMock,
}));

describe("simulatorRuntimeApi", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("opens a simulator world through the neutral simulator endpoint", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          simulator_id: "genesis",
          started: true,
          pid: 1234,
          command: ["python", "-m", "backend.scripts.genesis_world_open"],
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

    const launched = await openSimulatorWorld({
      simulatorId: SIMULATOR_GENESIS_ID,
      worldPackage: {
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
      },
      meshFiles: {},
    });

    expect(launched.pid).toBe(1234);
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/simulators/genesis/world/open"),
      expect.objectContaining({
        method: "POST",
      }),
      {
        requiredBackends: ["core-api"],
        context: "Open Genesis world",
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
                worldViewer: true,
                motionValidation: false,
              },
              transferPolicy: {
                robotAssetFormat: "urdf",
                sceneAssetFormat: "urdf",
                frameConvention: "ros-rep-103",
                launchStrategy: "direct",
              },
            },
            {
              simulatorId: "mjlab",
              label: "MJLab",
              capabilities: {
                worldViewer: true,
                motionValidation: true,
              },
              transferPolicy: {
                robotAssetFormat: "mjcf",
                sceneAssetFormat: "mjcf",
                frameConvention: "ros-rep-103",
                launchStrategy: "convert",
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
    expect(descriptors[0].capabilities.worldViewer).toBe(true);
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
        context: "Check MJLab runtime",
      }
    );
  });
});
