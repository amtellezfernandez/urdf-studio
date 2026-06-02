import * as THREE from "three";

export type RoverApproachLegTarget = {
  navigationGoalWorld: THREE.Vector3;
  applyObjectSupportRadius: boolean;
  facingTargetWorld: THREE.Vector3 | null;
  facingDirectionWorld: THREE.Vector3 | null;
};
export const resolveRoverApproachWaypointLegTarget = ({
  waypointWorld,
}: {
  waypointWorld: THREE.Vector3;
}): RoverApproachLegTarget =>
  resolveRoverApproachFinalLegTarget({
    navigationGoalWorld: waypointWorld,
    facingTargetWorld: waypointWorld,
    applyObjectSupportRadius: false,
  });

export const resolveRoverApproachFinalLegTarget = ({
  navigationGoalWorld,
  facingTargetWorld,
  applyObjectSupportRadius,
}: {
  navigationGoalWorld: THREE.Vector3;
  facingTargetWorld: THREE.Vector3 | null;
  applyObjectSupportRadius: boolean;
}): RoverApproachLegTarget => ({
  navigationGoalWorld: navigationGoalWorld.clone(),
  applyObjectSupportRadius,
  facingTargetWorld: facingTargetWorld?.clone() ?? null,
  facingDirectionWorld: null,
});
