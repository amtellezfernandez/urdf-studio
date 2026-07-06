import type { CreatedObject } from "@/features/objects";
import {
  normalizeWorldObjectRotationEuler,
  resolveWorldObjectGeometry,
} from "@/features/objects/worldObjectGeometry";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";
import {
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_INCLINATION_DEG,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_PHASE_DEG,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_RADIUS,
  WORLD_SCENE_PACKAGE_DEFAULT_ORBIT_SECONDARY_OFFSET_DEG,
} from "@/features/world-share/worldScenePackageParams";
import { cloneJsonSerializableValue } from "@/shared/lib/jsonSerializableClone";
import type { SerializableWorldObject } from "@/features/world-share/worldScenePackageTypes";
import { assertFiniteWorldSceneNumber } from "@/features/world-share/worldSceneNumber";

const isAbsoluteOrRootedUrl = (value: string): boolean =>
  value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value);

const toSerializableAssetScale = (
  assetScale: CreatedObject["assetScale"] | undefined
): [number, number, number] | undefined => {
  if (!assetScale) return undefined;
  const scale: [number, number, number] = [
    assertFiniteWorldSceneNumber(assetScale.x, "asset_scale_xyz[0]"),
    assertFiniteWorldSceneNumber(assetScale.y, "asset_scale_xyz[1]"),
    assertFiniteWorldSceneNumber(assetScale.z, "asset_scale_xyz[2]"),
  ];
  scale.forEach((component, index) => {
    if (component <= 0) {
      throw new Error(`asset_scale_xyz[${index}] must be > 0.`);
    }
  });
  return scale;
};

const cloneWorldObjectMetadata = (
  metadata: CreatedObject["worldMetadata"]
): CreatedObject["worldMetadata"] => {
  if (!metadata) return undefined;
  return cloneJsonSerializableValue(metadata);
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
    ...(cloneWorldObjectMetadata(object.worldMetadata) ?? {}),
    id: object.id,
    name: object.id,
    type: object.type,
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
  if (object.meshUri && !isAbsoluteOrRootedUrl(object.meshUri)) {
    serializable.mesh = { ...serializable.mesh, uri: object.meshUri };
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
