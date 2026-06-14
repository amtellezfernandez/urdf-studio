import type {
  SerializableWorldObject,
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";
import {
  STATIC_WORLD_LAYOUT_KIND,
  STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR,
  STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
  WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
  WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS,
  WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS,
  WORLD_SCENE_PACKAGE_MIN_SCENARIO_TIME_MS,
} from "@/features/world-share/worldScenePackageParams";

const WORLD_LAYOUT_VECTOR_COMPONENT_COUNT = 3 as const;
const WORLD_LAYOUT_VECTOR_COMPONENT_LABELS = ["x", "y", "z"] as const;
const WORLD_LAYOUT_SUPPORTED_OBJECT_TYPES = ["cube", "point", "sphere", "cylinder", "mesh"] as const;
const WORLD_LAYOUT_SUPPORTED_OBJECT_SOURCES = [
  "user",
  "world-scenario",
  "demo-world",
  "runtime-detection",
  "runtime-demo",
  "runtime-restricted-area",
  "runtime-trajectory",
] as const;
const WORLD_LAYOUT_SUPPORTED_ORBIT_TARGET_POINTS = ["center", "primary", "secondary"] as const;
const WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES = ["punctual", "orbit"] as const;
const WORLD_CAMERA_FIELDS = ["id", "name", "parent_joint", "pose", "intrinsics"] as const;
const WORLD_CAMERA_POSE_FIELDS = ["xyz", "rpy"] as const;
const WORLD_CAMERA_INTRINSIC_FIELDS = [
  "width",
  "height",
  "fov_deg",
  "fx",
  "fy",
  "cx",
  "cy",
  "distortion",
] as const;
const WORLD_SCENE_PACKAGE_FIELDS = [
  "schema_version",
  "package_id",
  "version",
  "title",
  "description",
  "created_at",
  "runtime_targets",
  "interface",
  "artifacts",
  "world_snapshot",
  "provenance",
  "security",
] as const;
const WORLD_SNAPSHOT_FIELDS = [
  "urdf_xml",
  "joint_positions",
  "cameras",
  "objects",
  "scenario_time_ms",
  "scenario_duration_ms",
] as const;
const WORLD_RUNTIME_TARGET_FIELDS = ["name", "mode", "min_version"] as const;
const WORLD_RUNTIME_TARGET_MODES = ["native", "python", "container"] as const;
const WORLD_ARTIFACT_FIELDS = ["kind", "digest_sha256", "uri"] as const;
const WORLD_SECURITY_FIELDS = ["signature_ref", "attestation_refs", "sbom_ref"] as const;
const WORLD_ARTIFACT_DIGEST_SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const WORLD_SCENE_PACKAGE_LIMITS = {
  maxRuntimeTargets: 16,
  maxInterfaceModalities: 32,
  maxArtifactRefs: 128,
  maxCamerasPerWorld: 64,
  maxObjectsPerWorld: 256,
  maxJointsPerWorld: 512,
  maxWorldSnapshotUrdfChars: 500_000,
} as const;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isIntegerNumber = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isOneOf = <TValue extends string>(
  value: unknown,
  supportedValues: readonly TValue[]
): value is TValue => isString(value) && supportedValues.includes(value as TValue);

const isNullableString = (value: unknown): value is string | null => value === null || isString(value);

const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;

const validateFiniteVector = (
  value: unknown,
  fieldLabel: string,
  options?: { requirePositive?: boolean }
): string[] => {
  const errors: string[] = [];
  if (!Array.isArray(value) || value.length !== WORLD_LAYOUT_VECTOR_COMPONENT_COUNT) {
    errors.push(
      `${fieldLabel} must be an array of ${WORLD_LAYOUT_VECTOR_COMPONENT_COUNT} finite numbers`
    );
    return errors;
  }

  value.forEach((component, index) => {
    const axisLabel = WORLD_LAYOUT_VECTOR_COMPONENT_LABELS[index] ?? `${index}`;
    if (!isNumber(component)) {
      errors.push(`${fieldLabel}[${axisLabel}] must be a finite number`);
      return;
    }
    if (options?.requirePositive && component <= 0) {
      errors.push(`${fieldLabel}[${axisLabel}] must be > 0`);
    }
  });

  return errors;
};

const validateAllowedFields = (
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  fieldLabel: string
): string[] => {
  const unsupportedFields = Object.keys(value)
    .filter((fieldName) => !allowedFields.includes(fieldName))
    .sort((left, right) => left.localeCompare(right));
  return unsupportedFields.length > 0
    ? [`${fieldLabel} has unsupported field(s): ${unsupportedFields.join(", ")}`]
    : [];
};

const validatePositiveInteger = (value: unknown, fieldLabel: string): string[] => {
  if (!isNumber(value) || !Number.isInteger(value) || value < 1) {
    return [`${fieldLabel} must be a positive integer`];
  }
  return [];
};

const validateNonEmptyString = (value: unknown, fieldLabel: string): string[] => {
  if (!isNonEmptyString(value)) {
    return [`${fieldLabel} must be a non-empty string`];
  }
  return [];
};

const validateMaxLength = (
  value: unknown[],
  fieldLabel: string,
  maxLength: number
): string[] =>
  value.length > maxLength ? [`${fieldLabel} must contain at most ${maxLength} entries`] : [];

const validatePositiveNumber = (value: unknown, fieldLabel: string): string[] => {
  if (!isNumber(value) || value <= 0) {
    return [`${fieldLabel} must be a finite number > 0`];
  }
  return [];
};

const validateCameraFovDeg = (value: unknown, fieldLabel: string): string[] => {
  if (!isNumber(value) || value < 1 || value > 179) {
    return [`${fieldLabel} must be between 1 and 179 degrees`];
  }
  return [];
};

const validateOptionalBoolean = (value: unknown, fieldLabel: string): string[] => {
  if (value === undefined) return [];
  return isBoolean(value) ? [] : [`${fieldLabel} must be a boolean`];
};

const validateOptionalString = (value: unknown, fieldLabel: string): string[] => {
  if (value === undefined || value === null) return [];
  return isString(value) ? [] : [`${fieldLabel} must be a string or null`];
};

const validateOptionalFiniteNumber = (
  value: unknown,
  fieldLabel: string,
  options?: { minimum?: number; maximum?: number }
): string[] => {
  if (value === undefined || value === null) return [];
  if (!isNumber(value)) return [`${fieldLabel} must be a finite number or null`];
  if (options?.minimum !== undefined && value < options.minimum) {
    return [`${fieldLabel} must be >= ${options.minimum}`];
  }
  if (options?.maximum !== undefined && value > options.maximum) {
    return [`${fieldLabel} must be <= ${options.maximum}`];
  }
  return [];
};

const normalizePortableWorldAssetRef = (value: string): string | null => {
  if (value !== value.trim()) return null;
  let normalized = value.replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  const segments = normalized.length > 0 ? normalized.split("/") : [];
  if (
    normalized.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    `/${normalized}/`.includes("/../") ||
    normalized.includes(":")
  ) {
    return null;
  }
  return normalized;
};

const validatePortableWorldAssetRef = (value: unknown, fieldLabel: string): string[] => {
  if (!isNonEmptyString(value)) return [`${fieldLabel} must be a non-empty string`];
  return normalizePortableWorldAssetRef(value) === null
    ? [`${fieldLabel} must be a portable relative asset reference`]
    : [];
};

const validateWorldObjectSimulation = (value: unknown, objectLabel: string): string[] => {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${objectLabel}.simulation must be an object`];
  const errors: string[] = [];
  errors.push(...validateOptionalBoolean(value.fixed, `${objectLabel}.simulation.fixed`));
  errors.push(...validateOptionalBoolean(value.collision, `${objectLabel}.simulation.collision`));
  errors.push(
    ...validateOptionalFiniteNumber(value.mass_kg, `${objectLabel}.simulation.mass_kg`, {
      minimum: 0,
    })
  );
  errors.push(
    ...validateOptionalFiniteNumber(value.friction, `${objectLabel}.simulation.friction`, {
      minimum: 0.01,
      maximum: 5,
    })
  );
  errors.push(
    ...validateOptionalFiniteNumber(value.restitution, `${objectLabel}.simulation.restitution`, {
      minimum: 0,
      maximum: 1,
    })
  );
  errors.push(...validateOptionalString(value.semantic_role, `${objectLabel}.simulation.semantic_role`));
  return errors;
};

const readWorldObjectMeshAssetRef = (value: Record<string, unknown>): string | null => {
  if (isNonEmptyString(value.asset_ref)) {
    return normalizePortableWorldAssetRef(value.asset_ref);
  }
  const mesh = value.mesh;
  if (!isRecord(mesh)) return null;
  const meshAssetRef = mesh.asset_ref ?? mesh.path ?? mesh.uri ?? mesh.filename;
  return isNonEmptyString(meshAssetRef) ? normalizePortableWorldAssetRef(meshAssetRef) : null;
};

const validateWorldObjectMeshMetadata = (
  value: Record<string, unknown>,
  objectLabel: string
): string[] => {
  const errors: string[] = [];
  if (value.asset_ref !== undefined) {
    errors.push(...validatePortableWorldAssetRef(value.asset_ref, `${objectLabel}.asset_ref`));
  }
  if (value.asset_scale_xyz !== undefined) {
    errors.push(
      ...validateFiniteVector(value.asset_scale_xyz, `${objectLabel}.asset_scale_xyz`, {
        requirePositive: true,
      })
    );
  }

  if (value.mesh !== undefined) {
    if (!isRecord(value.mesh)) {
      errors.push(`${objectLabel}.mesh must be an object`);
    } else {
      const mesh = value.mesh;
      for (const key of ["asset_ref", "path", "uri", "filename"] as const) {
        if (mesh[key] !== undefined) {
          errors.push(
            ...validatePortableWorldAssetRef(mesh[key], `${objectLabel}.mesh.${key}`)
          );
        }
      }
      if (mesh.scale !== undefined) {
        if (isNumber(mesh.scale)) {
          if (mesh.scale <= 0) errors.push(`${objectLabel}.mesh.scale must be > 0`);
        } else {
          errors.push(
            ...validateFiniteVector(mesh.scale, `${objectLabel}.mesh.scale`, {
              requirePositive: true,
            })
          );
        }
      }
      if (mesh.scale_xyz !== undefined) {
        errors.push(
          ...validateFiniteVector(mesh.scale_xyz, `${objectLabel}.mesh.scale_xyz`, {
            requirePositive: true,
          })
        );
      }
    }
  }

  if (value.type === "mesh" && readWorldObjectMeshAssetRef(value) === null) {
    errors.push(`${objectLabel}.mesh asset reference is required for mesh objects`);
  }
  return errors;
};

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

const validateSerializableWorldObject = (value: unknown, objectIndex: number): string[] => {
  const objectLabel = `world layout objects[${objectIndex}]`;
  const errors: string[] = [];

  if (!isRecord(value)) {
    errors.push(`${objectLabel} must be an object`);
    return errors;
  }

  if (!isString(value.id) || !value.id.trim()) {
    errors.push(`${objectLabel}.id must be a non-empty string`);
  }
  if (!isString(value.name) || !value.name.trim()) {
    errors.push(`${objectLabel}.name must be a non-empty string`);
  }
  if (!isOneOf(value.type, WORLD_LAYOUT_SUPPORTED_OBJECT_TYPES)) {
    errors.push(
      `${objectLabel}.type must be one of: ${WORLD_LAYOUT_SUPPORTED_OBJECT_TYPES.join(", ")}`
    );
  }
  errors.push(...validateFiniteVector(value.position_xyz, `${objectLabel}.position_xyz`));
  if (value.rotation_rpy_rad !== undefined) {
    errors.push(
      ...validateFiniteVector(value.rotation_rpy_rad, `${objectLabel}.rotation_rpy_rad`)
    );
  }
  errors.push(
    ...validateFiniteVector(value.size_xyz, `${objectLabel}.size_xyz`, { requirePositive: true })
  );
  if (!isString(value.color) || !value.color.trim()) {
    errors.push(`${objectLabel}.color must be a non-empty string`);
  }
  if (
    value.source !== undefined &&
    !isOneOf(value.source, WORLD_LAYOUT_SUPPORTED_OBJECT_SOURCES)
  ) {
    errors.push(
      `${objectLabel}.source must be one of: ${WORLD_LAYOUT_SUPPORTED_OBJECT_SOURCES.join(", ")}`
    );
  }
  if (value.tracked_joint_name !== undefined && !isNullableString(value.tracked_joint_name)) {
    errors.push(`${objectLabel}.tracked_joint_name must be a string or null`);
  }
  if (value.is_hidden !== undefined && !isBoolean(value.is_hidden)) {
    errors.push(`${objectLabel}.is_hidden must be a boolean`);
  }
  if (value.is_ik_target !== undefined && !isBoolean(value.is_ik_target)) {
    errors.push(`${objectLabel}.is_ik_target must be a boolean`);
  }
  errors.push(...validateWorldObjectSimulation(value.simulation, objectLabel));
  errors.push(...validateWorldObjectMeshMetadata(value, objectLabel));

  const ikTargetType = value.ik_target_type ?? "punctual";
  if (!isOneOf(ikTargetType, WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES)) {
    errors.push(
      `${objectLabel}.ik_target_type must be one of: ${WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES.join(", ")}`
    );
    return errors;
  }

  if (ikTargetType === "orbit") {
    if (!isNumber(value.orbit_radius) || value.orbit_radius <= 0) {
      errors.push(`${objectLabel}.orbit_radius must be a finite number > 0`);
    }
    if (!isNumber(value.orbit_inclination_deg)) {
      errors.push(`${objectLabel}.orbit_inclination_deg must be a finite number`);
    }
    if (!isNumber(value.orbit_phase_deg)) {
      errors.push(`${objectLabel}.orbit_phase_deg must be a finite number`);
    }
    if (!isNumber(value.orbit_secondary_offset_deg)) {
      errors.push(`${objectLabel}.orbit_secondary_offset_deg must be a finite number`);
    }
    if (
      value.orbit_target_point !== undefined &&
      !isOneOf(value.orbit_target_point, WORLD_LAYOUT_SUPPORTED_ORBIT_TARGET_POINTS)
    ) {
      errors.push(
        `${objectLabel}.orbit_target_point must be one of: ${WORLD_LAYOUT_SUPPORTED_ORBIT_TARGET_POINTS.join(", ")}`
      );
    }
  }

  return errors;
};

const validateSerializableWorldObjects = (objects: unknown[]): string[] =>
  objects.flatMap((object, index) => validateSerializableWorldObject(object, index));

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
      !WORLD_ARTIFACT_DIGEST_SHA256_PATTERN.test(artifact.digest_sha256)
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

export const coerceWorldSceneSnapshot = (
  value: unknown
): WorldScenePackageManifest["world_snapshot"] | null => {
  if (!isRecord(value)) return null;
  if (!isString(value.urdf_xml) || !isRecord(value.joint_positions)) return null;
  if (!Array.isArray(value.cameras) || !Array.isArray(value.objects)) return null;
  if (!isIntegerNumber(value.scenario_time_ms) || !isIntegerNumber(value.scenario_duration_ms)) {
    return null;
  }
  return value as WorldScenePackageManifest["world_snapshot"];
};

const coerceWorldSceneSnapshotCandidate = (
  value: unknown
): WorldScenePackageManifest["world_snapshot"] | null => {
  if (!isRecord(value)) return null;
  if (!isString(value.urdf_xml) || !isRecord(value.joint_positions)) return null;
  if (!Array.isArray(value.cameras) || !Array.isArray(value.objects)) return null;
  if (!isNumber(value.scenario_time_ms) || !isNumber(value.scenario_duration_ms)) return null;
  return value as WorldScenePackageManifest["world_snapshot"];
};

export const isWorldSceneManifest = (
  payload: unknown
): payload is WorldScenePackageManifest => {
  if (!isRecord(payload)) return false;
  if (!isString(payload.package_id) || !isString(payload.version)) return false;
  return coerceWorldSceneSnapshot(payload.world_snapshot) !== null;
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
  if (manifest.schema_version !== WORLD_SCENE_PACKAGE_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${WORLD_SCENE_PACKAGE_SCHEMA_VERSION}`);
  }
  if (!manifest.package_id?.trim()) errors.push("package_id is required");
  if (!manifest.version?.trim()) errors.push("version is required");
  if (!manifest.title?.trim()) errors.push("title is required");
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

export const readWorldSceneLayerFromUnknown = (
  payload: unknown
): ParsedWorldSceneLayerSnapshot | null => {
  const manifest = readWorldSceneManifestCandidate(payload);
  if (manifest) {
    return {
      name: manifest.title,
      objects: manifest.world_snapshot.objects,
      scenario_time_ms: manifest.world_snapshot.scenario_time_ms,
      scenario_duration_ms: manifest.world_snapshot.scenario_duration_ms,
      environment: isRecord(manifest.provenance?.environment)
        ? (manifest.provenance.environment as Record<string, unknown>)
        : null,
    };
  }

  if (isRecord(payload)) {
    const nestedManifest = readWorldSceneManifestCandidate(payload.manifest);
    if (nestedManifest) {
      return {
        name: nestedManifest.title,
        objects: nestedManifest.world_snapshot.objects,
        scenario_time_ms: nestedManifest.world_snapshot.scenario_time_ms,
        scenario_duration_ms: nestedManifest.world_snapshot.scenario_duration_ms,
        environment: isRecord(nestedManifest.provenance?.environment)
          ? (nestedManifest.provenance.environment as Record<string, unknown>)
          : null,
      };
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

export const parseStaticWorldSceneLayerSnapshot = (
  payload: unknown
): { snapshot: StaticWorldSceneLayerSnapshot | null; errors: string[] } => {
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
