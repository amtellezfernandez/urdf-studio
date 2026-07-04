import { Vector3 } from "three";
import type { Camera } from "@/shared/types/camera";
import { resolveWorldObjectGeometry, type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import {
  WORLD_ROLLOUT_JOB_MAX_POLLS,
  WORLD_ROLLOUT_JOB_POLL_INTERVAL_MS,
} from "@/features/world-share/worldRolloutParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";
import type { WorldSceneLayerSnapshot } from "@/features/world-share/worldSceneManifest";
import type { WorldRolloutCheckerProfile } from "@/features/world-share/worldRolloutTypes";
import {
  buildWorldRolloutConfigFromDraft,
  fetchWorldRolloutJob,
} from "@/app/pages/index/worldSceneRuntime";

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
  multiple = false,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = multiple;
  input.accept = accept;
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
  const basename = normalized.split("/").pop();
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

function toImportedObjectParams(
  object: WorldScenePackageManifest["world_snapshot"]["objects"][number],
  meshUriContext: MeshUriResolutionContext = {}
): Omit<CreatedObject, "id"> {
  const ikTargetType: NonNullable<CreatedObject["ikTargetType"]> =
    object.ik_target_type === "orbit" ? "orbit" : "punctual";
  const geometry = resolveWorldObjectGeometry({
    type: object.type,
    position: { x: object.position_xyz[0], y: object.position_xyz[1], z: object.position_xyz[2] },
    size: { x: object.size_xyz[0], y: object.size_xyz[1], z: object.size_xyz[2] },
  });
  const importedObject: Omit<CreatedObject, "id"> = {
    type: object.type,
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
    assetRef: object.asset_ref ?? object.mesh?.asset_ref,
    assetScale: object.asset_scale_xyz
      ? new Vector3(
          object.asset_scale_xyz[0],
          object.asset_scale_xyz[1],
          object.asset_scale_xyz[2]
        )
      : undefined,
    meshUri: resolveMeshUri(object.mesh?.uri, meshUriContext),
    isHidden: object.is_hidden === true,
    source: object.source ?? "user",
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
  sceneObjects: WorldScenePackageManifest["world_snapshot"]["objects"],
  meshUriContext: MeshUriResolutionContext = {}
): CreatedObject[] {
  return sceneObjects.map((sceneObject) => ({
    id: sceneObject.id,
    ...toImportedObjectParams(sceneObject, meshUriContext),
  }));
}

export function toImportedWorldSceneCameras(
  cameras: WorldScenePackageManifest["world_snapshot"]["cameras"]
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
