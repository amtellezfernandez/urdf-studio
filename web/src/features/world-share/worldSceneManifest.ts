import type {
  SerializableWorldObject,
  WorldSceneDocument,
  WorldSceneRegistryEnvelope,
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";
import {
  WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS,
  WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION,
  WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS,
  STATIC_WORLD_LAYOUT_KIND,
  STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR,
  STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  WORLD_SCENE_PACKAGE_LIMITS,
  WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
  WORLD_SCENE_PACKAGE_SUPPORTED_SCHEMA_VERSIONS,
} from "@/features/world-share/worldScenePackageParams";
import { WORLD_SCENE_PACKAGE_FIELDS } from "@/features/world-share/worldSceneManifestSchema";
import {
  validateSerializableWorldCameras,
  validateWorldArtifacts,
  validateWorldInterface,
  validateWorldJointPositions,
  validateWorldRuntimeTargets,
  validateWorldSecurity,
  validateWorldSnapshotScenarioTiming,
  validateWorldSnapshotShape,
} from "@/features/world-share/worldSceneManifestFieldValidation";
import { validateSerializableWorldObjects } from "@/features/world-share/worldSceneObjectValidation";
import {
  isFiniteWorldSceneNumber,
  isIntegerNumber,
  isOneOf,
  isRecord,
  isString,
  validateAllowedFields,
  validateMaxLength,
} from "@/features/world-share/worldSceneManifestValidation";

export type WorldSceneLayerEnvironment = Record<string, unknown> | null;

type ParsedWorldSceneLayerSnapshot = WorldSceneDocument;

export type StaticWorldSceneLayerSnapshot = {
  kind: typeof STATIC_WORLD_LAYOUT_KIND;
  name?: string;
  objects: SerializableWorldObject[];
  scenario_time_ms: typeof STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS;
  scenario_duration_ms: typeof STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS;
  urdf_xml?: string;
  joint_positions?: Record<string, number>;
  cameras?: WorldSceneDocument["cameras"];
  environment: WorldSceneLayerEnvironment;
};

export type WorldSceneLayerSnapshot = StaticWorldSceneLayerSnapshot;
const DEFAULT_WORLD_SCENE_PACKAGE_CREATED_AT = "1970-01-01T00:00:00.000Z";

const toStaticWorldSceneLayerSnapshot = (
  snapshot: ParsedWorldSceneLayerSnapshot
): StaticWorldSceneLayerSnapshot => ({
  kind: STATIC_WORLD_LAYOUT_KIND,
  name: snapshot.name,
  objects: snapshot.objects as SerializableWorldObject[],
  scenario_time_ms: STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  scenario_duration_ms: STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  urdf_xml: snapshot.urdf_xml,
  joint_positions: snapshot.joint_positions,
  cameras: snapshot.cameras,
  environment: snapshot.environment,
});

const coerceWorldSceneSnapshotWithTiming = (
  value: unknown,
  isScenarioTimingValue: (value: unknown) => value is number,
): WorldScenePackageManifest["world_snapshot"] | null => {
  if (!isRecord(value)) return null;
  if (!isString(value.urdf_xml) || !isRecord(value.joint_positions)) return null;
  if (!Array.isArray(value.cameras) || !Array.isArray(value.objects)) return null;
  if (
    !isScenarioTimingValue(value.scenario_time_ms) ||
    !isScenarioTimingValue(value.scenario_duration_ms)
  ) {
    return null;
  }
  return value as WorldScenePackageManifest["world_snapshot"];
};

export const coerceWorldSceneSnapshot = (
  value: unknown
): WorldScenePackageManifest["world_snapshot"] | null =>
  coerceWorldSceneSnapshotWithTiming(value, isIntegerNumber);

const coerceWorldSceneSnapshotCandidate = (
  value: unknown
): WorldScenePackageManifest["world_snapshot"] | null =>
  coerceWorldSceneSnapshotWithTiming(value, isFiniteWorldSceneNumber);

export const isWorldSceneManifest = (
  payload: unknown
): payload is WorldScenePackageManifest => {
  if (!isRecord(payload)) return false;
  if (!isString(payload.package_id) || !isString(payload.version)) return false;
  if (coerceWorldSceneSnapshot(payload.world_snapshot) === null) return false;
  return validateLocalWorldSceneManifest(payload as WorldScenePackageManifest).length === 0;
};

const readWorldSceneManifestCandidate = (
  payload: unknown
): WorldScenePackageManifest | null => {
  if (!isRecord(payload)) return null;
  if (!isString(payload.package_id) || !isString(payload.version)) return null;
  const snapshot = coerceWorldSceneSnapshotCandidate(payload.world_snapshot);
  if (!snapshot) return null;
  return {
    ...payload,
    world_snapshot: snapshot,
  } as WorldScenePackageManifest;
};

const isWorldSceneManifestEnvelope = (payload: unknown): boolean =>
  isRecord(payload) &&
  isRecord(payload.world_snapshot) &&
  "package_id" in payload &&
  "version" in payload;

const readValidWorldSceneManifestCandidate = (
  payload: unknown
): WorldScenePackageManifest | null => {
  const manifest = readWorldSceneManifestCandidate(payload);
  return manifest && isWorldSceneManifest(manifest) ? manifest : null;
};

const readWorldSceneRegistryEnvelopeCandidate = (
  payload: unknown
): WorldScenePackageManifest | null => {
  if (!isRecord(payload)) return null;
  if (!isString(payload.package_id) || !payload.package_id.trim()) return null;
  if (!isString(payload.version) || !payload.version.trim()) return null;
  if (!isRecord(payload.world)) return null;
  const environment = isRecord(payload.environment)
    ? payload.environment
    : isRecord(payload.world.environment)
      ? payload.world.environment
      : null;
  const world = toWorldSceneDocumentCandidate(payload.world, environment);
  if (!world) return null;
  const provenance = isRecord(payload.provenance)
    ? { ...payload.provenance }
    : {};
  if (environment) {
    provenance.environment =
      isRecord(provenance.environment)
        ? { ...provenance.environment, ...environment }
        : environment;
  }
  const frameConvention =
    environment && isString(environment.frame_convention) && environment.frame_convention.trim()
      ? environment.frame_convention
      : WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION;
  return {
    schema_version: WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
    package_id: payload.package_id.trim(),
    version: payload.version.trim(),
    title: (world.name || payload.package_id).trim(),
    created_at:
      isString(payload.created_at) && !Number.isNaN(Date.parse(payload.created_at))
        ? payload.created_at
        : DEFAULT_WORLD_SCENE_PACKAGE_CREATED_AT,
    runtime_targets: [],
    interface: {
      observation_modalities:
        Array.isArray(world.cameras) && world.cameras.length > 0 ? ["rgb", "proprio"] : ["proprio"],
      action_semantics: WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS,
      timestep_ms: WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS,
      frame_convention: frameConvention,
    },
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
    world_snapshot: {
      urdf_xml: world.urdf_xml ?? "<robot name='world'/>",
      joint_positions: world.joint_positions ?? {},
      cameras: world.cameras ?? [],
      objects: world.objects as SerializableWorldObject[],
      scenario_time_ms: world.scenario_time_ms,
      scenario_duration_ms: world.scenario_duration_ms,
    },
    provenance,
    security: {
      signature_ref: null,
      attestation_refs: [],
      sbom_ref: null,
    },
  };
};

const manifestToWorldSceneRegistryEnvelope = (
  manifest: WorldScenePackageManifest
): WorldSceneRegistryEnvelope => ({
  package_id: manifest.package_id,
  version: manifest.version,
  ...(manifest.description?.trim() ? { description: manifest.description.trim() } : {}),
  provenance: isRecord(manifest.provenance) ? { ...manifest.provenance } : {},
  artifacts: Array.isArray(manifest.artifacts) ? [...manifest.artifacts] : [],
  world: worldSceneManifestToLayerSnapshot(manifest),
});

const readValidWorldSceneRegistryEnvelopeCandidate = (
  payload: unknown
): WorldSceneRegistryEnvelope | null => {
  if (!isRecord(payload)) return null;
  if (!isString(payload.package_id) || !payload.package_id.trim()) return null;
  if (!isString(payload.version) || !payload.version.trim()) return null;
  if (!isRecord(payload.world)) return null;

  const environment = isRecord(payload.environment)
    ? payload.environment
    : isRecord(payload.world.environment)
      ? payload.world.environment
      : null;
  const world = toWorldSceneDocumentCandidate(payload.world, environment);
  if (!world) return null;

  return {
    package_id: payload.package_id.trim(),
    version: payload.version.trim(),
    ...(isString(payload.description) && payload.description.trim()
      ? { description: payload.description.trim() }
      : {}),
    provenance: isRecord(payload.provenance) ? { ...payload.provenance } : {},
    artifacts: Array.isArray(payload.artifacts)
      ? [...(payload.artifacts as WorldSceneRegistryEnvelope["artifacts"])]
      : [],
    world,
  };
};

export const readWorldSceneRegistryEnvelopeFromUnknown = (
  payload: unknown
): WorldSceneRegistryEnvelope | null => {
  const envelope = readValidWorldSceneRegistryEnvelopeCandidate(payload);
  if (envelope) return envelope;

  const manifest = readWorldSceneManifestCandidate(payload);
  if (manifest) return manifestToWorldSceneRegistryEnvelope(manifest);

  if (isRecord(payload)) {
    const nestedEnvelope = readValidWorldSceneRegistryEnvelopeCandidate(payload.manifest);
    if (nestedEnvelope) return nestedEnvelope;
    const nestedManifest = readWorldSceneManifestCandidate(payload.manifest);
    if (nestedManifest) return manifestToWorldSceneRegistryEnvelope(nestedManifest);
  }

  return null;
};

export const readWorldSceneManifestFromUnknown = (
  payload: unknown
): WorldScenePackageManifest | null => {
  const manifest = readWorldSceneManifestCandidate(payload);
  if (manifest) return manifest;
  const registryEnvelope = readWorldSceneRegistryEnvelopeCandidate(payload);
  if (registryEnvelope) return registryEnvelope;
  if (isRecord(payload)) {
    return readWorldSceneManifestCandidate(payload.manifest);
  }
  return null;
};

const toWorldDocumentValidationMessage = (error: string): string =>
  error
    .replace(/^world layout cameras/, "world.cameras")
    .replace(/^world layout urdf_xml/, "world.urdf_xml")
    .replace(/^world layout joint_positions/, "world.joint_positions")
    .replace(/^world layout scenario_time_ms/, "world.scenario_time_ms")
    .replace(/^world layout scenario_duration_ms/, "world.scenario_duration_ms");

export const validateLocalWorldSceneRegistryEnvelope = (
  envelope: WorldSceneRegistryEnvelope
): string[] => {
  const errors: string[] = [];
  if (!isString(envelope.package_id) || !envelope.package_id.trim()) {
    errors.push("package_id is required");
  }
  if (!isString(envelope.version) || !envelope.version.trim()) {
    errors.push("version is required");
  }
  if (envelope.description !== undefined && !isString(envelope.description)) {
    errors.push("description must be a string");
  }
  if (!isRecord(envelope.provenance)) {
    errors.push("provenance must be an object");
  }
  errors.push(...validateWorldArtifacts(envelope.artifacts));
  if (!isRecord(envelope.world)) {
    errors.push("world must be an object");
    return errors;
  }
  errors.push(
    ...validateWorldSceneLayerSnapshot(envelope.world).map(toWorldDocumentValidationMessage)
  );
  return errors;
};

export const validateLocalWorldSceneManifest = (
  manifest: WorldScenePackageManifest
): string[] => {
  const errors: string[] = [];
  if (isRecord(manifest)) {
    errors.push(...validateAllowedFields(manifest, WORLD_SCENE_PACKAGE_FIELDS, "manifest"));
  }
  if (!isOneOf(manifest.schema_version, WORLD_SCENE_PACKAGE_SUPPORTED_SCHEMA_VERSIONS)) {
    errors.push(
      `schema_version must be one of: ${WORLD_SCENE_PACKAGE_SUPPORTED_SCHEMA_VERSIONS.join(", ")}`
    );
  }
  if (!isString(manifest.package_id) || !manifest.package_id.trim()) {
    errors.push("package_id is required");
  }
  if (!isString(manifest.version) || !manifest.version.trim()) {
    errors.push("version is required");
  }
  if (!isString(manifest.title) || !manifest.title.trim()) {
    errors.push("title is required");
  }
  if (manifest.description !== undefined && !isString(manifest.description)) {
    errors.push("description must be a string");
  }
  if (!isString(manifest.created_at) || Number.isNaN(Date.parse(manifest.created_at))) {
    errors.push("created_at must be an ISO date-time string");
  }
  errors.push(...validateWorldRuntimeTargets(manifest.runtime_targets));
  errors.push(...validateWorldInterface(manifest.interface));
  errors.push(...validateWorldArtifacts(manifest.artifacts));
  errors.push(...validateWorldSnapshotShape(manifest.world_snapshot));
  if (!manifest.world_snapshot?.urdf_xml?.trim()) {
    errors.push("world_snapshot.urdf_xml is required");
  } else if (
    manifest.world_snapshot.urdf_xml.length >
    WORLD_SCENE_PACKAGE_LIMITS.maxWorldSnapshotUrdfChars
  ) {
    errors.push(
      `world_snapshot.urdf_xml must contain at most ${WORLD_SCENE_PACKAGE_LIMITS.maxWorldSnapshotUrdfChars} characters`
    );
  }
  if (manifest.world_snapshot) {
    errors.push(
      ...validateWorldSceneLayerSnapshot(worldSceneManifestToLayerSnapshot(manifest)).map(
        toWorldSnapshotValidationMessage
      )
    );
  }
  if (!Array.isArray(manifest.world_snapshot?.cameras)) {
    errors.push("world_snapshot.cameras must be an array");
  } else {
    errors.push(
      ...validateMaxLength(
        manifest.world_snapshot.cameras,
        "world_snapshot.cameras",
        WORLD_SCENE_PACKAGE_LIMITS.maxCamerasPerWorld
      )
    );
  }
  if (!Array.isArray(manifest.world_snapshot?.objects)) {
    errors.push("world_snapshot.objects must be an array");
  } else {
    errors.push(
      ...validateMaxLength(
        manifest.world_snapshot.objects,
        "world_snapshot.objects",
        WORLD_SCENE_PACKAGE_LIMITS.maxObjectsPerWorld
      )
    );
  }
  if (!isIntegerNumber(manifest.world_snapshot?.scenario_time_ms)) {
    errors.push("world_snapshot.scenario_time_ms must be an integer");
  }
  if (!isIntegerNumber(manifest.world_snapshot?.scenario_duration_ms)) {
    errors.push("world_snapshot.scenario_duration_ms must be an integer");
  }
  if (
    isIntegerNumber(manifest.world_snapshot?.scenario_time_ms) &&
    isIntegerNumber(manifest.world_snapshot?.scenario_duration_ms)
  ) {
    errors.push(
      ...validateWorldSnapshotScenarioTiming(
        manifest.world_snapshot.scenario_time_ms,
        manifest.world_snapshot.scenario_duration_ms
      )
    );
  }
  if (!isRecord(manifest.provenance)) {
    errors.push("provenance must be an object");
  }
  errors.push(...validateWorldSecurity(manifest.security));
  return errors;
};

const toWorldSnapshotValidationMessage = (error: string): string =>
  error
    .replace(/^world layout cameras/, "world snapshot cameras")
    .replace(/^world layout urdf_xml/, "world_snapshot.urdf_xml")
    .replace(/^world layout joint_positions/, "world_snapshot.joint_positions");

const toWorldSceneDocumentCandidate = (
  value: unknown,
  environment: WorldSceneLayerEnvironment = null
): ParsedWorldSceneLayerSnapshot | null => {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.objects)) return null;
  if (
    !isFiniteWorldSceneNumber(value.scenario_time_ms) ||
    !isFiniteWorldSceneNumber(value.scenario_duration_ms)
  ) {
    return null;
  }
  if (value.urdf_xml !== undefined && !isString(value.urdf_xml)) {
    return null;
  }
  if (value.joint_positions !== undefined && !isRecord(value.joint_positions)) {
    return null;
  }
  if (value.cameras !== undefined && !Array.isArray(value.cameras)) {
    return null;
  }
  return {
    name: isString(value.name) ? value.name : undefined,
    objects: value.objects,
    scenario_time_ms: value.scenario_time_ms,
    scenario_duration_ms: value.scenario_duration_ms,
    urdf_xml: isString(value.urdf_xml) ? value.urdf_xml : undefined,
    joint_positions:
      value.joint_positions !== undefined
        ? (value.joint_positions as Record<string, number>)
        : undefined,
    cameras:
      value.cameras !== undefined
        ? (value.cameras as WorldSceneDocument["cameras"])
        : undefined,
    environment,
  };
};

const manifestEnvironment = (
  manifest: WorldScenePackageManifest
): WorldSceneLayerEnvironment => {
  const environment = isRecord(manifest.provenance?.environment)
    ? { ...(manifest.provenance.environment as Record<string, unknown>) }
    : {};
  environment.frame_convention = manifest.interface.frame_convention;
  return Object.keys(environment).length > 0 ? environment : null;
};

export const worldSceneManifestToLayerSnapshot = (
  manifest: WorldScenePackageManifest
): ParsedWorldSceneLayerSnapshot => ({
  name: manifest.title,
  objects: manifest.world_snapshot.objects,
  scenario_time_ms: manifest.world_snapshot.scenario_time_ms,
  scenario_duration_ms: manifest.world_snapshot.scenario_duration_ms,
  urdf_xml: manifest.world_snapshot.urdf_xml,
  joint_positions: manifest.world_snapshot.joint_positions,
  cameras: manifest.world_snapshot.cameras,
  environment: manifestEnvironment(manifest),
});

export const readWorldSceneLayerFromUnknown = (
  payload: unknown
): ParsedWorldSceneLayerSnapshot | null => {
  const manifest = readValidWorldSceneManifestCandidate(payload);
  if (manifest) {
    return worldSceneManifestToLayerSnapshot(manifest);
  }
  if (isWorldSceneManifestEnvelope(payload)) {
    return null;
  }

  if (isRecord(payload)) {
    const nestedManifest = readValidWorldSceneManifestCandidate(payload.manifest);
    if (nestedManifest) {
      return worldSceneManifestToLayerSnapshot(nestedManifest);
    }
    if (isWorldSceneManifestEnvelope(payload.manifest)) {
      return null;
    }
  }

  if (isRecord(payload) && isRecord(payload.world_snapshot)) {
    return toWorldSceneDocumentCandidate(
      payload.world_snapshot,
      isRecord(payload.environment) ? payload.environment : null
    );
  }

  if (isRecord(payload) && isRecord(payload.world)) {
    return toWorldSceneDocumentCandidate(
      payload.world,
      isRecord(payload.environment)
        ? payload.environment
        : isRecord(payload.world.environment)
          ? payload.world.environment
          : null
    );
  }

  if (isRecord(payload) && isRecord(payload.world_layout)) {
    return toWorldSceneDocumentCandidate(
      payload.world_layout,
      isRecord(payload.environment) ? payload.environment : null
    );
  }
  return null;
};

export const validateWorldSceneLayerSnapshot = (
  snapshot: ParsedWorldSceneLayerSnapshot
): string[] => {
  const errors: string[] = [];
  errors.push(...validateSerializableWorldObjects(snapshot.objects));
  if (snapshot.urdf_xml !== undefined) {
    if (!snapshot.urdf_xml.trim()) {
      errors.push("world layout urdf_xml must be a non-empty string");
    } else if (
      snapshot.urdf_xml.length > WORLD_SCENE_PACKAGE_LIMITS.maxWorldSnapshotUrdfChars
    ) {
      errors.push(
        `world layout urdf_xml must contain at most ${WORLD_SCENE_PACKAGE_LIMITS.maxWorldSnapshotUrdfChars} characters`
      );
    }
  }
  if (snapshot.joint_positions !== undefined) {
    errors.push(
      ...validateWorldJointPositions(snapshot.joint_positions).map((error) =>
        error.replace("world_snapshot.joint_positions", "world layout joint_positions")
      )
    );
  }
  if (snapshot.cameras !== undefined) {
    errors.push(
      ...validateMaxLength(
        snapshot.cameras,
        "world layout cameras",
        WORLD_SCENE_PACKAGE_LIMITS.maxCamerasPerWorld
      )
    );
    errors.push(
      ...validateSerializableWorldCameras(snapshot.cameras).map((error) =>
        error.replace(/^world snapshot cameras/, "world layout cameras")
      )
    );
  }
  const timingErrors: string[] = [];
  if (!isIntegerNumber(snapshot.scenario_time_ms)) {
    timingErrors.push("world layout scenario_time_ms must be an integer");
  }
  if (!isIntegerNumber(snapshot.scenario_duration_ms)) {
    timingErrors.push("world layout scenario_duration_ms must be an integer");
  }
  if (timingErrors.length > 0) {
    errors.push(...timingErrors);
    return errors;
  }
  if (snapshot.scenario_time_ms < 0) {
    errors.push("world layout scenario_time_ms must be an integer >= 0");
  }
  if (snapshot.scenario_duration_ms < 0) {
    errors.push("world layout scenario_duration_ms must be an integer >= 0");
  }
  if (
    snapshot.scenario_time_ms !== STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS ||
    snapshot.scenario_duration_ms !== STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS
  ) {
    errors.push(STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR);
  }
  return errors;
};

export const parseStaticWorldSceneLayerSnapshot = (payload: unknown): { snapshot: StaticWorldSceneLayerSnapshot | null; errors: string[] } => {
  const parsedSnapshot = readWorldSceneLayerFromUnknown(payload);
  if (!parsedSnapshot) {
    return {
      snapshot: null,
      errors: ["World layout payload does not include a valid world layout."],
    };
  }

  const errors = validateWorldSceneLayerSnapshot(parsedSnapshot);
  if (errors.length > 0) {
    return { snapshot: null, errors };
  }

  return {
    snapshot: toStaticWorldSceneLayerSnapshot(parsedSnapshot),
    errors: [],
  };
};

export const createStaticWorldSceneLayerSnapshot = (params: {
  name?: string;
  objects: SerializableWorldObject[];
  urdf_xml?: string;
  joint_positions?: Record<string, number>;
  cameras?: WorldSceneDocument["cameras"];
  environment?: WorldSceneLayerEnvironment;
}): StaticWorldSceneLayerSnapshot => ({
  kind: STATIC_WORLD_LAYOUT_KIND,
  name: params.name,
  objects: params.objects,
  scenario_time_ms: STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  scenario_duration_ms: STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  urdf_xml: params.urdf_xml,
  joint_positions: params.joint_positions,
  cameras: params.cameras,
  environment: params.environment ?? null,
});
