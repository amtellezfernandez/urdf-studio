import type { WorldScenarioEvent } from "./scenarioTimeline";
import { WORLD_OBJECT_SOURCE_IDS, type WorldObjectSource } from "@/shared/types/worldObject";

export type WorldScenarioObjectSeed = {
  key: string;
  type: "cube" | "point";
  color: string;
  size: [number, number, number];
  radiusScale: number;
  angleDeg: number;
  zOffset: number;
};

export const WORLD_SCENARIO_DEFAULT_SEED = 101;
const WORLD_SCENARIO_SIGNAL_A_POINT_SIZE_M = 0.09;
const WORLD_SCENARIO_SIGNAL_B_POINT_SIZE_M = 0.1;
const WORLD_SCENARIO_BEACON_POINT_SIZE_M = 0.11;
const toUniformPointSize = (sizeM: number): [number, number, number] => [sizeM, sizeM, sizeM];

export const WORLD_SCENARIO_LAYOUT_PARAMS = {
  keepOut: {
    minPlanarDistance: 0.55,
    baseSizeScale: 1.1,
    extraPadding: 0.08,
    extraRadiusPadding: 0.05,
  },
  radiusScale: {
    min: 0.45,
  },
  jitter: {
    angleDeg: 9,
    radiusScale: 0.16,
    z: 0.015,
  },
  floor: {
    minCenterClearance: 0.002,
  },
  pedestal: {
    minSize: {
      x: 0.34,
      y: 0.26,
    },
    sizeScale: {
      x: 0.55,
      y: 0.42,
    },
    height: 0.1,
    targetLift: 0.12,
  },
} as const;

export const WORLD_SCENARIO_OBJECT_SEEDS: ReadonlyArray<WorldScenarioObjectSeed> = [
  {
    key: "cube-front-right",
    type: "cube",
    color: "#f97316",
    size: [0.14, 0.14, 0.14],
    radiusScale: 0.85,
    angleDeg: 30,
    zOffset: 0.07,
  },
  {
    key: "cube-front-left",
    type: "cube",
    color: "#38bdf8",
    size: [0.13, 0.13, 0.13],
    radiusScale: 0.78,
    angleDeg: -75,
    zOffset: 0.06,
  },
  {
    key: "lane-barrier",
    type: "cube",
    color: "#64748b",
    size: [0.08, 0.34, 0.28],
    radiusScale: 1.05,
    angleDeg: 135,
    zOffset: 0.12,
  },
  {
    key: "cube-rear-left",
    type: "cube",
    color: "#22c55e",
    size: [0.1, 0.1, 0.1],
    radiusScale: 1.35,
    angleDeg: -145,
    zOffset: 0.05,
  },
  {
    key: "column-rear",
    type: "cube",
    color: "#eab308",
    size: [0.12, 0.12, 0.28],
    radiusScale: 1.65,
    angleDeg: 165,
    zOffset: 0.14,
  },
  {
    key: "signal-a",
    type: "point",
    color: "#fde047",
    size: toUniformPointSize(WORLD_SCENARIO_SIGNAL_A_POINT_SIZE_M),
    radiusScale: 0.72,
    angleDeg: 105,
    zOffset: 0.13,
  },
  {
    key: "signal-b",
    type: "point",
    color: "#fb7185",
    size: toUniformPointSize(WORLD_SCENARIO_SIGNAL_B_POINT_SIZE_M),
    radiusScale: 1.9,
    angleDeg: -110,
    zOffset: 0.18,
  },
  {
    key: "crate-mid-right",
    type: "cube",
    color: "#a855f7",
    size: [0.16, 0.12, 0.12],
    radiusScale: 1.15,
    angleDeg: 58,
    zOffset: 0.08,
  },
  {
    key: "crate-mid-left",
    type: "cube",
    color: "#14b8a6",
    size: [0.15, 0.15, 0.11],
    radiusScale: 0.92,
    angleDeg: -35,
    zOffset: 0.07,
  },
  {
    key: "tower-far-right",
    type: "cube",
    color: "#f43f5e",
    size: [0.12, 0.12, 0.38],
    radiusScale: 2.05,
    angleDeg: 12,
    zOffset: 0.2,
  },
  {
    key: "slab-far-left",
    type: "cube",
    color: "#0ea5e9",
    size: [0.26, 0.1, 0.08],
    radiusScale: 1.82,
    angleDeg: -170,
    zOffset: 0.06,
  },
  {
    key: "beacon-near-left",
    type: "point",
    color: "#fbbf24",
    size: toUniformPointSize(WORLD_SCENARIO_BEACON_POINT_SIZE_M),
    radiusScale: 0.65,
    angleDeg: -5,
    zOffset: 0.12,
  },
];

export const WORLD_SCENARIO_DURATION_MS = 12000;

export const WORLD_SCENARIO_NUMERIC_TOLERANCES = {
  minPlanarVectorLength: 1e-8,
  assertionMargin: 1e-6,
  pairwiseSpacingMargin: 0.03,
} as const;

export const WORLD_SCENARIO_EVENTS: ReadonlyArray<WorldScenarioEvent> = [
  { id: "target-scan", label: "Target scan sweep", startMs: 0, endMs: 5000 },
  { id: "lane-shift", label: "Lane barrier shift", startMs: 2500, endMs: 9000 },
  { id: "rear-probe", label: "Rear obstacle probe", startMs: 8500, endMs: 12000 },
];

export const WORLD_SCENARIO_MOTION = {
  targetScan: {
    targetAmplitude: { x: 0.06, y: 0.045 },
    signalAAmplitude: { x: 0.035, y: 0.03 },
    signalBAmplitude: { x: 0.03, y: 0.025 },
  },
  laneShift: {
    barrierSwingY: 0.11,
  },
  rearProbe: {
    rearCubeApproachX: 0.1,
  },
} as const;

export const WORLD_SCENARIO_SOURCES = {
  current: WORLD_OBJECT_SOURCE_IDS.scenario,
  demoWorld: WORLD_OBJECT_SOURCE_IDS.demo,
} as const satisfies Record<string, WorldObjectSource>;
