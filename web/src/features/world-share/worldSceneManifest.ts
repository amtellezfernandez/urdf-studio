import type {
  SerializableWorldObject,
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";
import {
  STATIC_WORLD_LAYOUT_KIND,
  STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR,
  STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  WORLD_SCENE_PACKAGE_LIMITS,
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
  isIntegerNumber,
  isNumber,
  isOneOf,
  isRecord,
  isString,
  validateAllowedFields,
  validateMaxLength,
} from "@/features/world-share/worldSceneManifestValidation";

type WorldSceneLayerEnvironment = Record<string, unknown> | null;

type ParsedWorldSceneLayerSnapshot = {
  name?: string;
  objects: unknown[];
  scenario_time_ms: number;
  scenario_duration_ms: number;
  environment: WorldSceneLayerEnvironment;
};

export type StaticWorldSceneLayerSnapshot = {
  kind: typeof STATIC_WORLD_LAYOUT_KIND;
  name?: string;
  objects: SerializableWorldObject[];
  scenario_time_ms: typeof STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS;
  scenario_duration_ms: typeof STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS;
  environment: WorldSceneLayerEnvironment;
};

export type WorldSceneLayerSnapshot = StaticWorldSceneLayerSnapshot;

const toStaticWorldSceneLayerSnapshot = (
  snapshot: ParsedWorldSceneLayerSnapshot
): StaticWorldSceneLayerSnapshot => ({
  kind: STATIC_WORLD_LAYOUT_KIND,
  name: snapshot.name,
  objects: snapshot.objects as SerializableWorldObject[],
  scenario_time_ms: STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  scenario_duration_ms: STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
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
  coerceWorldSceneSnapshotWithTiming(value, isNumber);

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

export const readWorldSceneManifestFromUnknown = (
  payload: unknown
): WorldScenePackageManifest | null => {
  const manifest = readWorldSceneManifestCandidate(payload);
  if (manifest) return manifest;
  if (isRecord(payload)) {
    return readWorldSceneManifestCandidate(payload.manifest);
  }
  return null;
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
    errors.push(...validateWorldJointPositions(manifest.world_snapshot.joint_positions));
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
  if (Array.isArray(manifest.world_snapshot?.objects)) {
    errors.push(...validateSerializableWorldObjects(manifest.world_snapshot.objects));
  }
  if (Array.isArray(manifest.world_snapshot?.cameras)) {
    errors.push(...validateSerializableWorldCameras(manifest.world_snapshot.cameras));
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

const toParsedWorldSceneLayerSnapshot = (
  value: unknown,
  environment: WorldSceneLayerEnvironment = null
): ParsedWorldSceneLayerSnapshot | null => {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.objects)) return null;
  if (!isNumber(value.scenario_time_ms) || !isNumber(value.scenario_duration_ms)) return null;
  return {
    name: isString(value.name) ? value.name : undefined,
    objects: value.objects,
    scenario_time_ms: value.scenario_time_ms,
    scenario_duration_ms: value.scenario_duration_ms,
    environment,
  };
};

const worldSceneManifestToLayerSnapshot = (
  manifest: WorldScenePackageManifest
): ParsedWorldSceneLayerSnapshot => ({
  name: manifest.title,
  objects: manifest.world_snapshot.objects,
  scenario_time_ms: manifest.world_snapshot.scenario_time_ms,
  scenario_duration_ms: manifest.world_snapshot.scenario_duration_ms,
  environment: isRecord(manifest.provenance?.environment)
    ? (manifest.provenance.environment as Record<string, unknown>)
    : null,
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
    return toParsedWorldSceneLayerSnapshot(
      payload.world_snapshot,
      isRecord(payload.environment) ? payload.environment : null
    );
  }

  if (isRecord(payload) && isRecord(payload.world_layout)) {
    return toParsedWorldSceneLayerSnapshot(
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
  environment?: WorldSceneLayerEnvironment;
}): StaticWorldSceneLayerSnapshot => ({
  kind: STATIC_WORLD_LAYOUT_KIND,
  name: params.name,
  objects: params.objects,
  scenario_time_ms: STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  scenario_duration_ms: STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  environment: params.environment ?? null,
});
