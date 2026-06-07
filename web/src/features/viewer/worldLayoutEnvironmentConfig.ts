import {
  getInitialWorldLayoutElementPlacements,
  mapSimuGenYUpPositionToStudioXyFloor,
  type WorldLayoutElementAsset,
  type WorldLayoutElementPlacement,
} from "@/features/viewer/worldLayoutElementRuntime";

export type WorldLayoutSplatConfig = {
  uri: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export type WorldLayoutElementConfig = {
  asset: WorldLayoutElementAsset;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  materialColor?: string;
};

const SIMU_GEN_Y_UP_TO_STUDIO_XY_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readVector3 = (
  value: unknown,
  fallback: [number, number, number]
): [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((component) => typeof component === "number" && Number.isFinite(component))
    ? [value[0], value[1], value[2]]
    : fallback;

const readFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const readPositiveNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const readNonEmptyString = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const readScaleVector = (value: unknown, scalarValue: unknown): [number, number, number] => {
  const vector = readVector3(value, [Number.NaN, Number.NaN, Number.NaN]);
  if (vector.every((component) => Number.isFinite(component) && component > 0)) {
    return vector;
  }
  const scalar = readFiniteNumber(scalarValue, 1);
  return scalar > 0 ? [scalar, scalar, scalar] : [1, 1, 1];
};

export const readWorldLayoutSplatConfig = (
  environment: Record<string, unknown> | null
): WorldLayoutSplatConfig | null => {
  if (!environment) return null;
  const visual = isRecord(environment.visual) ? environment.visual : null;
  if (!visual || visual.kind !== "splat" || typeof visual.uri !== "string") return null;
  const uri = visual.uri.trim();
  if (!uri) return null;
  return {
    uri,
    position: readVector3(visual.position_xyz, [0, 0, 0]),
    rotation: readVector3(visual.rotation_rpy_rad, [0, 0, 0]),
    scale: readFiniteNumber(visual.scale, 1),
  };
};

export const readWorldLayoutElementConfigs = (
  environment: Record<string, unknown> | null
): WorldLayoutElementConfig[] => {
  if (!environment || !Array.isArray(environment.elements)) return [];
  const sourceWorldSlug = readNonEmptyString(environment.preset, "world-layout");
  const entries = environment.elements.filter(isRecord);
  const validEntries = entries.flatMap((entry, index) => {
    const uri = readNonEmptyString(entry.uri);
    if (!uri) return [];
    const id = readNonEmptyString(entry.id, `world-layout-element-${index}`);
    const realWorldHeightM = readPositiveNumber(entry.real_world_height_m);
    const realWorldFootprintM = readPositiveNumber(entry.real_world_footprint_m);
    const realWorldMassKg = readPositiveNumber(entry.real_world_mass_kg);
    const metadataUrl = readNonEmptyString(entry.metadata);
    const asset: WorldLayoutElementAsset = {
      id,
      assetId: id,
      sourceWorldSlug,
      baseObjectId: id,
      name: readNonEmptyString(entry.name, id),
      url: uri,
      ...(metadataUrl ? { metadataUrl } : {}),
      ...(realWorldHeightM !== null ? { realWorldHeightM } : {}),
      ...(realWorldFootprintM !== null ? { realWorldFootprintM } : {}),
      ...(realWorldMassKg !== null ? { realWorldMassKg } : {}),
    };
    return [{ asset, entry }];
  });
  const placements = getInitialWorldLayoutElementPlacements(
    validEntries.map(({ asset }) => asset)
  );
  const placementByObjectId = new Map<string, WorldLayoutElementPlacement>(
    placements.map((placement) => [placement.objectId, placement])
  );

  return validEntries.flatMap(({ asset, entry }) => {
    const placement = placementByObjectId.get(asset.id);
    if (!placement) return [];
    const explicitPosition = Array.isArray(entry.position_xyz)
      ? readVector3(entry.position_xyz, [0, 0, 0])
      : null;
    const explicitRotation = Array.isArray(entry.rotation_rpy_rad)
      ? readVector3(entry.rotation_rpy_rad, [0, 0, 0])
      : null;
    return [{
      asset,
      position: explicitPosition ?? mapSimuGenYUpPositionToStudioXyFloor(placement.position),
      rotation: explicitRotation ?? SIMU_GEN_Y_UP_TO_STUDIO_XY_ROTATION,
      scale:
        entry.scale_xyz !== undefined || entry.scale !== undefined
          ? readScaleVector(entry.scale_xyz, entry.scale)
          : placement.scale,
      ...(readNonEmptyString(entry.material_color ?? entry.color)
        ? { materialColor: readNonEmptyString(entry.material_color ?? entry.color) }
        : {}),
    }];
  });
};
