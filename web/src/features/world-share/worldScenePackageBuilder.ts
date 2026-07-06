import type { CreatedObject } from "@/features/objects";
import type { Camera } from "@/shared/types/camera";
import {
  WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS,
  WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION,
  WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS,
  WORLD_SCENE_PACKAGE_FALLBACK_TITLE,
  WORLD_SCENE_LAYER_DOWNLOAD_FILENAME_SUFFIX,
  WORLD_SCENE_PACKAGE_RUNTIME_TARGETS,
  WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
  WORLD_SCENE_PACKAGE_DOWNLOAD_FILENAME_SUFFIX,
  WORLD_SCENE_PACKAGE_URI_SCHEME,
} from "@/features/world-share/worldScenePackageParams";
import type {
  SerializableWorldObject,
  WorldArtifactRef,
  WorldSceneDocument,
  WorldSceneRegistryEnvelope,
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";
import {
  computeWorldSnapshotDigest,
  stableStringify,
} from "@/features/world-share/worldScenePackageDigest";
import {
  serializeWorldSceneObjects,
  toSerializableWorldObject,
} from "@/features/world-share/worldSceneObjectSerialization";
import { assertFiniteWorldSceneNumber } from "@/features/world-share/worldSceneNumber";

export { computeWorldSnapshotDigest, stableStringify };
export { serializeWorldSceneObjects, toSerializableWorldObject };

type BuildWorldScenePackageManifestParams = {
  packageId: string;
  version: string;
  title?: string;
  description?: string;
  urdfXml: string;
  jointPositions: Record<string, number>;
  cameras: Camera[];
  objects: CreatedObject[];
  scenarioTimeMs: number;
  scenarioDurationMs: number;
  runtimeTargets?: WorldScenePackageManifest["runtime_targets"];
  provenance?: Record<string, unknown>;
};

type BuildWorldSceneDocumentParams = {
  name?: string;
  urdfXml?: string;
  jointPositions?: Record<string, number>;
  cameras?: Camera[];
  objects: CreatedObject[];
  scenarioTimeMs: number;
  scenarioDurationMs: number;
  environment?: Record<string, unknown> | null;
  frameConvention?: string;
};

const normalizeSnapshotInteger = (value: unknown, fieldLabel: string): number => {
  const normalized = assertFiniteWorldSceneNumber(value, fieldLabel);
  if (!Number.isInteger(normalized)) {
    throw new Error(`${fieldLabel} must be an integer millisecond value.`);
  }
  return normalized;
};

const cloneVector3 = (
  value: readonly [number, number, number],
  fieldLabel: string
): [number, number, number] => [
  assertFiniteWorldSceneNumber(value[0], `${fieldLabel}[0]`),
  assertFiniteWorldSceneNumber(value[1], `${fieldLabel}[1]`),
  assertFiniteWorldSceneNumber(value[2], `${fieldLabel}[2]`),
];

const cloneJointPositions = (jointPositions: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(jointPositions).map(([jointName, position]) => [
      jointName,
      assertFiniteWorldSceneNumber(position, `joint_positions.${jointName}`),
    ])
  );

const cloneCamera = (camera: Camera): Camera => {
  const intrinsics = { ...camera.intrinsics };
  if (camera.intrinsics.distortion) {
    intrinsics.distortion = { ...camera.intrinsics.distortion };
  }
  return {
    id: camera.id,
    name: camera.name,
    parent_joint: camera.parent_joint,
    pose: {
      xyz: cloneVector3(camera.pose.xyz, `cameras.${camera.id}.pose.xyz`),
      rpy: cloneVector3(camera.pose.rpy, `cameras.${camera.id}.pose.rpy`),
    },
    intrinsics,
  };
};

const cloneSnapshotValue = (value: unknown, fieldLabel: string): unknown => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return assertFiniteWorldSceneNumber(value, fieldLabel);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneSnapshotValue(item, `${fieldLabel}[${index}]`));
  }
  if (typeof value === "object") {
    const cloned: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const clonedValue = cloneSnapshotValue(item, `${fieldLabel}.${key}`);
      if (clonedValue !== undefined) {
        cloned[key] = clonedValue;
      }
    });
    return cloned;
  }
  throw new Error(`${fieldLabel} must be JSON-compatible.`);
};

const cloneWorldSnapshot = (
  snapshot: WorldScenePackageManifest["world_snapshot"]
): WorldScenePackageManifest["world_snapshot"] => ({
  urdf_xml: snapshot.urdf_xml,
  joint_positions: cloneJointPositions(snapshot.joint_positions),
  cameras: snapshot.cameras.map(cloneCamera),
  objects: snapshot.objects.map(
    (object, index) => cloneSnapshotValue(object, `objects[${index}]`) as SerializableWorldObject
  ),
  scenario_time_ms: normalizeSnapshotInteger(
    snapshot.scenario_time_ms,
    "scenario_time_ms"
  ),
  scenario_duration_ms: normalizeSnapshotInteger(
    snapshot.scenario_duration_ms,
    "scenario_duration_ms"
  ),
});

const worldSceneDocumentEnvironment = ({
  environment,
  frameConvention,
}: {
  environment?: Record<string, unknown> | null;
  frameConvention?: string;
}): Record<string, unknown> | null => {
  const normalized =
    environment && typeof environment === "object" && !Array.isArray(environment)
      ? { ...environment }
      : {};
  normalized.frame_convention = frameConvention || WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION;
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const worldSnapshotArtifactRef = (digest: string): WorldArtifactRef => ({
  kind: "world_snapshot",
  digest_sha256: digest,
  uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
});

export const refreshWorldScenePackageSnapshotDigest = async (
  manifest: WorldScenePackageManifest
): Promise<WorldScenePackageManifest> => {
  const worldSnapshot = cloneWorldSnapshot(manifest.world_snapshot);
  const snapshotDigest = await computeWorldSnapshotDigest(worldSnapshot);
  return {
    ...manifest,
    runtime_targets: manifest.runtime_targets.map((target) => ({ ...target })),
    interface: {
      ...manifest.interface,
      observation_modalities: [...manifest.interface.observation_modalities],
    },
    artifacts: [
      ...manifest.artifacts
        .filter((artifact) => artifact.kind !== "world_snapshot")
        .map((artifact) => ({ ...artifact })),
      worldSnapshotArtifactRef(snapshotDigest),
    ],
    world_snapshot: worldSnapshot,
    provenance: { ...manifest.provenance },
    security: {
      signature_ref: manifest.security.signature_ref,
      attestation_refs: [...manifest.security.attestation_refs],
      sbom_ref: manifest.security.sbom_ref,
    },
  };
};

const worldSceneRegistryEnvironment = (
  manifest: WorldScenePackageManifest
): Record<string, unknown> | null => {
  const environment =
    manifest.provenance.environment &&
    typeof manifest.provenance.environment === "object" &&
    !Array.isArray(manifest.provenance.environment)
      ? { ...(manifest.provenance.environment as Record<string, unknown>) }
      : {};
  environment.frame_convention = manifest.interface.frame_convention;
  return Object.keys(environment).length > 0 ? environment : null;
};

export const toWorldSceneDocument = (
  manifest: WorldScenePackageManifest
): WorldSceneDocument => {
  const worldSnapshot = cloneWorldSnapshot(manifest.world_snapshot);
  const environment = worldSceneRegistryEnvironment(manifest);
  return {
    name: manifest.title,
    objects: worldSnapshot.objects,
    scenario_time_ms: worldSnapshot.scenario_time_ms,
    scenario_duration_ms: worldSnapshot.scenario_duration_ms,
    urdf_xml: worldSnapshot.urdf_xml,
    joint_positions: worldSnapshot.joint_positions,
    cameras: worldSnapshot.cameras,
    ...(environment ? { environment } : {}),
  };
};

export const buildWorldSceneDocument = ({
  name,
  urdfXml,
  jointPositions,
  cameras,
  objects,
  scenarioTimeMs,
  scenarioDurationMs,
  environment,
  frameConvention,
}: BuildWorldSceneDocumentParams): WorldSceneDocument => {
  const normalizedEnvironment = worldSceneDocumentEnvironment({
    environment,
    frameConvention,
  });
  return {
    ...(name?.trim() ? { name: name.trim() } : {}),
    objects: serializeWorldSceneObjects(objects),
    scenario_time_ms: normalizeSnapshotInteger(scenarioTimeMs, "scenario_time_ms"),
    scenario_duration_ms: normalizeSnapshotInteger(
      scenarioDurationMs,
      "scenario_duration_ms"
    ),
    ...(urdfXml?.trim() ? { urdf_xml: urdfXml } : {}),
    ...(jointPositions ? { joint_positions: cloneJointPositions(jointPositions) } : {}),
    ...(cameras ? { cameras: cameras.map(cloneCamera) } : {}),
    ...(normalizedEnvironment ? { environment: normalizedEnvironment } : {}),
  };
};

export const toWorldSceneRegistryEnvelope = (
  manifest: WorldScenePackageManifest
): WorldSceneRegistryEnvelope => {
  return {
    package_id: manifest.package_id,
    version: manifest.version,
    provenance: { ...manifest.provenance },
    artifacts: manifest.artifacts.map((artifact) => ({ ...artifact })),
    world: toWorldSceneDocument(manifest),
  };
};

const sanitizePackageId = (packageId: string): string =>
  packageId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const buildWorldScenePackageManifest = async ({
  packageId,
  version,
  title,
  description,
  urdfXml,
  jointPositions,
  cameras,
  objects,
  scenarioTimeMs,
  scenarioDurationMs,
  runtimeTargets,
  provenance,
}: BuildWorldScenePackageManifestParams): Promise<WorldScenePackageManifest> => {
  if (!urdfXml.trim()) {
    throw new Error("Cannot package world without URDF content.");
  }

  const normalizedPackageId = sanitizePackageId(packageId);
  if (!normalizedPackageId) {
    throw new Error("Package ID is empty after sanitization.");
  }

  const snapshot = {
    urdf_xml: urdfXml,
    joint_positions: cloneJointPositions(jointPositions),
    cameras: cameras.map(cloneCamera),
    objects: serializeWorldSceneObjects(objects),
    scenario_time_ms: normalizeSnapshotInteger(scenarioTimeMs, "scenario_time_ms"),
    scenario_duration_ms: normalizeSnapshotInteger(
      scenarioDurationMs,
      "scenario_duration_ms"
    ),
  };

  const snapshotDigest = await computeWorldSnapshotDigest(snapshot);
  const artifactRefs: WorldArtifactRef[] = [worldSnapshotArtifactRef(snapshotDigest)];

  const observationModalities = cameras.length > 0 ? ["rgb", "proprio"] : ["proprio"];

  return {
    schema_version: WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
    package_id: normalizedPackageId,
    version,
    title: title?.trim() || WORLD_SCENE_PACKAGE_FALLBACK_TITLE,
    description: description?.trim() || undefined,
    created_at: new Date().toISOString(),
    runtime_targets: runtimeTargets ? [...runtimeTargets] : [...WORLD_SCENE_PACKAGE_RUNTIME_TARGETS],
    interface: {
      observation_modalities: observationModalities,
      action_semantics: WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS,
      timestep_ms: WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS,
      frame_convention: WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION,
    },
    artifacts: artifactRefs,
    world_snapshot: snapshot,
    provenance: provenance ?? {},
    security: {
      signature_ref: null,
      attestation_refs: [],
      sbom_ref: null,
    },
  };
};

export const toWorldScenePackageDownloadName = (packageId: string, version: string) =>
  `${sanitizePackageId(packageId)}-${version}${WORLD_SCENE_PACKAGE_DOWNLOAD_FILENAME_SUFFIX}`;

export const toWorldSceneLayerDownloadName = (packageId: string, version: string) =>
  `${sanitizePackageId(packageId)}-${version}${WORLD_SCENE_LAYER_DOWNLOAD_FILENAME_SUFFIX}`;
