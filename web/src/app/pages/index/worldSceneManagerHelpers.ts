import { Vector3 } from "three";
import type { Camera } from "@/shared/types/camera";
import { resolveWorldObjectGeometry, type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import {
  WORLD_ROLLOUT_JOB_MAX_POLLS,
  WORLD_ROLLOUT_JOB_POLL_INTERVAL_MS,
} from "@/features/world-share/worldRolloutParams";
import type {
  SerializableWorldObject,
  SerializableWorldObjectAppearanceRepresentation,
  WorldSceneDocument,
} from "@/features/world-share/worldScenePackageTypes";
import type { WorldSceneLayerSnapshot } from "@/features/world-share/worldSceneManifest";
import type { WorldRolloutCheckerProfile } from "@/features/world-share/worldRolloutTypes";
import {
  buildWorldRolloutConfigFromDraft,
  fetchWorldRolloutJob,
} from "@/app/pages/index/worldSceneRuntime";
import { getFilenameFromPath } from "@/shared/lib/pathNames";
import { cloneJsonSerializableValue } from "@/shared/lib/jsonSerializableClone";

export const SPLAT_BACKGROUND_IMPORT_ACCEPT = ".spz,.splat,.ksplat";

// World Labs / SimuGen splats are y-up; the studio scene is z-up (ROS REP-103).
const Y_UP_SPLAT_TO_STUDIO_ROTATION_RPY_RAD = [-Math.PI / 2, 0, 0] as const;

// Exports reference assets by portable relative name (the manifest validator
// rejects rooted paths and URI schemes), so the imported file's name must be
// normalized into that shape.
export const toPortableSplatAssetName = (filename: string): string => {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const sanitized = basename.trim().replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "");
  return sanitized || "splat-background.spz";
};

// A world layout's `name` is arbitrary document text; it feeds a File name that in turn
// is matched against path-normalizing mesh resolution, so it must be a safe filename stem.
export const sanitizeWorldLayoutFilenameStem = (name: string | undefined | null): string => {
  const sanitized = (name ?? "").trim().replace(/[^\w.\- ]+/g, "_");
  return sanitized || "world-layout";
};

export function buildImportedSplatBackgroundObject(file: File): Omit<CreatedObject, "id"> {
  const assetName = toPortableSplatAssetName(file.name);
  return {
    label: assetName,
    type: "splat",
    position: new Vector3(0, 0, 0),
    rotation: normalizeWorldObjectRotationEuler({
      x: Y_UP_SPLAT_TO_STUDIO_ROTATION_RPY_RAD[0],
      y: Y_UP_SPLAT_TO_STUDIO_ROTATION_RPY_RAD[1],
      z: Y_UP_SPLAT_TO_STUDIO_ROTATION_RPY_RAD[2],
    }),
    size: new Vector3(1, 1, 1),
    color: "#94a3b8",
    assetRef: assetName,
    assetScale: new Vector3(1, 1, 1),
    meshUri: URL.createObjectURL(file),
    source: "user",
    trackedJointName: null,
    isIkTarget: false,
    ikTargetType: "punctual",
  };
}

function downloadBlobDocument(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJsonDocument(payload: unknown, filename: string) {
  downloadBlobDocument(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    filename
  );
}

export function downloadTextDocument(payload: string, filename: string, mimeType: string) {
  downloadBlobDocument(new Blob([payload], { type: mimeType }), filename);
}

export function openFileSelectionDialog({
  accept,
  directory = false,
  multiple = false,
  onFiles,
}: {
  accept: string;
  directory?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = directory || multiple;
  input.accept = accept;
  if (directory) {
    input.setAttribute("webkitdirectory", "");
  }
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    void onFiles(files);
  };
  input.click();
}

export function readWorldRolloutConfigDraft(defaultCheckerProfile: WorldRolloutCheckerProfile) {
  const defaultDraft = JSON.stringify(
    {
      checker_profile: defaultCheckerProfile,
      rollout_params: {},
      runner_params: {},
    },
    null,
    2
  );
  const raw = window.prompt("World rollout config JSON", defaultDraft);
  if (raw === null) return null;
  return buildWorldRolloutConfigFromDraft(JSON.parse(raw) as unknown, defaultCheckerProfile);
}

export async function waitForWorldRolloutJob(jobId: string) {
  let latest = await fetchWorldRolloutJob(jobId);
  for (let pollIndex = 0; pollIndex < WORLD_ROLLOUT_JOB_MAX_POLLS; pollIndex += 1) {
    if (latest.status === "completed" || latest.status === "failed") return latest;
    await new Promise((resolve) => setTimeout(resolve, WORLD_ROLLOUT_JOB_POLL_INTERVAL_MS));
    latest = await fetchWorldRolloutJob(jobId);
  }
  return latest;
}

export type MeshUriResolutionContext = {
  baseUrl?: string;
  assetMap?: Readonly<Record<string, string>>;
};

const resolveMeshUriFromAssetMap = (
  meshUri: string,
  assetMap: Readonly<Record<string, string>>
): string | undefined => {
  const normalized = meshUri.replace(/^\/+/, "");
  const candidates = [meshUri, normalized, `/${normalized}`];
  for (const candidate of candidates) {
    if (assetMap[candidate]) return assetMap[candidate];
  }
  const basename = getFilenameFromPath(normalized, "");
  return basename ? assetMap[basename] : undefined;
};

const resolveMeshUri = (
  meshUri: string | undefined,
  context: MeshUriResolutionContext = {}
): string | undefined => {
  if (!meshUri) return undefined;
  if (context.assetMap) {
    const resolved = resolveMeshUriFromAssetMap(meshUri, context.assetMap);
    if (resolved) return resolved;
  }
  const { baseUrl } = context;
  if (!baseUrl) return meshUri;
  try {
    const documentUrl =
      typeof globalThis.location?.href === "string"
        ? globalThis.location.href
        : "http://localhost/";
    const absoluteBaseUrl = new URL(baseUrl, documentUrl).toString();
    return new URL(meshUri, absoluteBaseUrl).toString();
  } catch {
    return meshUri;
  }
};

const toImportedWorldMetadata = (
  object: SerializableWorldObject
): CreatedObject["worldMetadata"] => {
  const worldMetadata: CreatedObject["worldMetadata"] = {};
  if (object.appearance !== undefined) {
    worldMetadata.appearance = cloneJsonSerializableValue(object.appearance);
  }
  if (object.consistency !== undefined) {
    worldMetadata.consistency = cloneJsonSerializableValue(object.consistency);
  }
  if (object.mesh !== undefined) {
    worldMetadata.mesh = cloneJsonSerializableValue(object.mesh);
  }
  if (object.physics !== undefined) {
    worldMetadata.physics = cloneJsonSerializableValue(object.physics);
  }
  if (object.simulation !== undefined) {
    worldMetadata.simulation = cloneJsonSerializableValue(object.simulation);
  }
  return Object.keys(worldMetadata).length > 0 ? worldMetadata : undefined;
};

const readPreferredAssetRepresentation = (
  object: SerializableWorldObject
): SerializableWorldObjectAppearanceRepresentation | undefined => {
  const representations = object.appearance?.representations ?? [];
  return (
    representations.find((representation) => representation.kind === "splat") ??
    representations.find((representation) => representation.kind === "mesh")
  );
};

const readObjectAssetRef = (
  object: SerializableWorldObject,
  representation?: SerializableWorldObjectAppearanceRepresentation
): string | undefined =>
  object.asset_ref ??
  object.mesh?.asset_ref ??
  object.mesh?.path ??
  object.mesh?.filename ??
  representation?.asset_ref ??
  object.mesh?.uri;

const readObjectAssetUri = (
  object: SerializableWorldObject,
  representation?: SerializableWorldObjectAppearanceRepresentation
): string | undefined =>
  object.mesh?.uri ??
  object.mesh?.asset_ref ??
  object.mesh?.path ??
  object.mesh?.filename ??
  object.asset_ref ??
  representation?.asset_ref;

const readObjectAssetScale = (
  object: SerializableWorldObject,
  representation?: SerializableWorldObjectAppearanceRepresentation
): Vector3 | undefined => {
  const scale =
    object.asset_scale_xyz ??
    object.mesh_scale_xyz ??
    object.scale_xyz ??
    object.mesh?.scale_xyz ??
    (typeof object.mesh?.scale === "number"
      ? ([object.mesh.scale, object.mesh.scale, object.mesh.scale] as const)
      : object.mesh?.scale) ??
    representation?.scale_xyz;
  return scale ? new Vector3(scale[0], scale[1], scale[2]) : undefined;
};

function toImportedObjectParams(
  object: SerializableWorldObject,
  meshUriContext: MeshUriResolutionContext = {}
): Omit<CreatedObject, "id"> {
  const assetRepresentation = readPreferredAssetRepresentation(object);
  const importedObjectType: CreatedObject["type"] =
    object.type === "mesh" && assetRepresentation?.kind === "splat"
      ? "splat"
      : object.type;
  const ikTargetType: NonNullable<CreatedObject["ikTargetType"]> =
    object.ik_target_type === "orbit" ? "orbit" : "punctual";
  const geometry = resolveWorldObjectGeometry({
    type: importedObjectType,
    position: { x: object.position_xyz[0], y: object.position_xyz[1], z: object.position_xyz[2] },
    size: { x: object.size_xyz[0], y: object.size_xyz[1], z: object.size_xyz[2] },
  });
  const importedObject: Omit<CreatedObject, "id"> = {
    type: importedObjectType,
    position: geometry.position,
    rotation: normalizeWorldObjectRotationEuler(
      object.rotation_rpy_rad
        ? {
            x: object.rotation_rpy_rad[0],
            y: object.rotation_rpy_rad[1],
            z: object.rotation_rpy_rad[2],
          }
        : null
    ),
    size: geometry.size,
    color: object.color,
    assetRef: readObjectAssetRef(object, assetRepresentation),
    assetScale: readObjectAssetScale(object, assetRepresentation),
    meshUri: resolveMeshUri(readObjectAssetUri(object, assetRepresentation), meshUriContext),
    isHidden: object.is_hidden === true,
    source: object.source ?? "user",
    worldMetadata: toImportedWorldMetadata(object),
    trackedJointName: object.tracked_joint_name ?? null,
    isIkTarget: object.is_ik_target !== false,
    ikTargetType,
  };
  if (ikTargetType === "orbit") {
    importedObject.orbitRadius = object.orbit_radius;
    importedObject.orbitInclination = object.orbit_inclination_deg;
    importedObject.orbitPhase = object.orbit_phase_deg;
    importedObject.orbitSecondaryOffset = object.orbit_secondary_offset_deg;
    importedObject.orbitTargetPoint = object.orbit_target_point;
  }
  return importedObject;
}

export function toImportedCreatedObjects(
  sceneObjects: SerializableWorldObject[],
  meshUriContext: MeshUriResolutionContext = {}
): CreatedObject[] {
  return sceneObjects.map((sceneObject) => ({
    id: sceneObject.id,
    ...toImportedObjectParams(sceneObject, meshUriContext),
  }));
}

export function toImportedWorldSceneCameras(
  cameras: NonNullable<WorldSceneDocument["cameras"]>
): Array<Omit<Camera, "id">> {
  return cameras.map((camera) => ({
    name: camera.name,
    parent_joint: camera.parent_joint,
    pose: camera.pose,
    intrinsics: camera.intrinsics,
  }));
}

export function applyWorldSceneLayerObjectSourceOverride(
  worldLayout: WorldSceneLayerSnapshot,
  sourceOverride?: NonNullable<CreatedObject["source"]>
): WorldSceneLayerSnapshot {
  return {
    ...worldLayout,
    objects: worldLayout.objects.map((sceneObject) => ({
      ...sceneObject,
      source: sourceOverride ?? sceneObject.source,
    })),
  };
}
