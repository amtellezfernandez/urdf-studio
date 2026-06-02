import type { CreatedObject } from "@/features/objects";
import {
  resolveObjectIkTargetWorld,
  type IkOrbitDefaults,
  type WorldTargetPosition,
} from "@/features/viewer/objectTargeting";

export type LockedIkObjectSolveTask = {
  object: CreatedObject;
  objectTargetPositionWorld: WorldTargetPosition;
  isOrbitTarget: boolean;
};

const cloneCreatedObjectForSolve = (object: CreatedObject): CreatedObject => ({
  ...object,
  position: object.position.clone(),
  rotation: object.rotation?.clone(),
  size: object.size.clone(),
});

export const createLockedIkObjectSolveTask = ({
  object,
  orbitDefaults,
}: {
  object: CreatedObject;
  orbitDefaults: IkOrbitDefaults;
}): LockedIkObjectSolveTask => {
  const lockedObject = cloneCreatedObjectForSolve(object);
  return {
    object: lockedObject,
    objectTargetPositionWorld: resolveObjectIkTargetWorld({
      object: lockedObject,
      orbitDefaults,
    }),
    isOrbitTarget: lockedObject.ikTargetType === "orbit",
  };
};
