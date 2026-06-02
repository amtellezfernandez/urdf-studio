import * as THREE from "three";
import type { CreatedObject } from "@/features/objects";
import {
  createWorldScenarioClock,
  normalizeScenarioTime,
  type WorldScenarioClock,
  type WorldScenarioEvent,
} from "./scenarioTimeline";
import {
  WORLD_SCENARIO_DEFAULT_SEED,
  WORLD_SCENARIO_LAYOUT_PARAMS,
  WORLD_SCENARIO_OBJECT_SEEDS,
  WORLD_SCENARIO_DURATION_MS,
  WORLD_SCENARIO_EVENTS,
  WORLD_SCENARIO_MOTION,
  WORLD_SCENARIO_NUMERIC_TOLERANCES,
  type WorldScenarioObjectSeed,
} from "./worldScenarioParams";

export type WorldScenarioBuildParams = {
  baseCenter: THREE.Vector3;
  baseSize: THREE.Vector3;
  baseZ: number;
  ringRadius: number;
  forwardOffset: number;
  seed?: number;
};

export type WorldScenarioObjectSpec = Omit<CreatedObject, "id">;

export type WorldScenarioLayout = {
  targetPosition: THREE.Vector3;
  objects: WorldScenarioObjectSpec[];
};

export type WorldScenarioSnapshot = {
  targetPosition: THREE.Vector3;
  objects: WorldScenarioObjectSpec[];
  objectKeys: string[];
  activeEventIds: string[];
};

export type WorldScenarioTimeline = {
  durationMs: number;
  events: WorldScenarioEvent[];
  sampleAt: (clockMs: number) => WorldScenarioSnapshot;
  createClock: (params?: { loop?: boolean; initialTimeMs?: number }) => WorldScenarioClock;
};

const createDeterministicRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const jitter = (rng: () => number, magnitude: number) => (rng() * 2 - 1) * magnitude;

const ensureMinPlanarDistance = (
  position: THREE.Vector3,
  center: THREE.Vector3,
  minDistance: number
) => {
  const delta = new THREE.Vector2(position.x - center.x, position.y - center.y);
  const len = delta.length();
  if (len >= minDistance || len < WORLD_SCENARIO_NUMERIC_TOLERANCES.minPlanarVectorLength) {
    return position;
  }
  const scale = minDistance / len;
  return new THREE.Vector3(center.x + delta.x * scale, center.y + delta.y * scale, position.z);
};

const cloneObjectSpec = (spec: WorldScenarioObjectSpec): WorldScenarioObjectSpec => ({
  ...spec,
  position: spec.position.clone(),
  size: spec.size.clone(),
});

const activationProgress = (timeMs: number, startMs: number, endMs: number) => {
  if (timeMs < startMs || timeMs > endMs) return null;
  const span = Math.max(1, endMs - startMs);
  return (timeMs - startMs) / span;
};

const buildPolarObject = (
  seed: WorldScenarioObjectSeed,
  params: WorldScenarioBuildParams,
  minPlanarDistance: number,
  rng: () => number
): WorldScenarioObjectSpec => {
  const size = new THREE.Vector3(...seed.size);
  const angle =
    ((seed.angleDeg + jitter(rng, WORLD_SCENARIO_LAYOUT_PARAMS.jitter.angleDeg)) * Math.PI) / 180;
  const radius = Math.max(
    minPlanarDistance + WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.extraRadiusPadding,
    params.ringRadius *
      Math.max(
        WORLD_SCENARIO_LAYOUT_PARAMS.radiusScale.min,
        seed.radiusScale + jitter(rng, WORLD_SCENARIO_LAYOUT_PARAMS.jitter.radiusScale)
      )
  );
  const desiredZ = params.baseZ + seed.zOffset + jitter(rng, WORLD_SCENARIO_LAYOUT_PARAMS.jitter.z);
  const minCenterZ =
    params.baseZ + size.z * 0.5 + WORLD_SCENARIO_LAYOUT_PARAMS.floor.minCenterClearance;
  const position = new THREE.Vector3(
    params.baseCenter.x + radius * Math.cos(angle),
    params.baseCenter.y + radius * Math.sin(angle),
    Math.max(minCenterZ, desiredZ)
  );

  return {
    type: seed.type,
    position: ensureMinPlanarDistance(position, params.baseCenter, minPlanarDistance),
    size,
    color: seed.color,
    source: "world-scenario",
    trackedJointName: null,
    isIkTarget: false,
  };
};

const buildStaticWorldScenario = (params: WorldScenarioBuildParams) => {
  const rng = createDeterministicRng(params.seed ?? WORLD_SCENARIO_DEFAULT_SEED);
  const minPlanarDistance = Math.max(
    WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.minPlanarDistance,
    Math.max(params.baseSize.x, params.baseSize.y) * WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.baseSizeScale +
      WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.extraPadding
  );

  const pedestalSize = new THREE.Vector3(
    Math.max(
      WORLD_SCENARIO_LAYOUT_PARAMS.pedestal.minSize.x,
      params.baseSize.x * WORLD_SCENARIO_LAYOUT_PARAMS.pedestal.sizeScale.x
    ),
    Math.max(
      WORLD_SCENARIO_LAYOUT_PARAMS.pedestal.minSize.y,
      params.baseSize.y * WORLD_SCENARIO_LAYOUT_PARAMS.pedestal.sizeScale.y
    ),
    WORLD_SCENARIO_LAYOUT_PARAMS.pedestal.height
  );
  const pedestalPosition = ensureMinPlanarDistance(
    new THREE.Vector3(
      params.baseCenter.x + params.forwardOffset,
      params.baseCenter.y,
      params.baseZ + pedestalSize.z / 2
    ),
    params.baseCenter,
    minPlanarDistance
  );
  const targetPosition = pedestalPosition
    .clone()
    .add(new THREE.Vector3(0, 0, WORLD_SCENARIO_LAYOUT_PARAMS.pedestal.targetLift));

  const objects: Array<{ key: string; spec: WorldScenarioObjectSpec }> = [
    {
      key: "pedestal",
      spec: {
        type: "cube",
        position: pedestalPosition,
        size: pedestalSize,
        color: "#1f2937",
        source: "world-scenario",
        trackedJointName: null,
        isIkTarget: false,
      },
    },
  ];

  for (const seed of WORLD_SCENARIO_OBJECT_SEEDS) {
    objects.push({
      key: seed.key,
      spec: buildPolarObject(seed, params, minPlanarDistance, rng),
    });
  }

  return {
    baseTargetPosition: targetPosition,
    objects,
  };
};

export const buildWorldScenarioTimeline = (
  params: WorldScenarioBuildParams
): WorldScenarioTimeline => {
  const staticWorld = buildStaticWorldScenario(params);

  const events: WorldScenarioEvent[] = [...WORLD_SCENARIO_EVENTS];
  const eventById = new Map(events.map((event) => [event.id, event]));

  const durationMs = Math.max(
    WORLD_SCENARIO_DURATION_MS,
    events[events.length - 1]?.endMs ?? 0
  );
  const baseKeyOrder = staticWorld.objects.map((obj) => obj.key);
  const baseIndexByKey = new Map(baseKeyOrder.map((key, idx) => [key, idx]));

  const sampleAt = (clockMs: number): WorldScenarioSnapshot => {
    const scenarioTime = normalizeScenarioTime(clockMs, durationMs);
    const objects = staticWorld.objects.map((obj) => cloneObjectSpec(obj.spec));
    const targetPosition = staticWorld.baseTargetPosition.clone();
    const activeEventIds: string[] = [];
    const objectByKey = (key: string) => {
      const idx = baseIndexByKey.get(key);
      if (idx === undefined) return null;
      return objects[idx] ?? null;
    };

    const targetScan = eventById.get("target-scan");
    const scanProgress =
      targetScan !== undefined
        ? activationProgress(scenarioTime, targetScan.startMs, targetScan.endMs)
        : null;
    if (scanProgress !== null) {
      activeEventIds.push("target-scan");
      const theta = scanProgress * Math.PI * 2;
      targetPosition.x +=
        Math.cos(theta) * WORLD_SCENARIO_MOTION.targetScan.targetAmplitude.x;
      targetPosition.y +=
        Math.sin(theta) * WORLD_SCENARIO_MOTION.targetScan.targetAmplitude.y;

      const signalA = objectByKey("signal-a");
      if (signalA) {
        signalA.position.x +=
          Math.cos(theta) * WORLD_SCENARIO_MOTION.targetScan.signalAAmplitude.x;
        signalA.position.y +=
          Math.sin(theta) * WORLD_SCENARIO_MOTION.targetScan.signalAAmplitude.y;
      }
      const signalB = objectByKey("signal-b");
      if (signalB) {
        signalB.position.x +=
          Math.cos(theta + Math.PI) * WORLD_SCENARIO_MOTION.targetScan.signalBAmplitude.x;
        signalB.position.y +=
          Math.sin(theta + Math.PI) * WORLD_SCENARIO_MOTION.targetScan.signalBAmplitude.y;
      }
    }

    const laneShift = eventById.get("lane-shift");
    const laneProgress =
      laneShift !== undefined
        ? activationProgress(scenarioTime, laneShift.startMs, laneShift.endMs)
        : null;
    if (laneProgress !== null) {
      activeEventIds.push("lane-shift");
      const laneBarrier = objectByKey("lane-barrier");
      if (laneBarrier) {
        const swing =
          Math.sin(laneProgress * Math.PI * 2) *
          WORLD_SCENARIO_MOTION.laneShift.barrierSwingY;
        laneBarrier.position.y += swing;
      }
    }

    const rearProbe = eventById.get("rear-probe");
    const rearProbeProgress =
      rearProbe !== undefined
        ? activationProgress(scenarioTime, rearProbe.startMs, rearProbe.endMs)
        : null;
    if (rearProbeProgress !== null) {
      activeEventIds.push("rear-probe");
      const rearCube = objectByKey("cube-rear-left");
      if (rearCube) {
        const approach =
          Math.sin(rearProbeProgress * Math.PI) *
          WORLD_SCENARIO_MOTION.rearProbe.rearCubeApproachX;
        rearCube.position.x -= approach;
      }
    }

    return {
      targetPosition,
      objects,
      objectKeys: [...baseKeyOrder],
      activeEventIds,
    };
  };

  return {
    durationMs,
    events,
    sampleAt,
    createClock: ({ loop = true, initialTimeMs = 0 } = {}) =>
      createWorldScenarioClock({
        durationMs,
        loop,
        initialTimeMs,
      }),
  };
};

export const buildWorldScenarioLayout = (params: WorldScenarioBuildParams): WorldScenarioLayout => {
  const scenario = buildWorldScenarioTimeline(params);
  const snapshot = scenario.sampleAt(0);
  return {
    targetPosition: snapshot.targetPosition,
    objects: snapshot.objects,
  };
};
