export const WORLD_LAYOUT_SUPPORTED_OBJECT_TYPES = [
  "cube",
  "point",
  "sphere",
  "cylinder",
  "mesh",
] as const;
export const WORLD_LAYOUT_SUPPORTED_ORBIT_TARGET_POINTS = [
  "center",
  "primary",
  "secondary",
] as const;
export const WORLD_LAYOUT_SUPPORTED_IK_TARGET_TYPES = ["punctual", "orbit"] as const;

export const WORLD_CAMERA_FIELDS = ["id", "name", "parent_joint", "pose", "intrinsics"] as const;
export const WORLD_CAMERA_POSE_FIELDS = ["xyz", "rpy"] as const;
export const WORLD_CAMERA_INTRINSIC_FIELDS = [
  "width",
  "height",
  "fov_deg",
  "fx",
  "fy",
  "cx",
  "cy",
  "distortion",
] as const;

export const WORLD_SCENE_PACKAGE_FIELDS = [
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
export const WORLD_SNAPSHOT_FIELDS = [
  "urdf_xml",
  "joint_positions",
  "cameras",
  "objects",
  "scenario_time_ms",
  "scenario_duration_ms",
] as const;
export const WORLD_RUNTIME_TARGET_FIELDS = ["name", "mode", "min_version"] as const;
export const WORLD_RUNTIME_TARGET_MODES = ["native", "python", "container"] as const;
export const WORLD_ARTIFACT_FIELDS = ["kind", "digest_sha256", "uri"] as const;
export const WORLD_SECURITY_FIELDS = ["signature_ref", "attestation_refs", "sbom_ref"] as const;

export const WORLD_OBJECT_SIMULATION_FIELDS = [
  "fixed",
  "collision",
  "mass_kg",
  "friction",
  "restitution",
  "semantic_role",
] as const;
export const WORLD_OBJECT_MESH_FIELDS = [
  "asset_ref",
  "path",
  "uri",
  "filename",
  "scale",
  "scale_xyz",
] as const;
export const WORLD_OBJECT_APPEARANCE_FIELDS = ["representations"] as const;
export const WORLD_OBJECT_APPEARANCE_REPRESENTATION_FIELDS = [
  "id",
  "kind",
  "asset_ref",
  "scale_xyz",
  "semantic_role",
] as const;
export const WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS = [
  "mesh",
  "primitive",
  "splat",
] as const;
export const WORLD_OBJECT_PHYSICS_FIELDS = [
  "fixed",
  "collision",
  "mass_kg",
  "friction",
  "restitution",
  "semantic_role",
  "collision_geometry",
  "inertia",
] as const;
export const WORLD_OBJECT_PHYSICS_GEOMETRY_FIELDS = [
  "id",
  "kind",
  "asset_ref",
  "size_xyz",
  "radius",
  "length",
  "scale_xyz",
] as const;
export const WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS = [
  "box",
  "sphere",
  "cylinder",
  "mesh",
] as const;
export const WORLD_OBJECT_INERTIA_FIELDS = ["ixx", "iyy", "izz", "ixy", "ixz", "iyz"] as const;
export const WORLD_OBJECT_CONSISTENCY_FIELDS = [
  "appearance_ref",
  "physics_ref",
  "method",
  "metrics",
  "status",
] as const;
export const WORLD_OBJECT_CONSISTENCY_STATUSES = [
  "valid",
  "warning",
  "missing",
  "unchecked",
] as const;
