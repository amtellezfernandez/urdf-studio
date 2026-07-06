import { describe, expect, it, vi } from "vitest";
import {
  buildWorldRolloutConfigFromDraft,
  createWorldSceneLayerExportDocument,
  createWorldRolloutCheckerProfile,
  downloadWorldScenePackageManifest,
  loadWorldScenePackageFromImportParams,
  parseWorldSceneLayerText,
  parseWorldSceneManifestText,
  readWorldSceneLayerFromUrl,
  readWorldSceneManifestPayload,
  resolveWorldRolloutImportPayload,
} from "@/app/pages/index/worldSceneRuntime";
import { computeWorldSnapshotDigest } from "@/features/world-share/worldScenePackageBuilder";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

const TEST_ROLLOUT_FIXTURE = {
  batchSize: 4,
  latencyBudgetMs: 250,
  traceTimeMs: 1,
};

const createManifestPayload = (
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
    objects: [
      {
        id: "desk-cube",
        name: "Desk cube",
        type: "cube",
        position_xyz: [0.2, 0.1, 0.3],
        rotation_rpy_rad: [0.1, 0.2, 0.3],
        size_xyz: [0.4, 0.5, 0.6],
        color: "#ff0000",
        tracked_joint_name: null,
        is_ik_target: false,
        ik_target_type: "punctual",
      },
    ],
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

describe("worldSceneRuntime world package import", () => {
  it("accepts static world packages from text", async () => {
    const manifest = await parseWorldSceneManifestText(
      JSON.stringify(createManifestPayload())
    );
    expect(manifest.package_id).toBe("demo-scene");
    expect(manifest.world_snapshot.objects[0]?.rotation_rpy_rad).toEqual([0.1, 0.2, 0.3]);
  });

  it("accepts thin world registry envelopes from text", async () => {
    const manifest = await parseWorldSceneManifestText(
      JSON.stringify({
        package_id: "demo-scene",
        version: "0.1.0",
        provenance: {
          owner: "scene-team",
        },
        artifacts: [],
        world: {
          name: "Demo Scene",
          urdf_xml: "<robot name='demo'/>",
          joint_positions: {},
          cameras: [],
          objects: createManifestPayload().world_snapshot.objects,
          scenario_time_ms: 0,
          scenario_duration_ms: 0,
          environment: {
            frame_convention: "ros-rep-103",
          },
        },
      })
    );
    expect(manifest.package_id).toBe("demo-scene");
    expect(manifest.title).toBe("Demo Scene");
    expect(manifest.interface.frame_convention).toBe("ros-rep-103");
  });

  it("accepts static world packages with matching world snapshot digest artifacts", async () => {
    const payload = createManifestPayload();
    payload.artifacts = [
      {
        kind: "world_snapshot",
        digest_sha256: await computeWorldSnapshotDigest(payload.world_snapshot),
        uri: "inline://snapshot",
      },
    ];

    const manifest = await parseWorldSceneManifestText(JSON.stringify(payload));

    expect(manifest.artifacts[0]?.kind).toBe("world_snapshot");
  });

  it("rejects static world packages with mismatched world snapshot digest artifacts", async () => {
    const payload = createManifestPayload();
    payload.artifacts = [
      {
        kind: "world_snapshot",
        digest_sha256: "0".repeat(64),
        uri: "inline://snapshot",
      },
    ];

    await expect(parseWorldSceneManifestText(JSON.stringify(payload))).rejects.toThrow(
      "artifacts[world_snapshot:0].digest_sha256 does not match world_snapshot"
    );
  });

  it("rejects timed world packages from text", async () => {
    await expect(
      parseWorldSceneManifestText(
        JSON.stringify(
          createManifestPayload({
            scenario_time_ms: 100,
            scenario_duration_ms: 1000,
          })
        )
      )
    ).rejects.toThrow(
      "Invalid world package: Non-static world layouts are not supported yet. scenario_time_ms and scenario_duration_ms must both be 0."
    );
  });

  it("rejects timed world packages from payload", async () => {
    await expect(
      readWorldSceneManifestPayload(
        createManifestPayload({
          scenario_time_ms: 100,
          scenario_duration_ms: 1000,
        })
      )
    ).rejects.toThrow(
      "Invalid world package: Non-static world layouts are not supported yet. scenario_time_ms and scenario_duration_ms must both be 0."
    );
  });

  it("rejects fractional world package timing with validation detail", async () => {
    await expect(
      parseWorldSceneManifestText(
        JSON.stringify(
          createManifestPayload({
            scenario_time_ms: 0.5,
            scenario_duration_ms: 1.5,
          })
        )
      )
    ).rejects.toThrow("world_snapshot.scenario_time_ms must be an integer");
  });

  it("loads world packages from import URLs", async () => {
    const manifestPayload = createManifestPayload();
    const fetchImplementation: typeof fetch = async (input, init) => {
      expect(input).toBe("https://example.test/world.json");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return {
        ok: true,
        status: 200,
        json: async () => manifestPayload,
      } as Response;
    };

    const manifest = await loadWorldScenePackageFromImportParams(
      {
        importUrl: " https://example.test/world.json ",
        packageId: "",
        version: "",
      },
      { fetchImplementation }
    );

    expect(manifest.package_id).toBe("demo-scene");
  });

  it("normalizes GitHub blob URLs for world package imports", async () => {
    const manifestPayload = createManifestPayload();
    const fetchImplementation: typeof fetch = async (input) => {
      expect(input).toBe(
        "https://raw.githubusercontent.com/acme/worlds/main/packages/demo.world.json"
      );
      return {
        ok: true,
        status: 200,
        json: async () => manifestPayload,
      } as Response;
    };

    const manifest = await loadWorldScenePackageFromImportParams(
      {
        importUrl: "https://github.com/acme/worlds/blob/main/packages/demo.world.json",
        packageId: "",
        version: "",
      },
      { fetchImplementation }
    );

    expect(manifest.package_id).toBe("demo-scene");
  });

  it("loads world packages from registry package ids and versions", async () => {
    const manifestPayload = createManifestPayload();
    const manifest = await loadWorldScenePackageFromImportParams(
      {
        importUrl: "",
        packageId: " demo-scene ",
        version: " 0.1.0 ",
      },
      {
        loadPackageVersion: async (packageId, version) => {
          expect(packageId).toBe("demo-scene");
          expect(version).toBe("0.1.0");
          return {
            package_id: packageId,
            version,
            digest_sha256: "a".repeat(64),
            published_at: new Date().toISOString(),
            manifest: manifestPayload,
          };
        },
      }
    );

    expect(manifest).toStrictEqual(manifestPayload);
  });

  it("loads thin world envelopes from registry package ids and versions", async () => {
    const manifestPayload = createManifestPayload();
    const manifest = await loadWorldScenePackageFromImportParams(
      {
        importUrl: "",
        packageId: " demo-scene ",
        version: " 0.1.0 ",
      },
      {
        loadPackageVersion: async (packageId, version) => ({
          package_id: packageId,
          version,
          digest_sha256: "a".repeat(64),
          published_at: new Date().toISOString(),
          manifest: {
            package_id: packageId,
            version,
            provenance: {},
            artifacts: [],
            world: {
              name: manifestPayload.title,
              urdf_xml: manifestPayload.world_snapshot.urdf_xml,
              joint_positions: manifestPayload.world_snapshot.joint_positions,
              cameras: manifestPayload.world_snapshot.cameras,
              objects: manifestPayload.world_snapshot.objects,
              scenario_time_ms: 0,
              scenario_duration_ms: 0,
              environment: {
                frame_convention: "ros-rep-103",
              },
            },
          },
        }),
      }
    );

    expect(manifest.package_id).toBe("demo-scene");
    expect(manifest.title).toBe("Demo Scene");
    expect(manifest.interface.frame_convention).toBe("ros-rep-103");
  });

  it("reports unavailable import URL responses", async () => {
    const fetchImplementation: typeof fetch = async () =>
      ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }) as Response;

    await expect(
      loadWorldScenePackageFromImportParams(
        {
          importUrl: "https://example.test/missing-world.json",
          packageId: "",
          version: "",
        },
        { fetchImplementation }
      )
    ).rejects.toThrow("Import link failed (HTTP 404)");
  });

  it("requires a complete world package import request", async () => {
    await expect(
      loadWorldScenePackageFromImportParams({
        importUrl: "",
        packageId: "demo-scene",
        version: "",
      })
    ).rejects.toThrow("Import link did not contain a valid world package manifest.");
  });

  it("downloads world packages as thin registry envelopes", async () => {
    const manifestPayload = createManifestPayload();
    const downloadJsonDocument = vi.fn();

    await downloadWorldScenePackageManifest(manifestPayload, downloadJsonDocument);

    expect(downloadJsonDocument).toHaveBeenCalledOnce();
    const [payload, filename] = downloadJsonDocument.mock.calls[0] ?? [];
    expect(filename).toBe("demo-scene-0.1.0.world-package.json");
    expect(payload).toMatchObject({
      package_id: "demo-scene",
      version: "0.1.0",
      provenance: {},
      world: {
        name: "Demo Scene",
        urdf_xml: manifestPayload.world_snapshot.urdf_xml,
        joint_positions: manifestPayload.world_snapshot.joint_positions,
        objects: manifestPayload.world_snapshot.objects,
        scenario_time_ms: 0,
        scenario_duration_ms: 0,
        environment: {
          frame_convention: "ros-rep-103",
        },
      },
    });
    expect(payload).not.toHaveProperty("created_at");
    expect(payload).not.toHaveProperty("runtime_targets");
    expect(payload).not.toHaveProperty("interface");
    expect(payload).not.toHaveProperty("security");
  });
});

describe("worldSceneRuntime world layout import", () => {
  it("parses legacy package files through the unified world JSON reader", async () => {
    const manifestPayload = createManifestPayload({
      joint_positions: { shoulder: 0.5 },
    });

    const worldLayout = await parseWorldSceneLayerText(JSON.stringify(manifestPayload));

    expect(worldLayout.name).toBe("Demo Scene");
    expect(worldLayout.objects).toEqual(manifestPayload.world_snapshot.objects);
    expect(worldLayout.urdf_xml).toBe(manifestPayload.world_snapshot.urdf_xml);
    expect(worldLayout.joint_positions).toEqual({ shoulder: 0.5 });
    expect(worldLayout.environment).toEqual({
      frame_convention: "ros-rep-103",
    });
  });

  it("reports embedded cameras from world-scene package payloads", async () => {
    const manifestPayload = createManifestPayload({
      cameras: [
        {
          id: "wrist-camera",
          name: "Wrist Camera",
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
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      expect(input).toBe("https://example.test/layout.json");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return {
        ok: true,
        status: 200,
        url: "https://cdn.example.test/worlds/layout.json",
        json: async () => manifestPayload,
      } as Response;
    }) as typeof fetch;

    try {
      const importedWorldLayout = await readWorldSceneLayerFromUrl(
        "https://example.test/layout.json",
        "World layout import"
      );

      expect(importedWorldLayout.embeddedCameras).toBe(2);
      expect(importedWorldLayout.worldLayout.objects).toHaveLength(1);
      expect(importedWorldLayout.worldLayout.cameras).toHaveLength(2);
      expect(importedWorldLayout.worldLayout.urdf_xml).toBe("<robot name='demo'/>");
      expect(importedWorldLayout.baseUrl).toBe("https://cdn.example.test/worlds/layout.json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports embedded cameras for extended world layout payloads", async () => {
    const manifestPayload = createManifestPayload();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          world_layout: {
            name: "Desk setup",
            urdf_xml: manifestPayload.world_snapshot.urdf_xml,
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
            objects: manifestPayload.world_snapshot.objects,
            scenario_time_ms: 0,
            scenario_duration_ms: 0,
          },
          environment: {
            frame_convention: "ros-rep-103",
          },
        }),
      }) as Response) as typeof fetch;

    try {
      const importedWorldLayout = await readWorldSceneLayerFromUrl(
        "https://example.test/layout.json",
        "World layout import"
      );

      expect(importedWorldLayout.embeddedCameras).toBe(1);
      expect(importedWorldLayout.worldLayout.name).toBe("Desk setup");
      expect(importedWorldLayout.worldLayout.joint_positions).toEqual({ shoulder: 0.5 });
      expect(importedWorldLayout.worldLayout.environment).toEqual({
        frame_convention: "ros-rep-103",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exports a world layout document with optional robot state and environment", async () => {
    const manifestPayload = createManifestPayload({
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
    });

    const { payload } = await createWorldSceneLayerExportDocument("Desk setup", manifestPayload, {
      includeRobotState: true,
    });

    expect(payload).toEqual({
      world_layout: {
        name: "Desk setup",
        urdf_xml: manifestPayload.world_snapshot.urdf_xml,
        joint_positions: { shoulder: 0.5 },
        cameras: manifestPayload.world_snapshot.cameras,
        objects: manifestPayload.world_snapshot.objects,
        scenario_time_ms: 0,
        scenario_duration_ms: 0,
      },
      environment: {
        frame_convention: "ros-rep-103",
      },
    });
  });
});

describe("worldSceneRuntime rollout config", () => {
  it("preserves full user-configured checker profiles", () => {
    const defaultCheckerProfile = createWorldRolloutCheckerProfile({
      resolvedRobotName: "demo-robot",
      params: {},
    });

    const config = buildWorldRolloutConfigFromDraft(
      {
        checker_profile: {
          ...defaultCheckerProfile,
          profile_id: "specialist-checker",
          params: { policy: "user-defined" },
          modules: [
            {
              module_id: "tier3-spatial",
              tier: "tier3",
              role: "spatial_reasoner",
              trigger: "uncertain_scene",
              latency_budget_ms: TEST_ROLLOUT_FIXTURE.latencyBudgetMs,
              params: { semantic_outputs: ["drop_zone_coordinates"] },
            },
          ],
          artifacts: [{ kind: "calibration", uri: "calibration.json", metadata: {} }],
        },
        rollout_params: { domain: "user-defined-domain" },
        runner_params: { batch_size: TEST_ROLLOUT_FIXTURE.batchSize },
      },
      defaultCheckerProfile
    );

    expect(config.checkerProfile.profile_id).toBe("specialist-checker");
    expect(config.checkerProfile.modules[0]?.role).toBe("spatial_reasoner");
    expect(config.checkerProfile.modules[0]?.params.semantic_outputs).toEqual([
      "drop_zone_coordinates",
    ]);
    expect(config.checkerProfile.artifacts[0]?.uri).toBe("calibration.json");
    expect(config.rolloutParams.domain).toBe("user-defined-domain");
    expect(config.runnerParams.batch_size).toBe(TEST_ROLLOUT_FIXTURE.batchSize);
  });
});

describe("worldSceneRuntime rollout result import", () => {
  it("maps NDJSON artifacts by manifest URIs", () => {
    const checkerProfile = createWorldRolloutCheckerProfile({
      resolvedRobotName: "demo-robot",
      params: {},
    });
    const campaign = {
      schema_version: "world_rollout_campaign.v1",
      campaign_id: "demo-campaign",
      created_at: new Date().toISOString(),
      world_package: { package_id: "demo-world", version: "1.0.0" },
      checker_profile: checkerProfile,
      rollout_params: {},
      runner: { kind: "local-cli", params: {} },
      artifacts: [
        { kind: "trace_ndjson", uri: "artifacts/state.ndjson", metadata: {} },
        { kind: "decisions_ndjson", uri: "artifacts/checks.ndjson", metadata: {} },
      ],
    };

    const payload = resolveWorldRolloutImportPayload([
      { name: "checks.ndjson", text: '{"decision":"stop","rule_id":"hardware"}\n' },
      { name: "campaign.json", text: JSON.stringify(campaign) },
      { name: "state.ndjson", text: `{"t_ms":${TEST_ROLLOUT_FIXTURE.traceTimeMs},"stream":"state"}\n` },
    ]);

    expect(payload.campaign.campaign_id).toBe("demo-campaign");
    expect(payload.trace_ndjson).toContain('"stream":"state"');
    expect(payload.decisions_ndjson).toContain('"decision":"stop"');
  });

  it("rejects imports missing manifest-referenced NDJSON files", () => {
    const checkerProfile = createWorldRolloutCheckerProfile({
      resolvedRobotName: "demo-robot",
      params: {},
    });
    const campaign = {
      schema_version: "world_rollout_campaign.v1",
      campaign_id: "demo-campaign",
      created_at: new Date().toISOString(),
      world_package: { package_id: "demo-world", version: "1.0.0" },
      checker_profile: checkerProfile,
      rollout_params: {},
      runner: { kind: "local-cli", params: {} },
      artifacts: [
        { kind: "decisions_ndjson", uri: "artifacts/checks.ndjson", metadata: {} },
      ],
    };

    expect(() =>
      resolveWorldRolloutImportPayload([{ name: "campaign.json", text: JSON.stringify(campaign) }])
    ).toThrow("Select the rollout decisions NDJSON artifact referenced by the manifest.");
  });
});
