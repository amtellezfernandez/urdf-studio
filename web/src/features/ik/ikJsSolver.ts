import * as THREE from "three";
import URDFLoader, { type URDFJoint, type URDFRobot } from "urdf-loader";
import type { IkResponsePayload } from "@/features/viewer/ik-types";
import type { IkSolvePayload, IkSolveResponse, IkSolveStrategy } from "./types";

type SolveResult = {
  ok: boolean;
  result?: IkResponsePayload;
  error?: string;
  status?: IkSolveResponse["status"];
};

const ROBOT_CACHE = new Map<string, Promise<URDFRobot>>();
const CHAIN_CACHE = new Map<string, URDFJoint[]>();

const DEFAULT_MAX_ITERATIONS = 28;
const DEFAULT_TOLERANCE = 0.006;
const MAX_STEP_RAD = 0.35;
const MAX_STEP_LINEAR = 0.02;
const LIMIT_CENTER_BIAS_RAD = 0.05;
const LIMIT_CENTER_BIAS_LINEAR = 0.01;
const FLOOR_SOFT_CLEARANCE_M = 0.05;
const FLOOR_HARD_CLEARANCE_M = 0.0;
const SELF_CROWD_SOFT_DIST_M = 0.12;
const SELF_CROWD_HARD_DIST_M = 0.06;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const readJointValue = (joint: URDFJoint) =>
  Array.isArray(joint.jointValue) ? joint.jointValue[0] ?? 0 : 0;

const resolveLink = (robot: URDFRobot, linkName: string) => {
  const robotAny = robot as URDFRobot & {
    links?: Record<string, THREE.Object3D>;
    getObjectByName?: (name: string) => THREE.Object3D | undefined;
  };
  const safeDecode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return (
    robotAny?.links?.[linkName] ??
    robotAny?.getObjectByName?.(linkName) ??
    robotAny?.getObjectByName?.(safeDecode(linkName)) ??
    null
  );
};

const getRobot = (urdf: string) => {
  const cached = ROBOT_CACHE.get(urdf);
  if (cached) return cached;

  const promise = Promise.resolve().then(() => {
    const loader = new URDFLoader();
    loader.loadMeshCb = (_path, _manager, onComplete) => {
      onComplete(null);
    };
    const robot = loader.parse(urdf) as URDFRobot;
    robot.updateMatrixWorld(true);
    return robot;
  });

  ROBOT_CACHE.set(urdf, promise);
  return promise;
};

const getJointChain = (robot: URDFRobot, linkName: string, cacheKey: string) => {
  const cached = CHAIN_CACHE.get(cacheKey);
  if (cached) return cached;

  const endEffector = resolveLink(robot, linkName);
  if (!endEffector) return [];

  const chain: URDFJoint[] = [];
  let cursor: THREE.Object3D | null = endEffector;
  while (cursor) {
    const joint = cursor as URDFJoint & { isURDFJoint?: boolean };
    if (joint?.isURDFJoint && joint.jointType !== "fixed") {
      chain.push(joint);
    }
    cursor = cursor.parent ?? null;
  }

  CHAIN_CACHE.set(cacheKey, chain);
  return chain;
};

const extractSolution = (robot: URDFRobot) => {
  const result: Record<string, number> = {};
  const joints = (robot as URDFRobot & { joints?: Record<string, URDFJoint> }).joints ?? {};
  for (const [name, joint] of Object.entries(joints)) {
    if (!joint || joint.jointType === "fixed") continue;
    const value = Array.isArray(joint.jointValue) ? joint.jointValue[0] : undefined;
    if (typeof value === "number" && Number.isFinite(value)) {
      result[name] = value;
    }
  }
  return result;
};

const applyJointValuesToRobot = (robot: URDFRobot, values: Record<string, number>) => {
  if (typeof robot.setJointValues === "function") {
    robot.setJointValues(values);
    return;
  }
  if (typeof robot.setJointValue === "function") {
    Object.entries(values).forEach(([name, value]) => {
      robot.setJointValue(name, value);
    });
  }
};

const hasFiniteLimits = (joint: URDFJoint) =>
  !joint.ignoreLimits &&
  Number.isFinite(joint.limit.lower) &&
  Number.isFinite(joint.limit.upper) &&
  joint.limit.upper > joint.limit.lower;

const buildSeedCandidates = (
  chain: URDFJoint[],
  baseValues: Record<string, number>
) => {
  const centered: Record<string, number> = { ...baseValues };
  const lowerBiased: Record<string, number> = { ...baseValues };
  const upperBiased: Record<string, number> = { ...baseValues };

  chain.forEach((joint) => {
    const jointName = joint.name;
    if (!jointName || joint.jointType === "continuous" || !hasFiniteLimits(joint)) return;
    const lower = joint.limit.lower;
    const upper = joint.limit.upper;
    const span = upper - lower;
    const center = lower + span * 0.5;
    centered[jointName] = center;
    lowerBiased[jointName] = lower + span * 0.25;
    upperBiased[jointName] = lower + span * 0.75;
  });

  return [
    { id: "current", values: baseValues },
    { id: "centered", values: centered },
    { id: "lower-biased", values: lowerBiased },
    { id: "upper-biased", values: upperBiased },
  ] as const;
};

const computePosturePenalty = (chain: URDFJoint[]) => {
  let centerPenalty = 0;
  let limitPenalty = 0;
  let samples = 0;

  for (const joint of chain) {
    if (joint.jointType === "fixed") continue;
    const value = readJointValue(joint);
    if (!Number.isFinite(value)) continue;
    samples += 1;

    if (joint.jointType === "continuous" || !hasFiniteLimits(joint)) {
      centerPenalty += Math.min(Math.abs(value), Math.PI) * 0.03;
      continue;
    }

    const lower = joint.limit.lower;
    const upper = joint.limit.upper;
    const span = Math.max(upper - lower, 1e-6);
    const halfRange = span * 0.5;
    const center = lower + halfRange;
    const centerNorm = Math.abs(value - center) / halfRange; // 0 at center, 1 at limits
    centerPenalty += centerNorm * centerNorm;

    const clearance = Math.min(value - lower, upper - value);
    const clearanceNorm = Math.max(0, Math.min(1, clearance / halfRange));
    const edgeProximity = 1 - clearanceNorm; // 0 at center, 1 at limits
    limitPenalty += edgeProximity * edgeProximity * edgeProximity;
  }

  const denom = Math.max(1, samples);
  return {
    centerPenalty: centerPenalty / denom,
    limitPenalty: limitPenalty / denom,
  };
};

type CandidateRunResult = {
  id: string;
  solution: Record<string, number>;
  cost: number;
  iterations: number;
  centerPenalty: number;
  limitPenalty: number;
  continuityPenalty: number;
  floorPenalty: number;
  selfCrowdingPenalty: number;
  score: number;
};

const shortestAngularDistance = (from: number, to: number) => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const computeContinuityPenalty = (
  chain: URDFJoint[],
  currentValues: Record<string, number>,
  candidateValues: Record<string, number>
) => {
  let sum = 0;
  let samples = 0;

  for (const joint of chain) {
    const jointName = joint.name;
    if (!jointName || joint.jointType === "fixed") continue;
    const current = currentValues[jointName];
    const next = candidateValues[jointName];
    if (!Number.isFinite(current) || !Number.isFinite(next)) continue;

    let normalizedDelta = 0;
    if (joint.jointType === "continuous") {
      normalizedDelta = Math.abs(shortestAngularDistance(current, next)) / Math.PI;
    } else if (hasFiniteLimits(joint)) {
      const span = Math.max(joint.limit.upper - joint.limit.lower, 1e-6);
      normalizedDelta = Math.abs(next - current) / span;
    } else {
      normalizedDelta = Math.abs(next - current);
    }

    sum += normalizedDelta * normalizedDelta;
    samples += 1;
  }

  return sum / Math.max(1, samples);
};

const computeFloorPenalty = (points: THREE.Vector3[]) => {
  if (points.length === 0) return 0;
  let total = 0;
  for (const point of points) {
    const z = point.z;
    if (!Number.isFinite(z)) continue;
    if (z >= FLOOR_SOFT_CLEARANCE_M) continue;
    if (z >= FLOOR_HARD_CLEARANCE_M) {
      const norm = (FLOOR_SOFT_CLEARANCE_M - z) / Math.max(FLOOR_SOFT_CLEARANCE_M, 1e-6);
      total += norm * norm;
      continue;
    }
    const under = (FLOOR_HARD_CLEARANCE_M - z) / Math.max(FLOOR_SOFT_CLEARANCE_M, 1e-6);
    total += 2 + under * under * 2;
  }
  return total / Math.max(1, points.length);
};

const computeSelfCrowdingPenalty = (points: THREE.Vector3[]) => {
  if (points.length < 3) return 0;
  let total = 0;
  let samples = 0;

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 2; j < points.length; j += 1) {
      const dist = points[i].distanceTo(points[j]);
      if (!Number.isFinite(dist) || dist >= SELF_CROWD_SOFT_DIST_M) {
        samples += 1;
        continue;
      }
      if (dist >= SELF_CROWD_HARD_DIST_M) {
        const norm =
          (SELF_CROWD_SOFT_DIST_M - dist) /
          Math.max(SELF_CROWD_SOFT_DIST_M - SELF_CROWD_HARD_DIST_M, 1e-6);
        total += norm * norm;
      } else {
        const under =
          (SELF_CROWD_HARD_DIST_M - dist) / Math.max(SELF_CROWD_HARD_DIST_M, 1e-6);
        total += 2 + under * under * 2;
      }
      samples += 1;
    }
  }

  return total / Math.max(1, samples);
};

const computeSpatialSafetyPenalty = (chain: URDFJoint[], endEffector: THREE.Object3D) => {
  const points: THREE.Vector3[] = [];
  const point = new THREE.Vector3();

  endEffector.updateMatrixWorld(true);
  endEffector.getWorldPosition(point);
  points.push(point.clone());

  for (const joint of chain) {
    joint.updateMatrixWorld(true);
    joint.getWorldPosition(point);
    points.push(point.clone());
  }

  return {
    floorPenalty: computeFloorPenalty(points),
    selfCrowdingPenalty: computeSelfCrowdingPenalty(points),
  };
};

const runCcdForSeed = (
  robot: URDFRobot,
  chain: URDFJoint[],
  endEffector: THREE.Object3D,
  target: THREE.Vector3,
  seed: { id: string; values: Record<string, number> },
  currentValues: Record<string, number>,
  deadline: number
): CandidateRunResult | null => {
  applyJointValuesToRobot(robot, seed.values);
  robot.updateMatrixWorld(true);

  const endPos = new THREE.Vector3();
  const jointPos = new THREE.Vector3();
  const toEnd = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const projEnd = new THREE.Vector3();
  const projTarget = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const axisScaled = new THREE.Vector3();

  let iterations = 0;
  let cost = Infinity;

  for (let iter = 0; iter < DEFAULT_MAX_ITERATIONS; iter += 1) {
    if (performance.now() > deadline) {
      return null;
    }

    endEffector.updateMatrixWorld(true);
    endEffector.getWorldPosition(endPos);
    cost = endPos.distanceTo(target);
    iterations = iter + 1;
    if (cost <= DEFAULT_TOLERANCE) {
      break;
    }

    for (const joint of chain) {
      if (performance.now() > deadline) {
        return null;
      }

      joint.updateMatrixWorld(true);
      joint.getWorldPosition(jointPos);
      toEnd.subVectors(endPos, jointPos);
      toTarget.subVectors(target, jointPos);
      axisWorld.copy(joint.axis).transformDirection(joint.matrixWorld).normalize();

      if (!Number.isFinite(axisWorld.lengthSq()) || axisWorld.lengthSq() < 1e-8) {
        continue;
      }

      if (joint.jointType === "prismatic") {
        const alongAxis = axisWorld.dot(toTarget) - axisWorld.dot(toEnd);
        const current = readJointValue(joint);
        const limited = clamp(alongAxis, -MAX_STEP_LINEAR, MAX_STEP_LINEAR);
        let next = current + limited;
        if (hasFiniteLimits(joint)) {
          const lower = joint.limit.lower;
          const upper = joint.limit.upper;
          const center = (lower + upper) * 0.5;
          const halfRange = Math.max((upper - lower) * 0.5, 1e-6);
          const centerNorm = (next - center) / halfRange;
          const bias =
            -centerNorm * LIMIT_CENTER_BIAS_LINEAR * Math.max(0, Math.abs(centerNorm) - 0.25);
          next = clamp(next + bias, lower, upper);
        }
        joint.setJointValue(next);
      } else {
        axisScaled.copy(axisWorld).multiplyScalar(toEnd.dot(axisWorld));
        projEnd.copy(toEnd).sub(axisScaled);
        axisScaled.copy(axisWorld).multiplyScalar(toTarget.dot(axisWorld));
        projTarget.copy(toTarget).sub(axisScaled);

        if (projEnd.lengthSq() < 1e-8 || projTarget.lengthSq() < 1e-8) {
          continue;
        }

        projEnd.normalize();
        projTarget.normalize();
        const dot = clamp(projEnd.dot(projTarget), -1, 1);
        const angle = Math.acos(dot);
        if (!Number.isFinite(angle) || angle < 1e-4) {
          continue;
        }

        cross.crossVectors(projEnd, projTarget);
        const direction = Math.sign(cross.dot(axisWorld)) || 1;
        const delta = clamp(direction * angle, -MAX_STEP_RAD, MAX_STEP_RAD);
        const current = readJointValue(joint);
        let next = current + delta;
        if (joint.jointType !== "continuous" && hasFiniteLimits(joint)) {
          const lower = joint.limit.lower;
          const upper = joint.limit.upper;
          const center = (lower + upper) * 0.5;
          const halfRange = Math.max((upper - lower) * 0.5, 1e-6);
          const centerNorm = (next - center) / halfRange;
          const bias =
            -centerNorm * LIMIT_CENTER_BIAS_RAD * Math.max(0, Math.abs(centerNorm) - 0.22);
          next = clamp(next + bias, lower, upper);
        }
        joint.setJointValue(next);
      }

      endEffector.updateMatrixWorld(true);
      endEffector.getWorldPosition(endPos);
      cost = endPos.distanceTo(target);
      if (cost <= DEFAULT_TOLERANCE) {
        break;
      }
    }
  }

  const solution = extractSolution(robot);
  if (Object.keys(solution).length === 0) {
    return null;
  }

  const penalties = computePosturePenalty(chain);
  const continuityPenalty = computeContinuityPenalty(chain, currentValues, solution);
  const spatialPenalty = computeSpatialSafetyPenalty(chain, endEffector);
  const score =
    cost * 180 +
    penalties.centerPenalty * 1.2 +
    penalties.limitPenalty * 2.2 +
    continuityPenalty * 4 +
    spatialPenalty.floorPenalty * 12 +
    spatialPenalty.selfCrowdingPenalty * 10;

  return {
    id: seed.id,
    solution,
    cost: Number.isFinite(cost) ? cost : Infinity,
    iterations,
    centerPenalty: penalties.centerPenalty,
    limitPenalty: penalties.limitPenalty,
    continuityPenalty,
    floorPenalty: spatialPenalty.floorPenalty,
    selfCrowdingPenalty: spatialPenalty.selfCrowdingPenalty,
    score,
  };
};

export const solveWithIkJs = async (
  payload: IkSolvePayload,
  strategy: IkSolveStrategy,
  timeoutMs: number
): Promise<SolveResult> => {
  const start = performance.now();
  const deadline = start + timeoutMs;
  const robot = await getRobot(payload.urdf);
  applyJointValuesToRobot(robot, payload.jointValues);
  robot.updateMatrixWorld(true);

  const endEffector = resolveLink(robot, payload.targetLink);
  if (!endEffector) {
    return { ok: false, error: "End effector not found", status: "solver_error" };
  }

  const cacheKey = `${payload.urdf.length}:${payload.targetLink}`;
  const chain = getJointChain(robot, payload.targetLink, cacheKey);
  if (chain.length === 0) {
    return { ok: false, error: "IK chain empty", status: "solver_error" };
  }

  const target = new THREE.Vector3(...payload.targetPosition);
  const seedCandidates = buildSeedCandidates(chain, payload.jointValues);

  let bestCandidate: CandidateRunResult | null = null;
  for (const seed of seedCandidates) {
    if (performance.now() > deadline) break;
    const candidate = runCcdForSeed(
      robot,
      chain,
      endEffector,
      target,
      seed,
      payload.jointValues,
      deadline
    );
    if (!candidate) continue;
    if (!bestCandidate || candidate.score < bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return { ok: false, error: "IK solve timed out", status: "timeout" };
  }

  const diagnostics: IkResponsePayload["diagnostics"] = {
    termination_reason: "ik-js",
    termination_flags: [],
    iterations: bestCandidate.iterations,
    cost: Number.isFinite(bestCandidate.cost) ? bestCandidate.cost : 0,
    lambda_final: 0,
    validity: "unknown",
    stability: "unknown",
    degeneracy: "unknown",
    branch_maybe: false,
    branch_metric: 0,
    branch_message: `${strategy.ignoreOrientation ? "orientation_ignored;" : ""}seed=${bestCandidate.id};continuity=${bestCandidate.continuityPenalty.toFixed(3)};floor=${bestCandidate.floorPenalty.toFixed(3)};self=${bestCandidate.selfCrowdingPenalty.toFixed(3)}`,
  };

  return {
    ok: true,
    result: {
      solution: bestCandidate.solution,
      diagnostics,
      metadata: {
        target_link: payload.targetLink,
        actuated_joint_names: Object.keys(bestCandidate.solution),
      },
    },
  };
};
