import * as THREE from "three";

import type { WorldObjectPrimitiveType } from "@/features/objects";
import { cloneRobotBasePose } from "@/shared/lib/robotBasePose";
import type { RobotBasePose } from "@/shared/types/feature";
import { buildWorldScenarioTimeline } from "@/features/world/worldScenarioEngine";
import { WORLD_SCENARIO_DEFAULT_SEED } from "@/features/world/worldScenarioParams";

const PLAY_DEMO_INITIAL_BASE_POSE: RobotBasePose = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

const PLAY_DEMO_WORLD_SCENARIO_PARAMS = {
  baseCenter: new THREE.Vector3(0, 0, 0),
  baseSize: new THREE.Vector3(0.5, 0.4, 0.3),
  baseZ: 0,
  ringRadius: 0.9,
  forwardOffset: 0.8,
  seed: WORLD_SCENARIO_DEFAULT_SEED,
} as const;

export const buildPlayDemoWorldScenarioTimeline = () =>
  buildWorldScenarioTimeline(PLAY_DEMO_WORLD_SCENARIO_PARAMS);

export const buildPlayDemoWorldScenarioSnapshot = () =>
  buildPlayDemoWorldScenarioTimeline().sampleAt(0);

const buildPlayDemoWorldScenarioSnapshotAtTime = (clockMs: number) =>
  buildPlayDemoWorldScenarioTimeline().sampleAt(clockMs);


const buildPlayDemoInitialBasePose = (): RobotBasePose =>
  cloneRobotBasePose(PLAY_DEMO_INITIAL_BASE_POSE) ?? PLAY_DEMO_INITIAL_BASE_POSE;

export const buildPlayDemoInitialBasePositionWorld = () => {
  const basePose = buildPlayDemoInitialBasePose();
  return new THREE.Vector3(basePose.position.x, basePose.position.y, basePose.position.z);
};

const mapPlayDemoSnapshotToWorldObjects = (
  scenario: ReturnType<typeof buildPlayDemoWorldScenarioSnapshot>
) =>
  scenario.objects.map((object, index) => ({
    id: scenario.objectKeys[index] ?? `object-${index}`,
    type: object.type as WorldObjectPrimitiveType,
    position: object.position.clone(),
    size: object.size.clone(),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    isHidden: false,
  }));

export const buildPlayDemoWorldObjects = () =>
  mapPlayDemoSnapshotToWorldObjects(buildPlayDemoWorldScenarioSnapshot());

export const buildPlayDemoWorldObjectsAtTime = (clockMs: number) =>
  mapPlayDemoSnapshotToWorldObjects(buildPlayDemoWorldScenarioSnapshotAtTime(clockMs));
