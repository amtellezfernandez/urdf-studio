import { create } from "zustand";
import * as THREE from "three";

export type WorldLabsSplatGroundProbeOptions = {
  maxDistance?: number;
  minHitCount?: number;
  sampleRadius?: number;
  surfaceTolerance?: number;
};

export type WorldLabsSplatGroundProbeResult = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  confidence: number;
  hitCount: number;
  sampleCount: number;
  maxPlaneResidual: number;
  sampleRadius: number;
  source: "spark-splat-raycast";
};

export type WorldLabsSplatGroundProbe = {
  packageId: string;
  probeDown: (
    originWorld: THREE.Vector3,
    options?: WorldLabsSplatGroundProbeOptions
  ) => WorldLabsSplatGroundProbeResult | null;
};

type WorldLabsSplatGroundProbeStore = {
  groundProbe: WorldLabsSplatGroundProbe | null;
  setGroundProbe: (probe: WorldLabsSplatGroundProbe | null) => void;
};

type SplatRaycast = (raycaster: THREE.Raycaster) => THREE.Intersection[];

type SurfaceSample = {
  point: THREE.Vector3;
  offsetU: number;
  offsetV: number;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const resolveFinitePositive = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const resolveFiniteInteger = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;

const resolveProbeBasis = (upAxis: THREE.Vector3) => {
  const up = upAxis.clone().normalize();
  const helper =
    Math.abs(up.dot(new THREE.Vector3(1, 0, 0))) < 0.85
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1);
  const basisU = helper.clone().cross(up).normalize();
  const basisV = up.clone().cross(basisU).normalize();
  return { up, basisU, basisV };
};

const buildSampleOffsets = (sampleRadius: number): Array<[number, number]> => {
  const diagonal = sampleRadius * Math.SQRT1_2;
  return [
    [0, 0],
    [sampleRadius, 0],
    [-sampleRadius, 0],
    [0, sampleRadius],
    [0, -sampleRadius],
    [diagonal, diagonal],
    [-diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, -diagonal],
  ];
};

const castNearest = ({
  origin,
  direction,
  maxDistance,
  raycast,
}: {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  maxDistance: number;
  raycast: SplatRaycast;
}): THREE.Intersection | null => {
  const raycaster = new THREE.Raycaster(origin, direction, 0.001, maxDistance);
  const hits = raycast(raycaster)
    .filter((hit) => Number.isFinite(hit.distance) && hit.distance >= 0)
    .sort((left, right) => left.distance - right.distance);
  return hits[0] ?? null;
};

export const estimateWorldLabsGroundSurface = ({
  samples,
  sampleCount,
  sampleRadius,
  surfaceTolerance,
  upAxis = new THREE.Vector3(0, 1, 0),
}: {
  samples: SurfaceSample[];
  sampleCount: number;
  sampleRadius: number;
  surfaceTolerance: number;
  upAxis?: THREE.Vector3;
}): WorldLabsSplatGroundProbeResult | null => {
  if (samples.length < 3) {
    return null;
  }

  const up = upAxis.clone().normalize();
  const centerSample = samples.find((sample) => sample.offsetU === 0 && sample.offsetV === 0);
  const centroid = new THREE.Vector3();
  samples.forEach((sample) => centroid.add(sample.point));
  centroid.multiplyScalar(1 / samples.length);

  const normal = new THREE.Vector3();
  const referencePoint = centerSample?.point ?? centroid;
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const lhs = samples[i].point.clone().sub(referencePoint);
      const rhs = samples[j].point.clone().sub(referencePoint);
      const candidate = lhs.cross(rhs);
      const length = candidate.length();
      if (length <= 1e-8) {
        continue;
      }
      candidate.multiplyScalar(1 / length);
      if (candidate.dot(up) < 0) {
        candidate.multiplyScalar(-1);
      }
      normal.add(candidate.multiplyScalar(length));
    }
  }

  if (normal.lengthSq() <= 1e-10) {
    return null;
  }
  normal.normalize();

  let maxResidual = 0;
  samples.forEach((sample) => {
    const residual = Math.abs(sample.point.clone().sub(centroid).dot(normal));
    maxResidual = Math.max(maxResidual, residual);
  });

  const hitCoverage = clamp01(samples.length / Math.max(1, sampleCount));
  const planarity = clamp01(1 - maxResidual / Math.max(surfaceTolerance, 1e-6));
  const uprightness = clamp01((normal.dot(up) - 0.35) / 0.65);
  const confidence = clamp01(hitCoverage * (0.55 + planarity * 0.35 + uprightness * 0.1));

  return {
    point: centerSample?.point.clone() ?? centroid,
    normal,
    confidence,
    hitCount: samples.length,
    sampleCount,
    maxPlaneResidual: maxResidual,
    sampleRadius,
    source: "spark-splat-raycast",
  };
};

export const createWorldLabsSplatGroundProbe = ({
  packageId,
  raycast,
  upAxis = new THREE.Vector3(0, 1, 0),
}: {
  packageId: string;
  raycast: SplatRaycast;
  upAxis?: THREE.Vector3;
}): WorldLabsSplatGroundProbe => {
  const { up, basisU, basisV } = resolveProbeBasis(upAxis);
  const down = up.clone().multiplyScalar(-1);

  return {
    packageId,
    probeDown: (originWorld, options = {}) => {
      const maxDistance = resolveFinitePositive(options.maxDistance, 8);
      const minHitCount = resolveFiniteInteger(options.minHitCount, 4);
      const sampleRadius = resolveFinitePositive(options.sampleRadius, 0.25);
      const surfaceTolerance = resolveFinitePositive(options.surfaceTolerance, 0.18);
      const sampleOffsets = buildSampleOffsets(sampleRadius);
      const samples: SurfaceSample[] = [];

      sampleOffsets.forEach(([offsetU, offsetV]) => {
        const origin = originWorld
          .clone()
          .addScaledVector(basisU, offsetU)
          .addScaledVector(basisV, offsetV);
        const hit = castNearest({
          origin,
          direction: down,
          maxDistance,
          raycast,
        });
        if (!hit) {
          return;
        }
        samples.push({
          point: hit.point.clone(),
          offsetU,
          offsetV,
        });
      });

      if (samples.length < minHitCount) {
        return null;
      }

      return estimateWorldLabsGroundSurface({
        samples,
        sampleCount: sampleOffsets.length,
        sampleRadius,
        surfaceTolerance,
        upAxis: up,
      });
    },
  };
};

export const useWorldLabsSplatGroundProbeStore = create<WorldLabsSplatGroundProbeStore>((set) => ({
  groundProbe: null,
  setGroundProbe: (probe) => set({ groundProbe: probe }),
}));
