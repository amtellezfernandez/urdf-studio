import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyWorkspaceTransferTargetChangeSet,
  applyWorkspaceChangeSet,
  buildWorkspaceTransferMeshAssetUploads,
  fetchWorkspaceTransferTargetStatus,
  fetchWorkspaceTransferTargets,
  openWorkspaceTransferTarget,
} from "@/features/world-share/workspaceTransferApi";
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

describe("workspaceTransferApi", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("opens a workspace transfer target through the neutral endpoint", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          targetId: "genesis",
          started: true,
          pid: 1234,
          command: ["python", "-m", "backend.scripts.genesis_workspace_prepare"],
          logPath: "/tmp/genesis.log",
          worldPackagePath: "/tmp/world-package.json",
          robotUrdfPath: "/tmp/robot.urdf",
          targetAssetPath: "/tmp/robot.urdf",
          targetAssetFormat: "urdf",
          bundledMeshCount: 0,
          unresolvedMeshRefs: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const prepared = await openWorkspaceTransferTarget({
      targetId: "genesis",
      worldPackage: createWorldPackage(),
      meshFiles: {},
      targetLabel: "Genesis",
    });

    expect(prepared.pid).toBe(1234);
    expect(prepared.targetId).toBe("genesis");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/workspace-transfer/targets/genesis/open"),
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

    const uploads = await buildWorkspaceTransferMeshAssetUploads(
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

  it("applies a Blender layout change-set through the target endpoint", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          world_package: createWorldPackage(),
          targetId: "blender",
          appliedChangeCount: 1,
          reviewOnlyCount: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await applyWorkspaceTransferTargetChangeSet(
      "blender",
      createWorldPackage(),
      {
        schema: "urdf-studio.blender-change-set.v1",
        changes: [],
      }
    );

    expect(response.appliedChangeCount).toBe(1);
    expect(response.targetId).toBe("blender");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/workspace-transfer/targets/blender/change-set/apply"),
      expect.objectContaining({
        method: "POST",
      }),
      {
        requiredBackends: ["core-api"],
        context: "Import blender workspace changes",
      }
    );
  });

  it("applies a workspace change-set through schema-routed import", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          world_package: createWorldPackage(),
          targetId: "blender",
          appliedChangeCount: 1,
          reviewOnlyCount: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await applyWorkspaceChangeSet(createWorldPackage(), {
      schema: "urdf-studio.blender-change-set.v1",
      changes: [],
    });

    expect(response.targetId).toBe("blender");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/workspace-transfer/change-set/apply"),
      expect.objectContaining({
        method: "POST",
      }),
      {
        requiredBackends: ["core-api"],
        context: "Import workspace changes",
      }
    );
  });

  it("does not assign the same alias to different mesh blobs", async () => {
    const first = new Blob(["first"], { type: "model/stl" });
    const second = new Blob(["second"], { type: "model/stl" });

    const uploads = await buildWorkspaceTransferMeshAssetUploads(
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

  it("fetches workspace transfer targets through the guarded backend", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          targets: [
            {
              targetId: "genesis",
              label: "Genesis",
              targetKind: "physics_simulator",
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
              targetId: "mjlab",
              label: "MJLab",
              targetKind: "physics_simulator",
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

    const descriptors = await fetchWorkspaceTransferTargets();

    expect(descriptors.map((descriptor) => descriptor.targetId)).toEqual([
      "genesis",
      "mjlab",
    ]);
    expect(descriptors[0].targetKind).toBe("physics_simulator");
    expect(descriptors[0].capabilities.workspaceTarget).toBe(true);
    expect(descriptors[1].transferPolicy.robotAssetFormat).toBe("mjcf");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/workspace-transfer/targets"),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      {
        requiredBackends: ["core-api"],
        context: "List workspace transfer targets",
      }
    );
  });

  it("fetches a workspace transfer target status through the guarded backend", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          targetId: "mjlab",
          available: true,
          status: "ready",
          dependencies: [{ name: "mujoco", available: true }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const status = await fetchWorkspaceTransferTargetStatus("mjlab");

    expect(status.available).toBe(true);
    expect(status.targetId).toBe("mjlab");
    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/workspace-transfer/targets/mjlab/status"),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      {
        requiredBackends: ["core-api"],
        context: "Check mjlab availability",
      }
    );
  });
});
