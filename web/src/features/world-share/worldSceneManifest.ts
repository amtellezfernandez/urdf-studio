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
  WORLD_SCENE_PACKAGE_PATTERNS,
  WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS,
  WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS,
  WORLD_SCENE_PACKAGE_MIN_SCENARIO_TIME_MS,
} from "@/features/world-share/worldScenePackageParams";
import {
  WORLD_ARTIFACT_FIELDS,
  WORLD_CAMERA_FIELDS,
  WORLD_CAMERA_INTRINSIC_FIELDS,
  WORLD_CAMERA_POSE_FIELDS,
  WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES,
  WORLD_LAYOUT_SUPPORTED_OBJECT_TYPES,
  WORLD_LAYOUT_SUPPORTED_ORBIT_TARGET_POINTS,
  WORLD_OBJECT_APPEARANCE_FIELDS,
  WORLD_OBJECT_APPEARANCE_REPRESENTATION_FIELDS,
  WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS,
  WORLD_OBJECT_CONSISTENCY_FIELDS,
  WORLD_OBJECT_CONSISTENCY_STATUSES,
  WORLD_OBJECT_INERTIA_FIELDS,
  WORLD_OBJECT_MESH_FIELDS,
  WORLD_OBJECT_PHYSICS_FIELDS,
  WORLD_OBJECT_PHYSICS_GEOMETRY_FIELDS,
  WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS,
  WORLD_OBJECT_SIMULATION_FIELDS,
  WORLD_RUNTIME_TARGET_FIELDS,
  WORLD_RUNTIME_TARGET_MODES,
  WORLD_SCENE_PACKAGE_FIELDS,
  WORLD_SECURITY_FIELDS,
  WORLD_SNAPSHOT_FIELDS,
} from "@/features/world-share/worldSceneManifestSchema";
import { validateSerializableWorldObjects } from "@/features/world-share/worldSceneObjectValidation";
import {
  isIntegerNumber,
  isNonEmptyString,
  isNullableString,
  isNumber,
  isOneOf,
  isRecord,
  isString,
  validateAllowedFields,
  validateCameraFovDeg,
  validateFiniteVector,
  validateMaxLength,
  validateNonEmptyString,
  validatePositiveInteger,
  validatePositiveNumber,
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

type ScenarioTimingValidationMessages = {
  durationOutOfRange: string;
  staticSceneTimeMismatch: string;
  timeOutOfBounds: string;
};

const validateScenarioTiming = (
  scenarioTimeMs: number,
  scenarioDurationMs: number,
  messages: ScenarioTimingValidationMessages
): string[] => {
  const errors: string[] = [];

  if (
    scenarioDurationMs < WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS ||
    scenarioDurationMs > WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS
  ) {
    errors.push(messages.durationOutOfRange);
  }

  if (scenarioDurationMs === WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS) {
    if (scenarioTimeMs !== WORLD_SCENE_PACKAGE_MIN_SCENARIO_TIME_MS) {
      errors.push(messages.staticSceneTimeMismatch);
    }
    return errors;
  }

  if (
    scenarioTimeMs < WORLD_SCENE_PACKAGE_MIN_SCENARIO_TIME_MS ||
    scenarioTimeMs > scenarioDurationMs
  ) {
    errors.push(messages.timeOutOfBounds);
  }

  return errors;
};

const validateSerializableWorldCamera = (value: unknown, cameraIndex: number): string[] => {
  const cameraLabel = `world snapshot cameras[${cameraIndex}]`;
  const errors: string[] = [];

  if (!isRecord(value)) {
    errors.push(`${cameraLabel} must be an object`);
    return errors;
  }

  errors.push(...validateAllowedFields(value, WORLD_CAMERA_FIELDS, cameraLabel));
  for (const fieldName of ["id", "name", "parent_joint"] as const) {
    if (!isNonEmptyString(value[fieldName])) {
      errors.push(`${cameraLabel}.${fieldName} must be a non-empty string`);
    }
  }

  if (!isRecord(value.pose)) {
    errors.push(`${cameraLabel}.pose must be an object`);
  } else {
    errors.push(...validateAllowedFields(value.pose, WORLD_CAMERA_POSE_FIELDS, `${cameraLabel}.pose`));
    errors.push(...validateFiniteVector(value.pose.xyz, `${cameraLabel}.pose.xyz`));
    errors.push(...validateFiniteVector(value.pose.rpy, `${cameraLabel}.pose.rpy`));
  }

  if (!isRecord(value.intrinsics)) {
    errors.push(`${cameraLabel}.intrinsics must be an object`);
    return errors;
  }

  const intrinsics = value.intrinsics;
  const intrinsicsLabel = `${cameraLabel}.intrinsics`;
  errors.push(...validateAllowedFields(intrinsics, WORLD_CAMERA_INTRINSIC_FIELDS, intrinsicsLabel));
  errors.push(...validatePositiveInteger(intrinsics.width, `${intrinsicsLabel}.width`));
  errors.push(...validatePositiveInteger(intrinsics.height, `${intrinsicsLabel}.height`));
  if (intrinsics.fov_deg !== undefined) {
    errors.push(...validateCameraFovDeg(intrinsics.fov_deg, `${intrinsicsLabel}.fov_deg`));
  }
  if (intrinsics.fx !== undefined) {
    errors.push(...validatePositiveNumber(intrinsics.fx, `${intrinsicsLabel}.fx`));
  }
  if (intrinsics.fy !== undefined) {
    errors.push(...validatePositiveNumber(intrinsics.fy, `${intrinsicsLabel}.fy`));
  }
  for (const fieldName of ["cx", "cy"] as const) {
    if (intrinsics[fieldName] !== undefined && !isNumber(intrinsics[fieldName])) {
      errors.push(`${intrinsicsLabel}.${fieldName} must be a finite number`);
    }
  }
  if (
    intrinsics.fov_deg === undefined &&
    intrinsics.fx === undefined &&
    intrinsics.fy === undefined
  ) {
    errors.push(`${intrinsicsLabel} must include fov_deg, fx, or fy`);
  }
  if (intrinsics.distortion !== undefined && !isRecord(intrinsics.distortion)) {
    errors.push(`${intrinsicsLabel}.distortion must be an object`);
  }

  return errors;
};

const validateSerializableWorldCameras = (cameras: unknown[]): string[] =>
  cameras.flatMap((camera, index) => validateSerializableWorldCamera(camera, index));

const validateWorldRuntimeTargets = (value: unknown): string[] => {
  if (!Array.isArray(value)) return ["runtime_targets must be an array"];
  const errors = validateMaxLength(
    value,
    "runtime_targets",
    WORLD_SCENE_PACKAGE_LIMITS.maxRuntimeTargets
  );
  if (errors.length > 0) return errors;
  return value.flatMap((target, index) => {
    const targetLabel = `runtime_targets[${index}]`;
    if (!isRecord(target)) return [`${targetLabel} must be an object`];
    const errors: string[] = [];
    errors.push(...validateAllowedFields(target, WORLD_RUNTIME_TARGET_FIELDS, targetLabel));
    errors.push(...validateNonEmptyString(target.name, `${targetLabel}.name`));
    if (!isOneOf(target.mode, WORLD_RUNTIME_TARGET_MODES)) {
      errors.push(`${targetLabel}.mode must be one of: ${WORLD_RUNTIME_TARGET_MODES.join(", ")}`);
    }
    if (target.min_version !== undefined && !isString(target.min_version)) {
      errors.push(`${targetLabel}.min_version must be a string`);
    }
    return errors;
  });
};

const validateWorldInterface = (value: unknown): string[] => {
  if (!isRecord(value)) return ["interface must be an object"];
  const errors: string[] = [];
  if (!Array.isArray(value.observation_modalities)) {
    errors.push("interface.observation_modalities must be an array");
  } else {
    errors.push(
      ...validateMaxLength(
        value.observation_modalities,
        "interface.observation_modalities",
        WORLD_SCENE_PACKAGE_LIMITS.maxInterfaceModalities
      )
    );
    value.observation_modalities.forEach((modality, index) => {
      errors.push(
        ...validateNonEmptyString(modality, `interface.observation_modalities[${index}]`)
      );
    });
  }
  errors.push(...validateNonEmptyString(value.action_semantics, "interface.action_semantics"));
  errors.push(...validatePositiveInteger(value.timestep_ms, "interface.timestep_ms"));
  errors.push(...validateNonEmptyString(value.frame_convention, "interface.frame_convention"));
  return errors;
};

const validateWorldArtifacts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return ["artifacts must be an array"];
  const errors = validateMaxLength(
    value,
    "artifacts",
    WORLD_SCENE_PACKAGE_LIMITS.maxArtifactRefs
  );
  if (errors.length > 0) return errors;
  return value.flatMap((artifact, index) => {
    const artifactLabel = `artifacts[${index}]`;
    if (!isRecord(artifact)) return [`${artifactLabel} must be an object`];
    const errors: string[] = [];
    errors.push(...validateAllowedFields(artifact, WORLD_ARTIFACT_FIELDS, artifactLabel));
    errors.push(...validateNonEmptyString(artifact.kind, `${artifactLabel}.kind`));
    if (
      !isString(artifact.digest_sha256) ||
      !WORLD_SCENE_PACKAGE_PATTERNS.digestSha256Hex.test(artifact.digest_sha256)
    ) {
      errors.push(`${artifactLabel}.digest_sha256 must be a SHA-256 hex digest`);
    }
    errors.push(...validateNonEmptyString(artifact.uri, `${artifactLabel}.uri`));
    return errors;
  });
};

const validateWorldSecurity = (value: unknown): string[] => {
  if (!isRecord(value)) return ["security must be an object"];
  const errors: string[] = [];
  errors.push(...validateAllowedFields(value, WORLD_SECURITY_FIELDS, "security"));
  if (value.signature_ref !== undefined && !isNullableString(value.signature_ref)) {
    errors.push("security.signature_ref must be a string or null");
  }
  if (!Array.isArray(value.attestation_refs)) {
    errors.push("security.attestation_refs must be an array");
  } else {
    value.attestation_refs.forEach((ref, index) => {
      if (!isString(ref)) {
        errors.push(`security.attestation_refs[${index}] must be a string`);
      }
    });
  }
  if (value.sbom_ref !== undefined && !isNullableString(value.sbom_ref)) {
    errors.push("security.sbom_ref must be a string or null");
  }
  return errors;
};

const validateWorldSnapshotShape = (value: unknown): string[] => {
  if (!isRecord(value)) return ["world_snapshot must be an object"];
  return validateAllowedFields(value, WORLD_SNAPSHOT_FIELDS, "world_snapshot");
};

const validateWorldJointPositions = (value: unknown): string[] => {
  if (!isRecord(value)) return ["world_snapshot.joint_positions must be an object"];
  const entries = Object.entries(value);
  const errors: string[] = [];
  if (entries.length > WORLD_SCENE_PACKAGE_LIMITS.maxJointsPerWorld) {
    errors.push(
      `world_snapshot.joint_positions must contain at most ${WORLD_SCENE_PACKAGE_LIMITS.maxJointsPerWorld} entries`
    );
    return errors;
  }
  entries.forEach(([jointName, jointValue]) => {
    if (!isNumber(jointValue)) {
      errors.push(`world_snapshot.joint_positions.${jointName} must be a finite number`);
    }
  });
  return errors;
};

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
      ...validateScenarioTiming(
        manifest.world_snapshot.scenario_time_ms,
        manifest.world_snapshot.scenario_duration_ms,
        {
          durationOutOfRange: `world_snapshot.scenario_duration_ms must be between ${WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS} and ${WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS}`,
          staticSceneTimeMismatch:
            "world_snapshot.scenario_time_ms must be 0 when scenario_duration_ms is 0",
          timeOutOfBounds: "world_snapshot.scenario_time_ms must be >= 0 and <= scenario_duration_ms",
        }
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
