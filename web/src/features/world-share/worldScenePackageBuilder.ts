import type { CreatedObject } from "@/features/objects";
import {
  normalizeWorldObjectRotationEuler,
  resolveWorldObjectGeometry,
} from "@/features/objects/worldObjectGeometry";
import type { Camera } from "@/shared/types/camera";
import {
  WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE,
  WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_MESSAGE,
  WORLD_SCENE_PACKAGE_DIGEST_ALGORITHM,
  WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS,
  WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_INCLINATION_DEG,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_PHASE_DEG,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_RADIUS,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_SECONDARY_OFFSET_DEG,
  WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS,
  WORLD_SCENE_PACKAGE_FALLBACK_TITLE,
  WORLD_SCENE_LAYER_DOWNLOAD_FILENAME_SUFFIX,
  WORLD_SCENE_PACKAGE_RUNTIME_TARGETS,
  WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
  WORLD_SCENE_PACKAGE_DOWNLOAD_FILENAME_SUFFIX,
  WORLD_SCENE_PACKAGE_URI_SCHEME,
} from "@/features/world-share/worldScenePackageParams";
import type {
  SerializableWorldObject,
  WorldArtifactRef,
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";

type BuildWorldScenePackageManifestParams = {
  packageId: string;
  version: string;
  title?: string;
  description?: string;
  urdfXml: string;
  jointPositions: Record<string, number>;
  cameras: Camera[];
  objects: CreatedObject[];
  scenarioTimeMs: number;
  scenarioDurationMs: number;
  runtimeTargets?: WorldScenePackageManifest["runtime_targets"];
  provenance?: Record<string, unknown>;
};

export class WorldScenePackageBuildError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorldScenePackageBuildError";
    this.code = code;
  }
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const sortedKeys = Object.keys(objectValue).sort();
  return `{${sortedKeys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(",")}}`;
};

const digestSha256 = async (content: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new WorldScenePackageBuildError(
      WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE,
      WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_MESSAGE
    );
  }
  const encoded = new TextEncoder().encode(content);
  const digest = await subtle.digest(WORLD_SCENE_PACKAGE_DIGEST_ALGORITHM, encoded);
  return toHex(new Uint8Array(digest));
};

export const toSerializableWorldObject = (object: CreatedObject): SerializableWorldObject => {
  const ikTargetType = object.ikTargetType === "orbit" ? "orbit" : "punctual";
  const geometry = resolveWorldObjectGeometry(object);
  const serializable: SerializableWorldObject = {
    id: object.id,
    name: object.id,
    type: object.type,
    position_xyz: [geometry.position.x, geometry.position.y, geometry.position.z],
    size_xyz: [geometry.size.x, geometry.size.y, geometry.size.z],
    color: object.color,
    source: object.source ?? "user",
    tracked_joint_name: object.trackedJointName,
    is_ik_target: object.isIkTarget,
    ik_target_type: ikTargetType,
  };
  if (object.type !== "point") {
    const rotation = normalizeWorldObjectRotationEuler(object.rotation);
    serializable.rotation_rpy_rad = [
      rotation.x,
      rotation.y,
      rotation.z,
    ];
  }
  if (object.isHidden === true) {
    serializable.is_hidden = true;
  }
  if (ikTargetType === "orbit") {
    serializable.orbit_radius = object.orbitRadius ?? WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_RADIUS;
    serializable.orbit_inclination_deg =
      object.orbitInclination ?? WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_INCLINATION_DEG;
    serializable.orbit_phase_deg = object.orbitPhase ?? WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_PHASE_DEG;
    serializable.orbit_secondary_offset_deg =
      object.orbitSecondaryOffset ?? WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_SECONDARY_OFFSET_DEG;
    serializable.orbit_target_point = object.orbitTargetPoint ?? "primary";
  }
  return serializable;
};

export const serializeWorldSceneObjects = (
  objects: readonly CreatedObject[]
): SerializableWorldObject[] => objects.map(toSerializableWorldObject);

const sanitizePackageId = (packageId: string): string =>
  packageId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const buildWorldScenePackageManifest = async ({
  packageId,
  version,
  title,
  description,
  urdfXml,
  jointPositions,
  cameras,
  objects,
  scenarioTimeMs,
  scenarioDurationMs,
  runtimeTargets,
  provenance,
}: BuildWorldScenePackageManifestParams): Promise<WorldScenePackageManifest> => {
  if (!urdfXml.trim()) {
    throw new Error("Cannot package world without URDF content.");
  }

  const normalizedPackageId = sanitizePackageId(packageId);
  if (!normalizedPackageId) {
    throw new Error("Package ID is empty after sanitization.");
  }

  const snapshot = {
    urdf_xml: urdfXml,
    joint_positions: jointPositions,
    cameras,
    objects: serializeWorldSceneObjects(objects),
    scenario_time_ms: scenarioTimeMs,
    scenario_duration_ms: scenarioDurationMs,
  };

  const snapshotDigest = await digestSha256(stableStringify(snapshot));
  const artifactRefs: WorldArtifactRef[] = [
    {
      kind: "world_snapshot",
      digest_sha256: snapshotDigest,
      uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
    },
  ];

  const observationModalities = cameras.length > 0 ? ["rgb", "proprio"] : ["proprio"];

  return {
    schema_version: WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
    package_id: normalizedPackageId,
    version,
    title: title?.trim() || WORLD_SCENE_PACKAGE_FALLBACK_TITLE,
    description: description?.trim() || undefined,
    created_at: new Date().toISOString(),
    runtime_targets: runtimeTargets ? [...runtimeTargets] : [...WORLD_SCENE_PACKAGE_RUNTIME_TARGETS],
    interface: {
      observation_modalities: observationModalities,
      action_semantics: WORLD_SCENE_PACKAGE_DEFAULT_ACTION_SEMANTICS,
      timestep_ms: WORLD_SCENE_PACKAGE_DEFAULT_TIMESTEP_MS,
      frame_convention: WORLD_SCENE_PACKAGE_DEFAULT_FRAME_CONVENTION,
    },
    artifacts: artifactRefs,
    world_snapshot: snapshot,
    provenance: provenance ?? {},
    security: {
      signature_ref: null,
      attestation_refs: [],
      sbom_ref: null,
    },
  };
};

export const toWorldScenePackageDownloadName = (packageId: string, version: string) =>
  `${sanitizePackageId(packageId)}-${version}${WORLD_SCENE_PACKAGE_DOWNLOAD_FILENAME_SUFFIX}`;

export const toWorldSceneLayerDownloadName = (packageId: string, version: string) =>
  `${sanitizePackageId(packageId)}-${version}${WORLD_SCENE_LAYER_DOWNLOAD_FILENAME_SUFFIX}`;
