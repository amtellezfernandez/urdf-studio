import type { Camera } from "@/shared/types/camera";

export type WorldRuntimeTargetMode = "native" | "python" | "container";

export type WorldRuntimeTarget = {
  name: string;
  mode: WorldRuntimeTargetMode;
  min_version?: string;
};

export type WorldInterfaceSpec = {
  observation_modalities: string[];
  action_semantics: string;
  timestep_ms: number;
  frame_convention: string;
};

export type WorldArtifactRef = {
  kind: string;
  digest_sha256: string;
  uri: string;
};

export type WorldSecuritySpec = {
  signature_ref: string | null;
  attestation_refs: string[];
  sbom_ref: string | null;
};

export type SerializableWorldObject = {
  id: string;
  name: string;
  type: "cube" | "point" | "sphere" | "cylinder";
  position_xyz: [number, number, number];
  rotation_rpy_rad?: [number, number, number];
  size_xyz: [number, number, number];
  color: string;
  is_hidden?: boolean;
  source?:
    | "user"
    | "world-scenario"
    | "demo-world"
    | "runtime-detection"
    | "runtime-demo"
    | "runtime-restricted-area"
    | "runtime-trajectory";
  tracked_joint_name?: string | null;
  is_ik_target?: boolean;
  ik_target_type?: "punctual" | "orbit";
  orbit_radius?: number;
  orbit_inclination_deg?: number;
  orbit_phase_deg?: number;
  orbit_secondary_offset_deg?: number;
  orbit_target_point?: "center" | "primary" | "secondary";
};

export type WorldSnapshot = {
  urdf_xml: string;
  joint_positions: Record<string, number>;
  cameras: Camera[];
  objects: SerializableWorldObject[];
  scenario_time_ms: number;
  scenario_duration_ms: number;
};

export type WorldScenePackageManifest = {
  schema_version: string;
  package_id: string;
  version: string;
  title: string;
  description?: string;
  created_at: string;
  runtime_targets: WorldRuntimeTarget[];
  interface: WorldInterfaceSpec;
  artifacts: WorldArtifactRef[];
  world_snapshot: WorldSnapshot;
  provenance: Record<string, unknown>;
  security: WorldSecuritySpec;
};

export type WorldScenePackageValidationResponse = {
  valid: boolean;
  digest_sha256: string;
  warnings: string[];
  errors: string[];
};

export type WorldScenePackagePublishResponse = {
  package_id: string;
  version: string;
  digest_sha256: string;
  created: boolean;
};

export type WorldScenePackageListEntry = {
  package_id: string;
  latest_version: string;
  latest_digest_sha256: string;
  updated_at: string;
  title: string;
  description?: string;
  owner?: string;
  tags: string[];
  preview_image_url?: string;
  source_registry?: string;
  trust_level: "metadata_only" | "signed_metadata" | "metadata_complete";
  runtime_targets: string[];
};

export type WorldScenePackageVersionRecord = {
  package_id: string;
  version: string;
  digest_sha256: string;
  published_at: string;
  manifest: WorldScenePackageManifest;
};

export type WorldRegistryBackendStatus = {
  backend_id: string;
  label: string;
  status: "available" | "unavailable";
  reason?: string | null;
};

export type WorldRegistryCapabilitiesResponse = {
  source: string;
  available: boolean;
  unavailable_backends: WorldRegistryBackendStatus[];
  can_list: boolean;
  can_get_version: boolean;
  can_publish: boolean;
};
