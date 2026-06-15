import type { CreatedObject } from "@/features/objects";
import {
  normalizeWorldObjectRotationEuler,
  resolveWorldObjectGeometry,
} from "@/features/objects/worldObjectGeometry";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";
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

const stableStringifyValue = (value: unknown): string | undefined => {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot canonicalize a non-finite world scene package number.");
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyValue(item) ?? "null").join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const sortedKeys = Object.keys(objectValue).sort();
  const fields = sortedKeys.flatMap((key) => {
    const serializedValue = stableStringifyValue(objectValue[key]);
    return serializedValue === undefined ? [] : `${JSON.stringify(key)}:${serializedValue}`;
  });
  return `{${fields.join(",")}}`;
};

export const stableStringify = (value: unknown): string => {
  const serialized = stableStringifyValue(value);
  if (serialized === undefined) {
    throw new Error("Cannot canonicalize an undefined world scene package value.");
  }
  return serialized;
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

export const computeWorldSnapshotDigest = (
  snapshot: WorldScenePackageManifest["world_snapshot"]
): Promise<string> => digestSha256(stableStringify(snapshot));

const normalizeSnapshotNumber = (value: unknown, fieldLabel: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldLabel} must be a finite number.`);
  }
  return value;
};

const normalizeSnapshotInteger = (value: unknown, fieldLabel: string): number => {
  const normalized = normalizeSnapshotNumber(value, fieldLabel);
  if (!Number.isInteger(normalized)) {
    throw new Error(`${fieldLabel} must be an integer millisecond value.`);
  }
  return normalized;
};

const cloneVector3 = (
  value: readonly [number, number, number],
  fieldLabel: string
): [number, number, number] => [
  normalizeSnapshotNumber(value[0], `${fieldLabel}[0]`),
  normalizeSnapshotNumber(value[1], `${fieldLabel}[1]`),
  normalizeSnapshotNumber(value[2], `${fieldLabel}[2]`),
];

const cloneJointPositions = (jointPositions: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(jointPositions).map(([jointName, position]) => [
      jointName,
      normalizeSnapshotNumber(position, `joint_positions.${jointName}`),
    ])
  );

const cloneCamera = (camera: Camera): Camera => {
  const intrinsics = { ...camera.intrinsics };
  if (camera.intrinsics.distortion) {
    intrinsics.distortion = { ...camera.intrinsics.distortion };
  }
  return {
    id: camera.id,
    name: camera.name,
    parent_joint: camera.parent_joint,
    pose: {
      xyz: cloneVector3(camera.pose.xyz, `cameras.${camera.id}.pose.xyz`),
      rpy: cloneVector3(camera.pose.rpy, `cameras.${camera.id}.pose.rpy`),
    },
    intrinsics,
  };
};

const cloneSnapshotValue = (value: unknown, fieldLabel: string): unknown => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return normalizeSnapshotNumber(value, fieldLabel);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneSnapshotValue(item, `${fieldLabel}[${index}]`));
  }
  if (typeof value === "object") {
    const cloned: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const clonedValue = cloneSnapshotValue(item, `${fieldLabel}.${key}`);
      if (clonedValue !== undefined) {
        cloned[key] = clonedValue;
      }
    });
    return cloned;
  }
  throw new Error(`${fieldLabel} must be JSON-compatible.`);
};

const cloneWorldSnapshot = (
  snapshot: WorldScenePackageManifest["world_snapshot"]
): WorldScenePackageManifest["world_snapshot"] => ({
  urdf_xml: snapshot.urdf_xml,
  joint_positions: cloneJointPositions(snapshot.joint_positions),
  cameras: snapshot.cameras.map(cloneCamera),
  objects: snapshot.objects.map(
    (object, index) => cloneSnapshotValue(object, `objects[${index}]`) as SerializableWorldObject
  ),
  scenario_time_ms: normalizeSnapshotInteger(
    snapshot.scenario_time_ms,
    "scenario_time_ms"
  ),
  scenario_duration_ms: normalizeSnapshotInteger(
    snapshot.scenario_duration_ms,
    "scenario_duration_ms"
  ),
});

const worldSnapshotArtifactRef = (digest: string): WorldArtifactRef => ({
  kind: "world_snapshot",
  digest_sha256: digest,
  uri: WORLD_SCENE_PACKAGE_URI_SCHEME,
});

const toSerializableAssetScale = (
  assetScale: CreatedObject["assetScale"] | undefined
): [number, number, number] | undefined => {
  if (!assetScale) return undefined;
  const scale: [number, number, number] = [
    normalizeSnapshotNumber(assetScale.x, "asset_scale_xyz[0]"),
    normalizeSnapshotNumber(assetScale.y, "asset_scale_xyz[1]"),
    normalizeSnapshotNumber(assetScale.z, "asset_scale_xyz[2]"),
  ];
  scale.forEach((component, index) => {
    if (component <= 0) {
      throw new Error(`asset_scale_xyz[${index}] must be > 0.`);
    }
  });
  return scale;
};

export const refreshWorldScenePackageSnapshotDigest = async (
  manifest: WorldScenePackageManifest
): Promise<WorldScenePackageManifest> => {
  const worldSnapshot = cloneWorldSnapshot(manifest.world_snapshot);
  const snapshotDigest = await computeWorldSnapshotDigest(worldSnapshot);
  return {
    ...manifest,
    runtime_targets: manifest.runtime_targets.map((target) => ({ ...target })),
    interface: {
      ...manifest.interface,
      observation_modalities: [...manifest.interface.observation_modalities],
    },
    artifacts: [
      ...manifest.artifacts
        .filter((artifact) => artifact.kind !== "world_snapshot")
        .map((artifact) => ({ ...artifact })),
      worldSnapshotArtifactRef(snapshotDigest),
    ],
    world_snapshot: worldSnapshot,
    provenance: { ...manifest.provenance },
    security: {
      signature_ref: manifest.security.signature_ref,
      attestation_refs: [...manifest.security.attestation_refs],
      sbom_ref: manifest.security.sbom_ref,
    },
  };
};

export const toSerializableWorldObject = (object: CreatedObject): SerializableWorldObject => {
  const ikTargetType = object.ikTargetType === "orbit" ? "orbit" : "punctual";
  const geometry = resolveWorldObjectGeometry(object);
  const size: [number, number, number] =
    object.type === "point"
      ? [
          WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM,
          WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM,
          WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM,
        ]
      : [geometry.size.x, geometry.size.y, geometry.size.z];
  const serializable: SerializableWorldObject = {
    id: object.id,
    name: object.id,
    type: object.assetRef ? "mesh" : object.type,
    position_xyz: [geometry.position.x, geometry.position.y, geometry.position.z],
    size_xyz: size,
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
  if (object.assetRef) {
    serializable.asset_ref = object.assetRef;
    const assetScale = toSerializableAssetScale(object.assetScale);
    if (assetScale) {
      serializable.asset_scale_xyz = assetScale;
    }
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
    joint_positions: cloneJointPositions(jointPositions),
    cameras: cameras.map(cloneCamera),
    objects: serializeWorldSceneObjects(objects),
    scenario_time_ms: normalizeSnapshotInteger(scenarioTimeMs, "scenario_time_ms"),
    scenario_duration_ms: normalizeSnapshotInteger(
      scenarioDurationMs,
      "scenario_duration_ms"
    ),
  };

  const snapshotDigest = await computeWorldSnapshotDigest(snapshot);
  const artifactRefs: WorldArtifactRef[] = [worldSnapshotArtifactRef(snapshotDigest)];

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
