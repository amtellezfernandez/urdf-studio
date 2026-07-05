import { WORLD_OBJECT_SOURCE_IDS } from "@/shared/types/worldObject";

export const WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1 = "1.0.0" as const;
export const WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1_1 = "1.1.0" as const;
export const WORLD_SCENE_PACKAGE_SCHEMA_VERSION = WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1;
export const WORLD_SCENE_PACKAGE_SUPPORTED_SCHEMA_VERSIONS = [
  WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
  WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1_1,
] as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_VERSION = "0.1.0" as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION = "ros-rep-103" as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS = "joint_position_rad" as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE = WORLD_OBJECT_SOURCE_IDS.demo;
export const WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS = 33 as const;
export const WORLD_SCENE_PACKAGE_MIN_SCENARIO_TIME_MS = 0 as const;
export const WORLD_SCENE_PACKAGE_MIN_SCENARIO_DURATION_MS = 0 as const;
export const WORLD_SCENE_PACKAGE_MAX_SCENARIO_DURATION_MS = 600_000 as const;
export const WORLD_SCENE_PACKAGE_LIMITS = {
  maxRuntimeTargets: 16,
  maxInterfaceModalities: 32,
  maxArtifactRefs: 128,
  maxCamerasPerWorld: 64,
  maxObjectsPerWorld: 256,
  maxJointsPerWorld: 512,
  maxWorldSnapshotUrdfChars: 500_000,
} as const;
export const WORLD_SCENE_PACKAGE_PATTERNS = {
  digestSha256Hex: /^[a-fA-F0-9]{64}$/,
} as const;
export const STATIC_WORLD_LAYOUT_KIND = "static" as const;
export const STATIC_WORLD_LAYOUT_SCENARIO_TIME_MS = 0 as const;
export const STATIC_WORLD_LAYOUT_SCENARIO_DURATION_MS = 0 as const;
export const STATIC_WORLD_LAYOUT_NON_STATIC_UNSUPPORTED_ERROR =
  "Non-static world layouts are not supported yet. scenario_time_ms and scenario_duration_ms must both be 0." as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_RADIUS = 0.3 as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_INCLINATION_DEG = 45 as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_PHASE_DEG = 0 as const;
export const WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_SECONDARY_OFFSET_DEG = 180 as const;
export const WORLD_SCENE_PACKAGE_FALLBACK_TITLE = "URDF Studio World Package" as const;
export const WORLD_SCENE_PACKAGE_DIGEST_ALGORITHM = "SHA-256" as const;
export const WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE = "crypto_unavailable" as const;
export const WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_MESSAGE =
  "Secure hashing unavailable in this environment. World package digest_sha256 cannot be generated." as const;

export const WORLD_SCENE_PACKAGE_DOWNLOAD_FILENAME_SUFFIX = ".world-package.json" as const;
export const WORLD_SCENE_LAYER_DOWNLOAD_FILENAME_SUFFIX = ".world-layout.json" as const;
export const WORLD_SCENE_PACKAGE_URI_SCHEME = "inline://snapshot" as const;

export const WORLD_SCENE_PACKAGE_RUNTIME_TARGETS = [
  { name: "worldd", mode: "native", min_version: "0.1.0" },
  { name: "backend", mode: "python", min_version: "0.1.0" },
] as const;
