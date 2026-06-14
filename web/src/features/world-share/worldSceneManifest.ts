import type {
  SerializableWorldObject,
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";
import {
  STATIC_WORLD_LAYOUT_KIND,
  STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR,
  STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS,
  STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS,
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
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
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

export const readWorldSceneManifestFromUnknown = (
  payload: unknown
): WorldScenePackageManifest | null => {
  if (isWorldSceneManifest(payload)) return payload;
  if (isRecord(payload) && isWorldSceneManifest(payload.manifest)) {
    return payload.manifest;
  }
  return null;
};

export const validateLocalWorldSceneManifest = (
  manifest: WorldScenePackageManifest
): string[] => {
  const errors: string[] = [];
  if (!manifest.package_id?.trim()) errors.push("package_id is required");
  if (!manifest.version?.trim()) errors.push("version is required");
  if (!manifest.world_snapshot?.urdf_xml?.trim()) {
    errors.push("world_snapshot.urdf_xml is required");
  }
  if (!manifest.world_snapshot || !isRecord(manifest.world_snapshot.joint_positions)) {
    errors.push("world_snapshot.joint_positions must be an object");
  }
  if (!Array.isArray(manifest.world_snapshot?.cameras)) {
    errors.push("world_snapshot.cameras must be an array");
  }
  if (!Array.isArray(manifest.world_snapshot?.objects)) {
    errors.push("world_snapshot.objects must be an array");
  }
  if (!isNumber(manifest.world_snapshot?.scenario_time_ms)) {
    errors.push("world_snapshot.scenario_time_ms must be a finite number");
  }
  if (!isNumber(manifest.world_snapshot?.scenario_duration_ms)) {
    errors.push("world_snapshot.scenario_duration_ms must be a finite number");
  }
  if (Array.isArray(manifest.world_snapshot?.objects)) {
    errors.push(...validateSerializableWorldObjects(manifest.world_snapshot.objects));
  }
  if (Array.isArray(manifest.world_snapshot?.cameras)) {
    errors.push(...validateSerializableWorldCameras(manifest.world_snapshot.cameras));
  }
  if (
    isNumber(manifest.world_snapshot?.scenario_time_ms) &&
    isNumber(manifest.world_snapshot?.scenario_duration_ms)
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
  if (isWorldSceneManifest(payload)) {
    return {
      name: payload.title,
      objects: payload.world_snapshot.objects,
      scenario_time_ms: payload.world_snapshot.scenario_time_ms,
      scenario_duration_ms: payload.world_snapshot.scenario_duration_ms,
      environment: isRecord(payload.provenance?.environment)
        ? (payload.provenance.environment as Record<string, unknown>)
        : null,
    };
  }

  if (isRecord(payload) && isWorldSceneManifest(payload.manifest)) {
    return {
      name: payload.manifest.title,
      objects: payload.manifest.world_snapshot.objects,
      scenario_time_ms: payload.manifest.world_snapshot.scenario_time_ms,
      scenario_duration_ms: payload.manifest.world_snapshot.scenario_duration_ms,
      environment: isRecord(payload.manifest.provenance?.environment)
        ? (payload.manifest.provenance.environment as Record<string, unknown>)
        : null,
    };
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
  if (snapshot.scenario_time_ms < 0) {
    errors.push("world layout scenario_time_ms must be a finite number >= 0");
  }
  if (snapshot.scenario_duration_ms < 0) {
    errors.push("world layout scenario_duration_ms must be a finite number >= 0");
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
