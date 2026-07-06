import { WORLD_OBJECT_SOURCES } from "@/shared/types/worldObject";
import {
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
} from "@/features/world-share/worldSceneManifestSchema";
import {
  isBoolean,
  isFiniteWorldSceneNumber,
  isNonEmptyString,
  isNullableString,
  isOneOf,
  isRecord,
  isString,
  normalizePortableWorldAssetRef,
  validateAllowedFields,
  validateFiniteVector,
  validateNonEmptyString,
  validateOptionalBoolean,
  validateOptionalFiniteNumber,
  validateOptionalString,
  validatePortableWorldAssetRef,
  validatePositiveNumber,
} from "@/features/world-share/worldSceneManifestValidation";

const validateWorldObjectSimulation = (value: unknown, objectLabel: string): string[] => {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${objectLabel}.simulation must be an object`];
  const errors: string[] = [];
  errors.push(
    ...validateAllowedFields(
      value,
      WORLD_OBJECT_SIMULATION_FIELDS,
      `${objectLabel}.simulation`
    )
  );
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
  if (isRecord(mesh)) {
    const meshAssetRef = mesh.asset_ref ?? mesh.path ?? mesh.uri ?? mesh.filename;
    if (isNonEmptyString(meshAssetRef)) {
      return normalizePortableWorldAssetRef(meshAssetRef);
    }
  }
  const appearance = value.appearance;
  if (!isRecord(appearance) || !Array.isArray(appearance.representations)) return null;
  for (const representation of appearance.representations) {
    if (!isRecord(representation)) continue;
    if (!isOneOf(representation.kind, ["mesh", "splat"] as const)) continue;
    if (isNonEmptyString(representation.asset_ref)) {
      return normalizePortableWorldAssetRef(representation.asset_ref);
    }
  }
  return null;
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
      errors.push(
        ...validateAllowedFields(mesh, WORLD_OBJECT_MESH_FIELDS, `${objectLabel}.mesh`)
      );
      for (const key of ["asset_ref", "path", "uri", "filename"] as const) {
        if (mesh[key] !== undefined) {
          errors.push(
            ...validatePortableWorldAssetRef(mesh[key], `${objectLabel}.mesh.${key}`)
          );
        }
      }
      if (mesh.scale !== undefined) {
        if (isFiniteWorldSceneNumber(mesh.scale)) {
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

const hasPhysicsCollisionGeometry = (value: Record<string, unknown>): boolean =>
  isRecord(value.physics) && isRecord(value.physics.collision_geometry);

const validateWorldObjectAppearance = (
  value: Record<string, unknown>,
  objectLabel: string
): string[] => {
  if (value.appearance === undefined) return [];
  if (!isRecord(value.appearance)) return [`${objectLabel}.appearance must be an object`];
  const appearance = value.appearance;
  const errors: string[] = [];
  errors.push(
    ...validateAllowedFields(appearance, WORLD_OBJECT_APPEARANCE_FIELDS, `${objectLabel}.appearance`)
  );
  if (!Array.isArray(appearance.representations) || appearance.representations.length === 0) {
    errors.push(`${objectLabel}.appearance.representations must be a non-empty array`);
    return errors;
  }
  let hasSplat = false;
  appearance.representations.forEach((representation, index) => {
    const representationLabel = `${objectLabel}.appearance.representations[${index}]`;
    if (!isRecord(representation)) {
      errors.push(`${representationLabel} must be an object`);
      return;
    }
    errors.push(
      ...validateAllowedFields(
        representation,
        WORLD_OBJECT_APPEARANCE_REPRESENTATION_FIELDS,
        representationLabel
      )
    );
    errors.push(...validateNonEmptyString(representation.id, `${representationLabel}.id`));
    if (!isOneOf(representation.kind, WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS)) {
      errors.push(
        `${representationLabel}.kind must be one of: ${WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS.join(", ")}`
      );
    }
    if (representation.kind === "mesh" || representation.kind === "splat") {
      errors.push(
        ...validatePortableWorldAssetRef(
          representation.asset_ref,
          `${representationLabel}.asset_ref`
        )
      );
    } else if (representation.asset_ref !== undefined) {
      errors.push(
        ...validatePortableWorldAssetRef(
          representation.asset_ref,
          `${representationLabel}.asset_ref`
        )
      );
    }
    if (representation.scale_xyz !== undefined) {
      errors.push(
        ...validateFiniteVector(representation.scale_xyz, `${representationLabel}.scale_xyz`, {
          requirePositive: true,
        })
      );
    }
    errors.push(...validateOptionalString(representation.semantic_role, `${representationLabel}.semantic_role`));
    hasSplat = hasSplat || representation.kind === "splat";
  });
  if (hasSplat && !hasPhysicsCollisionGeometry(value)) {
    errors.push(`${objectLabel}.appearance splat representations require physics.collision_geometry`);
  }
  return errors;
};

const validateWorldObjectPhysicsCollisionGeometry = (
  value: unknown,
  fieldLabel: string
): string[] => {
  if (!isRecord(value)) return [`${fieldLabel} must be an object`];
  const errors: string[] = [];
  errors.push(...validateAllowedFields(value, WORLD_OBJECT_PHYSICS_GEOMETRY_FIELDS, fieldLabel));
  if (value.id !== undefined) {
    errors.push(...validateNonEmptyString(value.id, `${fieldLabel}.id`));
  }
  if (!isOneOf(value.kind, WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS)) {
    errors.push(`${fieldLabel}.kind must be one of: ${WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS.join(", ")}`);
    return errors;
  }
  if (value.kind === "box") {
    errors.push(...validateFiniteVector(value.size_xyz, `${fieldLabel}.size_xyz`, { requirePositive: true }));
  }
  if (value.kind === "sphere") {
    errors.push(...validatePositiveNumber(value.radius, `${fieldLabel}.radius`));
  }
  if (value.kind === "cylinder") {
    errors.push(...validatePositiveNumber(value.radius, `${fieldLabel}.radius`));
    errors.push(...validatePositiveNumber(value.length, `${fieldLabel}.length`));
  }
  if (value.kind === "mesh") {
    errors.push(...validatePortableWorldAssetRef(value.asset_ref, `${fieldLabel}.asset_ref`));
  } else if (value.asset_ref !== undefined) {
    errors.push(...validatePortableWorldAssetRef(value.asset_ref, `${fieldLabel}.asset_ref`));
  }
  if (value.scale_xyz !== undefined) {
    errors.push(...validateFiniteVector(value.scale_xyz, `${fieldLabel}.scale_xyz`, { requirePositive: true }));
  }
  return errors;
};

const validateWorldObjectPhysicsInertia = (value: unknown, fieldLabel: string): string[] => {
  if (!isRecord(value)) return [`${fieldLabel} must be an object`];
  const errors: string[] = [];
  errors.push(...validateAllowedFields(value, WORLD_OBJECT_INERTIA_FIELDS, fieldLabel));
  for (const fieldName of ["ixx", "iyy", "izz"] as const) {
    if (!isFiniteWorldSceneNumber(value[fieldName])) {
      errors.push(`${fieldLabel}.${fieldName} must be a finite number >= 0`);
    } else if (value[fieldName] < 0) {
      errors.push(`${fieldLabel}.${fieldName} must be >= 0`);
    }
  }
  for (const fieldName of ["ixy", "ixz", "iyz"] as const) {
    errors.push(...validateOptionalFiniteNumber(value[fieldName], `${fieldLabel}.${fieldName}`));
  }
  return errors;
};

const validateWorldObjectPhysics = (value: unknown, objectLabel: string): string[] => {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${objectLabel}.physics must be an object`];
  const errors: string[] = [];
  errors.push(...validateAllowedFields(value, WORLD_OBJECT_PHYSICS_FIELDS, `${objectLabel}.physics`));
  errors.push(...validateOptionalBoolean(value.fixed, `${objectLabel}.physics.fixed`));
  errors.push(...validateOptionalBoolean(value.collision, `${objectLabel}.physics.collision`));
  errors.push(...validateOptionalFiniteNumber(value.mass_kg, `${objectLabel}.physics.mass_kg`, { minimum: 0 }));
  errors.push(
    ...validateOptionalFiniteNumber(value.friction, `${objectLabel}.physics.friction`, {
      minimum: 0.01,
      maximum: 5,
    })
  );
  errors.push(
    ...validateOptionalFiniteNumber(value.restitution, `${objectLabel}.physics.restitution`, {
      minimum: 0,
      maximum: 1,
    })
  );
  errors.push(...validateOptionalString(value.semantic_role, `${objectLabel}.physics.semantic_role`));
  if (value.collision_geometry !== undefined) {
    errors.push(
      ...validateWorldObjectPhysicsCollisionGeometry(
        value.collision_geometry,
        `${objectLabel}.physics.collision_geometry`
      )
    );
  }
  if (value.inertia !== undefined) {
    errors.push(...validateWorldObjectPhysicsInertia(value.inertia, `${objectLabel}.physics.inertia`));
  }
  return errors;
};

const validateWorldObjectConsistency = (value: unknown, objectLabel: string): string[] => {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${objectLabel}.consistency must be an object`];
  const errors: string[] = [];
  errors.push(...validateAllowedFields(value, WORLD_OBJECT_CONSISTENCY_FIELDS, `${objectLabel}.consistency`));
  for (const fieldName of ["appearance_ref", "physics_ref", "method"] as const) {
    errors.push(...validateNonEmptyString(value[fieldName], `${objectLabel}.consistency.${fieldName}`));
  }
  if (!isOneOf(value.status, WORLD_OBJECT_CONSISTENCY_STATUSES)) {
    errors.push(`${objectLabel}.consistency.status must be one of: ${WORLD_OBJECT_CONSISTENCY_STATUSES.join(", ")}`);
  }
  if (value.metrics !== undefined && !isRecord(value.metrics)) {
    errors.push(`${objectLabel}.consistency.metrics must be an object`);
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
    !isOneOf(value.source, WORLD_OBJECT_SOURCES)
  ) {
    errors.push(
      `${objectLabel}.source must be one of: ${WORLD_OBJECT_SOURCES.join(", ")}`
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
  errors.push(...validateWorldObjectAppearance(value, objectLabel));
  errors.push(...validateWorldObjectPhysics(value.physics, objectLabel));
  errors.push(...validateWorldObjectConsistency(value.consistency, objectLabel));

  const ikTargetType = value.ik_target_type ?? "punctual";
  if (!isOneOf(ikTargetType, WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES)) {
    errors.push(
      `${objectLabel}.ik_target_type must be one of: ${WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES.join(", ")}`
    );
    return errors;
  }

  if (ikTargetType === "orbit") {
    if (!isFiniteWorldSceneNumber(value.orbit_radius) || value.orbit_radius <= 0) {
      errors.push(`${objectLabel}.orbit_radius must be a finite number > 0`);
    }
    if (!isFiniteWorldSceneNumber(value.orbit_inclination_deg)) {
      errors.push(`${objectLabel}.orbit_inclination_deg must be a finite number`);
    }
    if (!isFiniteWorldSceneNumber(value.orbit_phase_deg)) {
      errors.push(`${objectLabel}.orbit_phase_deg must be a finite number`);
    }
    if (!isFiniteWorldSceneNumber(value.orbit_secondary_offset_deg)) {
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

export const validateSerializableWorldObjects = (objects: unknown[]): string[] =>
  objects.flatMap((object, index) => validateSerializableWorldObject(object, index));
