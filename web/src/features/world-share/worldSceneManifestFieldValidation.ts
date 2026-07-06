import {
  WORLD_ARTIFACT_FIELDS,
  WORLD_CAMERA_FIELDS,
  WORLD_CAMERA_INTRINSIC_FIELDS,
  WORLD_CAMERA_POSE_FIELDS,
  WORLD_RUNTIME_TARGET_FIELDS,
  WORLD_RUNTIME_TARGET_MODES,
  WORLD_SECURITY_FIELDS,
  WORLD_SNAPSHOT_FIELDS,
} from "@/features/world-share/worldSceneManifestSchema";
import {
  WORLD_SCENE_PACKAGE_LIMITS,
  WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS,
  WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS,
  WORLD_SCENE_PACKAGE_MIN_SCENARIO_TIME_MS,
  WORLD_SCENE_PACKAGE_PATTERNS,
} from "@/features/world-share/worldScenePackageParams";
import {
  isFiniteWorldSceneNumber,
  isNonEmptyString,
  isNullableString,
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

export const validateWorldSnapshotScenarioTiming = (
  scenarioTimeMs: number,
  scenarioDurationMs: number
): string[] =>
  validateScenarioTiming(scenarioTimeMs, scenarioDurationMs, {
    durationOutOfRange: `world_snapshot.scenario_duration_ms must be between ${WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS} and ${WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS}`,
    staticSceneTimeMismatch:
      "world_snapshot.scenario_time_ms must be 0 when scenario_duration_ms is 0",
    timeOutOfBounds: "world_snapshot.scenario_time_ms must be >= 0 and <= scenario_duration_ms",
  });

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
    if (
      intrinsics[fieldName] !== undefined &&
      !isFiniteWorldSceneNumber(intrinsics[fieldName])
    ) {
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

export const validateSerializableWorldCameras = (cameras: unknown[]): string[] =>
  cameras.flatMap((camera, index) => validateSerializableWorldCamera(camera, index));

export const validateWorldRuntimeTargets = (value: unknown): string[] => {
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

export const validateWorldInterface = (value: unknown): string[] => {
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

export const validateWorldArtifacts = (value: unknown): string[] => {
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

export const validateWorldSecurity = (value: unknown): string[] => {
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

export const validateWorldSnapshotShape = (value: unknown): string[] => {
  if (!isRecord(value)) return ["world_snapshot must be an object"];
  return validateAllowedFields(value, WORLD_SNAPSHOT_FIELDS, "world_snapshot");
};

export const validateWorldJointPositions = (value: unknown): string[] => {
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
    if (!isFiniteWorldSceneNumber(jointValue)) {
      errors.push(`world_snapshot.joint_positions.${jointName} must be a finite number`);
    }
  });
  return errors;
};
