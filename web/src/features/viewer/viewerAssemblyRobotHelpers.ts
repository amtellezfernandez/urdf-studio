import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import {
  localDirectionFromWorld,
  projectDirectionOntoPlane,
  resolveForwardWorldFromWheelAxes,
  worldDirectionFromLocal,
} from "@/shared/lib/axisFrame";
import { resolveJointScalarValue } from "@/features/viewer/viewer-helpers";
import type {
  AssemblyMeshProxy,
  AssemblyPlacementRobot,
  AssemblyWheelJoint,
  AssemblyWheelProfile,
} from "@/features/viewer/assemblyPlacementContact";
import {
  resolveFallbackWheelRadiusMeters,
  resolveSafeMotionDimension,
  resolveWheelCenterWorldFromJointGeometry,
  resolveWheelRadiusFromJointGeometry,
} from "@/features/viewer/studioWheelDriveModel";
import { isStudioWheelLikeLabel } from "@/features/viewer/studioWheelDriveHeuristics";
import { WHEEL_PLAYBACK_MOTION_PARAMS } from "@/features/viewer/playback/wheelPlaybackMotionParams";
import { isFinitePositiveMotionDimension } from "@/features/viewer/viewer3dHelpers";

export const collectAssemblyMeshProxies = (robot: URDFRobot): AssemblyMeshProxy[] => {
  const proxies: AssemblyMeshProxy[] = [];
  robot.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) return;
    proxies.push({
      mesh,
      localBounds: geometry.boundingBox.clone(),
    });
  });
  return proxies;
};

export const detectAssemblyWheelProfile = (
  robot: URDFRobot
): AssemblyWheelProfile | null => {
  const joints = Object.entries(robot.joints ?? {});
  const wheelCandidates: AssemblyWheelJoint[] = [];
  const measuredRadiiMeters: number[] = [];
  const wheelCenters: THREE.Vector3[] = [];

  joints.forEach(([jointName, joint]) => {
    const jointType = String((joint as { jointType?: string }).jointType ?? "").toLowerCase();
    if (jointType !== "continuous" && jointType !== "revolute") return;

    const childNames = (joint.children ?? [])
      .map((child) => child.name || "")
      .join(" ");
    const jointLabel = `${jointName} ${childNames}`;
    if (!isStudioWheelLikeLabel(jointLabel)) return;

    let axisLocal = new THREE.Vector3(0, 1, 0);
    const jointAxis = (joint as { axis?: THREE.Vector3 }).axis;
    if (jointAxis instanceof THREE.Vector3 && jointAxis.lengthSq() > 1e-10) {
      axisLocal = jointAxis.clone().normalize();
    }

    const measuredRadiusMeters = resolveWheelRadiusFromJointGeometry(joint);
    if (isFinitePositiveMotionDimension(measuredRadiusMeters)) {
      measuredRadiiMeters.push(measuredRadiusMeters);
    }
    const wheelCenterWorld = resolveWheelCenterWorldFromJointGeometry(joint);
    if (wheelCenterWorld) {
      wheelCenters.push(wheelCenterWorld);
    }

    wheelCandidates.push({
      jointName,
      joint,
      axisLocal,
      radius: measuredRadiusMeters ?? Number.NaN,
      directionSign: 1,
    });
  });

  if (wheelCandidates.length === 0) return null;
  const fallbackRadiusMeters = resolveFallbackWheelRadiusMeters({
    robot,
    wheelCenters,
    measuredRadiiMeters,
  });
  wheelCandidates.forEach((wheel) => {
    wheel.radius = isFinitePositiveMotionDimension(wheel.radius)
      ? wheel.radius
      : fallbackRadiusMeters;
  });

  const averageAxisWorld = new THREE.Vector3();
  wheelCandidates.forEach((wheel) => {
    const worldAxis = worldDirectionFromLocal(wheel.axisLocal, robot.quaternion);
    averageAxisWorld.add(worldAxis);
  });
  const worldUp = new THREE.Vector3(0, 1, 0);
  const forwardWorld = resolveForwardWorldFromWheelAxes(
    averageAxisWorld,
    worldUp,
    worldDirectionFromLocal(new THREE.Vector3(1, 0, 0), robot.quaternion)
  );
  const forwardLocal = projectDirectionOntoPlane(
    localDirectionFromWorld(forwardWorld, robot.quaternion),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0)
  );

  return {
    forwardLocal,
    wheels: wheelCandidates,
  };
};

export const resolveAssemblyForwardWorld = (
  entry: AssemblyPlacementRobot
): THREE.Vector3 | null => {
  const profile = entry.wheelProfile;
  if (!profile || profile.wheels.length === 0) return null;
  return projectDirectionOntoPlane(
    worldDirectionFromLocal(profile.forwardLocal, entry.robot.quaternion),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0)
  );
};

export const applyAssemblyWheelRollForWorldDelta = (
  entry: AssemblyPlacementRobot,
  deltaX: number,
  deltaZ: number
): void => {
  const profile = entry.wheelProfile;
  if (!profile || profile.wheels.length === 0) return;
  const forward = resolveAssemblyForwardWorld(entry);
  if (!forward) return;
  const travel = deltaX * forward.x + deltaZ * forward.z;
  if (Math.abs(travel) <= WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon) return;

  profile.wheels.forEach((wheel) => {
    const radius = resolveSafeMotionDimension(wheel.radius);
    const current = resolveJointScalarValue(wheel.joint) ?? 0;
    wheel.joint.setJointValue(current - (travel / radius) * wheel.directionSign);
  });
  entry.robot.updateMatrixWorld(true);
};
