import { describe, expect, it } from "vitest";
import {
  buildWorldRolloutConfigFromDraft,
  createWorldRolloutCheckerProfile,
  parseWorldSceneManifestText,
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
