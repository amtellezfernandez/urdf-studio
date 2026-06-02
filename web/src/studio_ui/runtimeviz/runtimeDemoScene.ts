import * as THREE from "three";

import type { CreatedObject } from "@/features/objects";
import {
  RUNTIME_DEMO_OBJECT_SIZE_METERS,
  RUNTIME_DEMO_TRAJECTORY_POINT_COUNT,
  RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS,
} from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";

export type RuntimeDemoObjectSnapshot = {
  object_id: string;
  class_label: string;
  cluster_id: string;
  position_xyz: [number, number, number];
  size_xyz: [number, number, number];
  color_hex: string;
  observation_count: number;
  best_confidence: number;
  last_seen_at: string;
};

export type RuntimeDemoRestrictedAreaId =
  | "loading_zone"
  | "inspection_pad"
  | "charging_bay";

const DEMO_OBJECT_ELEVATION_METERS = RUNTIME_DEMO_OBJECT_SIZE_METERS * 0.5;
const DEMO_TRAJECTORY_ELEVATION_METERS = RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS * 0.5;
const RESTRICTED_AREA_HEIGHT_METERS = 0.025;
const RUNTIME_DEMO_TRAJECTORY_COLOR_HEX = "#2563eb";

export const RUNTIME_DEMO_RESTRICTED_AREAS: ReadonlyArray<{
  id: RuntimeDemoRestrictedAreaId;
  label: string;
  position_xyz: readonly [number, number, number];
  size_xyz: readonly [number, number, number];
  color_hex: string;
}> = [
  {
    id: "loading_zone",
    label: "loading_zone",
    position_xyz: [1.55, 0.1, RESTRICTED_AREA_HEIGHT_METERS * 0.5],
    size_xyz: [0.9, 0.7, RESTRICTED_AREA_HEIGHT_METERS],
    color_hex: "#ef4444",
  },
  {
    id: "inspection_pad",
    label: "inspection_pad",
    position_xyz: [0.95, 0.95, RESTRICTED_AREA_HEIGHT_METERS * 0.5],
    size_xyz: [0.7, 0.55, RESTRICTED_AREA_HEIGHT_METERS],
    color_hex: "#f97316",
  },
  {
    id: "charging_bay",
    label: "charging_bay",
    position_xyz: [2.15, -0.85, RESTRICTED_AREA_HEIGHT_METERS * 0.5],
    size_xyz: [0.65, 0.6, RESTRICTED_AREA_HEIGHT_METERS],
    color_hex: "#dc2626",
  },
] as const;

export const RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS: readonly RuntimeDemoRestrictedAreaId[] =
  RUNTIME_DEMO_RESTRICTED_AREAS.map((area) => area.id);

export const findRuntimeDemoRestrictedArea = (
  value: string
): (typeof RUNTIME_DEMO_RESTRICTED_AREAS)[number] | null => {
  const normalized = value.trim().toLowerCase();
  return (
    RUNTIME_DEMO_RESTRICTED_AREAS.find(
      (area) => area.id === normalized || area.label.toLowerCase() === normalized
    ) ?? null
  );
};

export const getRuntimeDemoRestrictedRegions = (
  areaIds: readonly RuntimeDemoRestrictedAreaId[]
) =>
  areaIds
    .map((areaId) => RUNTIME_DEMO_RESTRICTED_AREAS.find((area) => area.id === areaId) ?? null)
    .filter((area): area is (typeof RUNTIME_DEMO_RESTRICTED_AREAS)[number] => area !== null)
    .map((area) => ({
      xmin: area.position_xyz[0] - area.size_xyz[0] * 0.5,
      xmax: area.position_xyz[0] + area.size_xyz[0] * 0.5,
      ymin: area.position_xyz[1] - area.size_xyz[1] * 0.5,
      ymax: area.position_xyz[1] + area.size_xyz[1] * 0.5,
    }));

export const RUNTIME_DEMO_OBJECTS: readonly RuntimeDemoObjectSnapshot[] = [
  {
    object_id: "demo-red-bull",
    class_label: "red_bull_can",
    cluster_id: "red_bull_can#1",
    position_xyz: [1.0, -0.9, DEMO_OBJECT_ELEVATION_METERS],
    size_xyz: [
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
    ],
    color_hex: "#ef4444",
    observation_count: 6,
    best_confidence: 0.93,
    last_seen_at: "demo",
  },
  {
    object_id: "demo-mug",
    class_label: "mug",
    cluster_id: "mug#1",
    position_xyz: [1.9, 0.15, DEMO_OBJECT_ELEVATION_METERS],
    size_xyz: [
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
    ],
    color_hex: "#3b82f6",
    observation_count: 4,
    best_confidence: 0.89,
    last_seen_at: "demo",
  },
  {
    object_id: "demo-bowl",
    class_label: "bowl",
    cluster_id: "bowl#1",
    position_xyz: [1.3, 1.0, DEMO_OBJECT_ELEVATION_METERS],
    size_xyz: [
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
      RUNTIME_DEMO_OBJECT_SIZE_METERS,
    ],
    color_hex: "#22c55e",
    observation_count: 5,
    best_confidence: 0.87,
    last_seen_at: "demo",
  },
] as const;

const normalizeDemoObjectLabel = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "_");

export const findRuntimeDemoObject = (label: string): RuntimeDemoObjectSnapshot | null => {
  const normalizedLabel = normalizeDemoObjectLabel(label);
  return (
    RUNTIME_DEMO_OBJECTS.find(
      (object) =>
        normalizeDemoObjectLabel(object.class_label) === normalizedLabel ||
        normalizeDemoObjectLabel(object.object_id) === normalizedLabel ||
        normalizeDemoObjectLabel(object.cluster_id) === normalizedLabel
    ) ?? null
  );
};

export const buildRuntimeDemoObjects = (): Omit<CreatedObject, "id">[] =>
  RUNTIME_DEMO_OBJECTS.map((object) => ({
    label: object.class_label,
    type: "cube",
    position: new THREE.Vector3(...object.position_xyz),
    size: new THREE.Vector3(...object.size_xyz),
    color: object.color_hex,
    trackedJointName: null,
    source: "runtime-demo",
    isIkTarget: false,
  }));

export const buildRuntimeDemoRestrictedAreaObjects = (
  areaIds: readonly RuntimeDemoRestrictedAreaId[]
): Omit<CreatedObject, "id">[] =>
  areaIds
    .map((areaId) => RUNTIME_DEMO_RESTRICTED_AREAS.find((area) => area.id === areaId) ?? null)
    .filter((area): area is (typeof RUNTIME_DEMO_RESTRICTED_AREAS)[number] => area !== null)
    .map((area) => ({
      type: "cube" as const,
      position: new THREE.Vector3(...area.position_xyz),
      size: new THREE.Vector3(...area.size_xyz),
      color: area.color_hex,
      label: area.label,
      trackedJointName: null,
      source: "runtime-restricted-area" as const,
      isIkTarget: false,
    }));

export const buildRuntimeDemoTrajectoryObjects = (
  selection?: { fromLabel: string | null; toLabel: string | null }
): Omit<CreatedObject, "id">[] => {
  const toLabel = selection?.toLabel?.trim() ?? "";
  if (toLabel.length === 0) {
    return [];
  }

  const targetObject = findRuntimeDemoObject(toLabel);
  if (!targetObject) {
    return [];
  }

  const startObject =
    selection?.fromLabel && selection.fromLabel.trim().length > 0
      ? findRuntimeDemoObject(selection.fromLabel)
      : null;
  const startPosition: [number, number, number] = startObject?.position_xyz ?? [0, 0, 0];
  const endPosition: [number, number, number] = [
    targetObject.position_xyz[0],
    targetObject.position_xyz[1],
    DEMO_TRAJECTORY_ELEVATION_METERS,
  ];

  return Array.from(
    { length: RUNTIME_DEMO_TRAJECTORY_POINT_COUNT },
    (_, index): Omit<CreatedObject, "id"> => {
      const pointProgress =
        RUNTIME_DEMO_TRAJECTORY_POINT_COUNT <= 1
          ? 1
          : index / (RUNTIME_DEMO_TRAJECTORY_POINT_COUNT - 1);
      const x = THREE.MathUtils.lerp(startPosition[0], endPosition[0], pointProgress);
      const y = THREE.MathUtils.lerp(startPosition[1], endPosition[1], pointProgress);
      return {
        label: `trajectory_${index + 1}`,
        type: "point",
        position: new THREE.Vector3(x, y, DEMO_TRAJECTORY_ELEVATION_METERS),
        size: new THREE.Vector3(
          RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS,
          RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS,
          RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS
        ),
        color: RUNTIME_DEMO_TRAJECTORY_COLOR_HEX,
        trackedJointName: null,
        source: "runtime-trajectory",
        isIkTarget: false,
      };
    }
  );
};
