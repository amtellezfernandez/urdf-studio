import { Vector3 } from "three";
import { resolveWorldObjectGeometry, type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import {
  WORLD_ROLLOUT_JOB_MAX_POLLS,
  WORLD_ROLLOUT_JOB_POLL_INTERVAL_MS,
} from "@/features/world-share/worldRolloutParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";
import type { WorldRolloutCheckerProfile } from "@/features/world-share/worldRolloutTypes";
import {
  buildWorldRolloutConfigFromDraft,
  fetchWorldRolloutJob,
} from "@/app/pages/index/worldSceneRuntime";

export function downloadJsonDocument(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadTextDocument(payload: string, filename: string, mimeType: string) {
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

export function toImportedObjectParams(
  object: WorldScenePackageManifest["world_snapshot"]["objects"][number]
): Omit<CreatedObject, "id"> {
  const ikTargetType: NonNullable<CreatedObject["ikTargetType"]> =
    object.ik_target_type === "orbit" ? "orbit" : "punctual";
  const editableObjectType = object.type === "mesh" ? "cube" : object.type;
  const geometry = resolveWorldObjectGeometry({
    type: editableObjectType,
    position: { x: object.position_xyz[0], y: object.position_xyz[1], z: object.position_xyz[2] },
    size: { x: object.size_xyz[0], y: object.size_xyz[1], z: object.size_xyz[2] },
  });
  const importedObject: Omit<CreatedObject, "id"> = {
    type: editableObjectType,
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
    assetRef: object.asset_ref,
    assetScale: object.asset_scale_xyz
      ? new Vector3(
          object.asset_scale_xyz[0],
          object.asset_scale_xyz[1],
          object.asset_scale_xyz[2]
        )
      : undefined,
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
