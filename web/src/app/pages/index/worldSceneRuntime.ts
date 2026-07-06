import {
  DEFAULT_WORLD_SCENE_PACKAGE_ID,
  DEFAULT_WORLD_SCENE_PACKAGE_TITLE,
  toWorldLayoutFilename,
} from "@/app/pages/index/indexPageHelpers";
import { getFilenameFromPath } from "@/shared/lib/pathNames";
import { isRecord, readRecordOrEmpty } from "@/shared/lib/records";
import type { CreatedObject } from "@/features/objects";
import type { Camera } from "@/shared/types/camera";
import { WORLD_SCENE_PACKAGE_DEFAULT_VERSION } from "@/features/world-share/worldScenePackageParams";
import type { WorldSceneLayerSnapshot } from "@/features/world-share/worldSceneManifest";
import type {
  WorldScenePackageListEntry,
  WorldScenePackageManifest,
  WorldScenePackagePublishResponse,
  WorldScenePackageValidationResponse,
  WorldScenePackageVersionRecord,
} from "@/features/world-share/worldScenePackageTypes";
import {
  WORLD_ROLLOUT_CAMPAIGN_FILENAME_SUFFIX,
  WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION,
  WORLD_ROLLOUT_CHECKER_PROFILE_SCHEMA_VERSION,
  WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND,
  WORLD_ROLLOUT_DEFAULT_RUNNER_KIND,
  WORLD_ROLLOUT_TRACE_ARTIFACT_KIND,
} from "@/features/world-share/worldRolloutParams";
import type {
  WorldRolloutCampaignManifest,
  WorldRolloutCheckerProfile,
  WorldRolloutImportRequest,
  WorldRolloutImportResponse,
  WorldRolloutJobResponse,
} from "@/features/world-share/worldRolloutTypes";

const loadWorldScenePackageBuilderModule = () =>
  import("@/features/world-share/worldScenePackageBuilder");
const loadWorldSceneManifestModule = () =>
  import("@/features/world-share/worldSceneManifest");
const loadWorldScenePackageApiModule = () =>
  import("@/features/world-share/worldScenePackageApi");
const loadWorldSceneImportUrlModule = () =>
  import("@/features/world-share/sceneImportUrl");
const loadWorldHubApiModule = () =>
  import("@/features/world-share/worldHubApi");
const loadWorldRolloutApiModule = () =>
  import("@/features/world-share/worldRolloutApi");

type WorldScenePackageOverrides = Partial<
  Pick<WorldScenePackageManifest, "package_id" | "title" | "version" | "description">
>;

type BuildWorldScenePackageManifestFromStateParams = {
  resolvedRobotName: string | null;
  vizUrdfContent: string;
  originalUrdfContent: string;
  jointValues: Record<string, number>;
  cameras: Camera[];
  objects: CreatedObject[];
  demoMode: boolean;
  overrides?: WorldScenePackageOverrides;
};

type WorldRolloutConfigDraft = {
  checkerProfile: WorldRolloutCheckerProfile;
  rolloutParams: Record<string, unknown>;
  runnerParams: Record<string, unknown>;
};

type WorldRolloutImportFileDraft = {
  name: string;
  text: string;
};

type WorldScenePackageImportParams = {
  importUrl: string;
  packageId: string;
  version: string;
};

type WorldScenePackageVersionLoader = (
  packageId: string,
  version: string
) => Promise<WorldScenePackageVersionRecord>;

type LoadWorldScenePackageFromImportParamsOptions = {
  fetchImplementation?: typeof fetch;
  loadPackageVersion?: WorldScenePackageVersionLoader;
};

const isWorldSnapshotArtifact = (
  value: unknown
): value is { kind: string; digest_sha256: string } =>
  isRecord(value) &&
  typeof value.kind === "string" &&
  typeof value.digest_sha256 === "string";

const artifactBasename = (uri: string) => getFilenameFromPath(uri, uri).toLowerCase();

const uniquePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    unique.push(value);
  });
  return unique;
};

const rolloutArtifactBasenames = (
  campaign: WorldRolloutCampaignManifest,
  kind: string
): Set<string> =>
  new Set(
    campaign.artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => artifactBasename(artifact.uri))
  );

export const buildWorldScenePackageManifestFromState = async ({
  resolvedRobotName,
  vizUrdfContent,
  originalUrdfContent,
  jointValues,
  cameras,
  objects,
  demoMode,
  overrides,
}: BuildWorldScenePackageManifestFromStateParams): Promise<WorldScenePackageManifest> => {
  const { buildWorldScenePackageManifest } =
    await loadWorldScenePackageBuilderModule();
  const packageId =
    overrides?.package_id ||
    resolvedRobotName ||
    DEFAULT_WORLD_SCENE_PACKAGE_ID;
  const title = overrides?.title || resolvedRobotName || DEFAULT_WORLD_SCENE_PACKAGE_TITLE;
  const version = overrides?.version || WORLD_SCENE_PACKAGE_DEFAULT_VERSION;

  return buildWorldScenePackageManifest({
    packageId,
    version,
    title,
    description: overrides?.description,
    urdfXml: vizUrdfContent || originalUrdfContent,
    jointPositions: { ...jointValues },
    cameras,
    objects,
    scenarioTimeMs: 0,
    scenarioDurationMs: 0,
    provenance: {
      source: "urdf-studio",
      app_mode: demoMode ? "demo" : "interactive",
      created_from: "ui",
    },
  });
};

export const downloadWorldScenePackageManifest = async (
  manifest: WorldScenePackageManifest,
  downloadJsonDocument: (payload: unknown, filename: string) => void
) => {
  const { toWorldScenePackageDownloadName, toWorldSceneRegistryEnvelope } =
    await loadWorldScenePackageBuilderModule();
  const filename = toWorldScenePackageDownloadName(manifest.package_id, manifest.version);
  downloadJsonDocument(toWorldSceneRegistryEnvelope(manifest), filename);
};

export const createWorldRolloutCheckerProfile = ({
  resolvedRobotName,
  params,
}: {
  resolvedRobotName: string | null;
  params: Record<string, unknown>;
}): WorldRolloutCheckerProfile => {
  const targetId = resolvedRobotName || DEFAULT_WORLD_SCENE_PACKAGE_ID;
  return {
    schema_version: WORLD_ROLLOUT_CHECKER_PROFILE_SCHEMA_VERSION,
    profile_id: `${targetId}-checker-profile`,
    target_id: targetId,
    description: "User-configured checker profile.",
    params,
    modules: [],
    artifacts: [],
  };
};

export const buildWorldRolloutConfigFromDraft = (
  draft: unknown,
  defaultCheckerProfile: WorldRolloutCheckerProfile
): WorldRolloutConfigDraft => {
  if (!isRecord(draft)) {
    throw new Error("World rollout config must be a JSON object.");
  }

  const rawCheckerProfile = draft.checker_profile;
  if (rawCheckerProfile !== undefined && !isRecord(rawCheckerProfile)) {
    throw new Error("World rollout checker_profile must be a JSON object.");
  }
  const checkerProfileDraft = isRecord(rawCheckerProfile) ? rawCheckerProfile : null;
  const checkerProfile = checkerProfileDraft
    ? {
        ...defaultCheckerProfile,
        ...checkerProfileDraft,
        params: readRecordOrEmpty(checkerProfileDraft.params),
        modules: Array.isArray(checkerProfileDraft.modules) ? checkerProfileDraft.modules : [],
        artifacts: Array.isArray(checkerProfileDraft.artifacts) ? checkerProfileDraft.artifacts : [],
      }
    : {
        ...defaultCheckerProfile,
        params: readRecordOrEmpty(draft.checker_params),
      };

  return {
    checkerProfile: checkerProfile as WorldRolloutCheckerProfile,
    rolloutParams: readRecordOrEmpty(draft.rollout_params),
    runnerParams: readRecordOrEmpty(draft.runner_params),
  };
};

export const buildWorldRolloutCampaignManifest = ({
  worldPackage,
  checkerProfile,
  rolloutParams,
  runnerParams,
}: {
  worldPackage: WorldScenePackageManifest;
  checkerProfile: WorldRolloutCheckerProfile;
  rolloutParams: Record<string, unknown>;
  runnerParams: Record<string, unknown>;
}): WorldRolloutCampaignManifest => ({
  schema_version: WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION,
  campaign_id: `${worldPackage.package_id}-${worldPackage.version}`,
  created_at: new Date().toISOString(),
  world_package: {
    package_id: worldPackage.package_id,
    version: worldPackage.version,
  },
  checker_profile: checkerProfile,
  rollout_params: rolloutParams,
  runner: {
    kind: WORLD_ROLLOUT_DEFAULT_RUNNER_KIND,
    params: runnerParams,
  },
  artifacts: [],
});

export const downloadWorldRolloutCampaignManifest = (
  manifest: WorldRolloutCampaignManifest,
  downloadJsonDocument: (payload: unknown, filename: string) => void
) => {
  downloadJsonDocument(
    manifest,
    `${manifest.campaign_id}-${WORLD_ROLLOUT_CAMPAIGN_FILENAME_SUFFIX}`
  );
};

export const createWorldRolloutJobFromState = async ({
  worldPackage,
  checkerProfile,
  rolloutParams,
  runnerParams,
}: {
  worldPackage: WorldScenePackageManifest;
  checkerProfile: WorldRolloutCheckerProfile;
  rolloutParams: Record<string, unknown>;
  runnerParams: Record<string, unknown>;
}): Promise<WorldRolloutJobResponse> => {
  const { createWorldRolloutJob } = await loadWorldRolloutApiModule();
  return createWorldRolloutJob({
    world_package: worldPackage,
    checker_profile: checkerProfile,
    rollout_params: rolloutParams,
    runner_params: runnerParams,
  });
};

export const fetchWorldRolloutJob = async (jobId: string): Promise<WorldRolloutJobResponse> => {
  const { getWorldRolloutJob } = await loadWorldRolloutApiModule();
  return getWorldRolloutJob(jobId);
};

export const importWorldRolloutResultPayload = async (
  request: WorldRolloutImportRequest
): Promise<WorldRolloutImportResponse> => {
  const { importWorldRolloutResults } = await loadWorldRolloutApiModule();
  return importWorldRolloutResults(request);
};

export const resolveWorldRolloutImportPayload = (
  files: WorldRolloutImportFileDraft[]
): WorldRolloutImportRequest => {
  let campaign: WorldRolloutCampaignManifest | null = null;
  const artifacts = files.map((file) => ({
    lowerName: file.name.toLowerCase(),
    text: file.text,
  }));

  for (const artifact of artifacts) {
    if (!artifact.lowerName.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.text) as unknown;
    } catch {
      continue;
    }
    if (
      isRecord(parsed) &&
      parsed.schema_version === WORLD_ROLLOUT_CAMPAIGN_SCHEMA_VERSION
    ) {
      campaign = parsed as WorldRolloutCampaignManifest;
      break;
    }
  }

  if (!campaign) {
    throw new Error("Select a rollout campaign manifest JSON file.");
  }

  const traceNames = rolloutArtifactBasenames(campaign, WORLD_ROLLOUT_TRACE_ARTIFACT_KIND);
  const decisionNames = rolloutArtifactBasenames(campaign, WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND);
  const hasManifestArtifactNames = traceNames.size > 0 || decisionNames.size > 0;
  let traceNdjson = "";
  let decisionsNdjson = "";

  for (const artifact of artifacts) {
    if (artifact.lowerName.endsWith(".json")) continue;
    if (traceNames.has(artifact.lowerName)) {
      traceNdjson = artifact.text;
      continue;
    }
    if (decisionNames.has(artifact.lowerName)) {
      decisionsNdjson = artifact.text;
      continue;
    }
    if (!hasManifestArtifactNames) {
      if (artifact.lowerName.includes("decision")) {
        decisionsNdjson = artifact.text;
      } else {
        traceNdjson = artifact.text;
      }
    }
  }

  if (traceNames.size > 0 && !traceNdjson) {
    throw new Error("Select the rollout trace NDJSON artifact referenced by the manifest.");
  }
  if (decisionNames.size > 0 && !decisionsNdjson) {
    throw new Error("Select the rollout decisions NDJSON artifact referenced by the manifest.");
  }

  return {
    campaign,
    trace_ndjson: traceNdjson,
    decisions_ndjson: decisionsNdjson,
  };
};

export const validateWorldScenePackageLocally = async (
  manifest: WorldScenePackageManifest
) => {
  const [
    {
      validateLocalWorldSceneManifest,
      validateWorldSceneLayerSnapshot,
      worldSceneManifestToLayerSnapshot,
    },
    { computeWorldSnapshotDigest },
  ] = await Promise.all([
    loadWorldSceneManifestModule(),
    loadWorldScenePackageBuilderModule(),
  ]);
  const localErrors = validateLocalWorldSceneManifest(manifest);
  const layerErrors = validateWorldSceneLayerSnapshot(
    worldSceneManifestToLayerSnapshot(manifest)
  );
  const artifactErrors: string[] = [];
  const worldSnapshotArtifacts = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.filter(
        (artifact) => isWorldSnapshotArtifact(artifact) && artifact.kind === "world_snapshot"
      )
    : [];
  if (Array.isArray(manifest.artifacts)) {
    manifest.artifacts.forEach((artifact, index) => {
      if (
        typeof artifact === "object" &&
        artifact !== null &&
        "kind" in artifact &&
        (artifact as { kind?: unknown }).kind === "world_snapshot" &&
        !isWorldSnapshotArtifact(artifact)
      ) {
        artifactErrors.push(
          `artifacts[${index}].digest_sha256 is required for world_snapshot artifacts`
        );
      }
    });
  }
  if (worldSnapshotArtifacts.length > 0 && localErrors.length === 0) {
    const actualDigest = await computeWorldSnapshotDigest(manifest.world_snapshot);
    worldSnapshotArtifacts.forEach((artifact, index) => {
      if (artifact.digest_sha256.toLowerCase() !== actualDigest) {
        artifactErrors.push(
          `artifacts[world_snapshot:${index}].digest_sha256 does not match world_snapshot`
        );
      }
    });
  }
  const combinedErrors = uniquePreservingOrder([
    ...localErrors,
    ...layerErrors,
    ...artifactErrors,
  ]);
  const isStaticScene = manifest.world_snapshot.scenario_duration_ms === 0;
  return {
    combinedErrors,
    modeLabel: isStaticScene ? "static world layout" : "timed world layout",
  };
};

export const validateWorldScenePackageRemotely = async (
  manifest: WorldScenePackageManifest
): Promise<WorldScenePackageValidationResponse> => {
  const { validateWorldScenePackageManifest } =
    await loadWorldScenePackageApiModule();
  return validateWorldScenePackageManifest(manifest);
};

export const createWorldSceneLayerExportDocument = async (
  worldLayoutName: string,
  manifest: WorldScenePackageManifest,
  options: {
    includeRobotState?: boolean;
  } = {}
) => {
  const [
    { createStaticWorldSceneLayerSnapshot, validateWorldSceneLayerSnapshot, worldSceneManifestToLayerSnapshot },
  ] = await Promise.all([
    loadWorldSceneManifestModule(),
  ]);
  const layerSnapshot = worldSceneManifestToLayerSnapshot(manifest);
  const worldLayout: WorldSceneLayerSnapshot = createStaticWorldSceneLayerSnapshot({
    name: worldLayoutName,
    objects: manifest.world_snapshot.objects,
    urdf_xml: options.includeRobotState ? manifest.world_snapshot.urdf_xml : undefined,
    joint_positions: options.includeRobotState ? manifest.world_snapshot.joint_positions : undefined,
    cameras: options.includeRobotState ? manifest.world_snapshot.cameras : undefined,
    environment: layerSnapshot.environment,
  });
  const validationErrors = validateWorldSceneLayerSnapshot(worldLayout);
  if (validationErrors.length > 0) {
    throw new Error(`World layout export invalid: ${validationErrors.join("; ")}`);
  }
  return {
    filename: toWorldLayoutFilename(worldLayoutName),
    payload: {
      world_layout: {
        name: worldLayout.name,
        objects: worldLayout.objects,
        scenario_time_ms: worldLayout.scenario_time_ms,
        scenario_duration_ms: worldLayout.scenario_duration_ms,
        ...(worldLayout.urdf_xml !== undefined ? { urdf_xml: worldLayout.urdf_xml } : {}),
        ...(worldLayout.joint_positions !== undefined
          ? { joint_positions: worldLayout.joint_positions }
          : {}),
        ...(worldLayout.cameras !== undefined ? { cameras: worldLayout.cameras } : {}),
      },
      environment: worldLayout.environment,
    },
  };
};

export const publishWorldScenePackage = async (
  manifest: WorldScenePackageManifest,
  target: "registry" | "hub"
): Promise<WorldScenePackagePublishResponse> => {
  if (target === "hub") {
    const { publishWorldScenePackageToHub } = await loadWorldHubApiModule();
    return publishWorldScenePackageToHub(manifest);
  }
  const { publishWorldScenePackageManifest } =
    await loadWorldScenePackageApiModule();
  return publishWorldScenePackageManifest(manifest);
};

const assertImportableWorldScenePackage = async (
  manifest: WorldScenePackageManifest,
  invalidShapeMessage: string
) => {
  const { combinedErrors } = await validateWorldScenePackageLocally(manifest);
  if (combinedErrors.length > 0) {
    throw new Error(`${invalidShapeMessage}: ${combinedErrors.join("; ")}`);
  }
  return manifest;
};

export const parseWorldSceneManifestText = async (raw: string) => {
  const { readWorldSceneManifestFromUnknown } =
    await loadWorldSceneManifestModule();
  const manifest = readWorldSceneManifestFromUnknown(JSON.parse(raw));
  if (!manifest) {
    throw new Error("Invalid world package: unsupported manifest shape");
  }
  return assertImportableWorldScenePackage(manifest, "Invalid world package");
};

export const readWorldSceneManifestPayload = async (payload: unknown) => {
  const { readWorldSceneManifestFromUnknown } =
    await loadWorldSceneManifestModule();
  const manifest = readWorldSceneManifestFromUnknown(payload);
  if (!manifest) {
    throw new Error("Import link did not contain a valid world package manifest.");
  }
  return assertImportableWorldScenePackage(manifest, "Invalid world package");
};

export const fetchWorldRegistryPackages = async (): Promise<
  WorldScenePackageListEntry[]
> => {
  const { listWorldScenePackages } = await loadWorldScenePackageApiModule();
  return listWorldScenePackages();
};

export const fetchWorldScenePackageVersion = async (
  packageId: string,
  version: string
): Promise<WorldScenePackageVersionRecord> => {
  const { getWorldScenePackageVersion } = await loadWorldScenePackageApiModule();
  return getWorldScenePackageVersion(packageId, version);
};

const readWorldScenePackageFromImportUrl = async (
  importUrl: string,
  fetchImplementation: typeof fetch
) => {
  const { normalizeWorldLayoutImportUrl } = await loadWorldSceneImportUrlModule();
  const normalizedUrl = normalizeWorldLayoutImportUrl(importUrl);
  const response = await fetchImplementation(normalizedUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Import link failed (HTTP ${response.status})`);
  }
  return readWorldSceneManifestPayload(await response.json());
};

export const loadWorldScenePackageFromImportParams = async (
  importParams: WorldScenePackageImportParams,
  options: LoadWorldScenePackageFromImportParamsOptions = {}
): Promise<WorldScenePackageManifest> => {
  const importUrl = importParams.importUrl.trim();
  if (importUrl) {
    return readWorldScenePackageFromImportUrl(
      importUrl,
      options.fetchImplementation ?? fetch
    );
  }

  const packageId = importParams.packageId.trim();
  const version = importParams.version.trim();
  if (packageId && version) {
    const loadPackageVersion = options.loadPackageVersion ?? fetchWorldScenePackageVersion;
    const versionRecord = await loadPackageVersion(packageId, version);
    return versionRecord.manifest;
  }

  throw new Error("Import link did not contain a valid world package manifest.");
};

export const readWorldSceneLayerFromUrl = async (
  worldLayoutUrl: string,
  contextLabel: string
) => {
  const [
    { normalizeWorldLayoutImportUrl },
    { parseStaticWorldSceneLayerSnapshot },
  ] = await Promise.all([
    loadWorldSceneImportUrlModule(),
    loadWorldSceneManifestModule(),
  ]);
  const normalizedUrl = normalizeWorldLayoutImportUrl(worldLayoutUrl);
  if (!normalizedUrl) {
    throw new Error("World layout URL is empty.");
  }

  const response = await fetch(normalizedUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${contextLabel} failed (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  const { snapshot: worldLayout, errors } = parseStaticWorldSceneLayerSnapshot(payload);
  if (!worldLayout) {
    throw new Error(errors[0] ? `Invalid world layout: ${errors.join("; ")}` : "Invalid world layout");
  }

  return {
    worldLayout,
    embeddedCameras: worldLayout.cameras?.length ?? 0,
    baseUrl: response.url || normalizedUrl,
  };
};
