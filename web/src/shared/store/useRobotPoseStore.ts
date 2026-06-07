import { create } from "zustand";
import type { RobotBasePose } from "@/shared/types/feature";
import {
  cloneRobotBasePose,
  hasMeaningfulRobotBasePoseDelta,
  isFiniteRobotBasePose,
} from "@/shared/lib/robotBasePose";
import {
  ROBOT_POSE_STORE_ROTATION_EPSILON_RAD,
  ROBOT_POSE_STORE_TRANSLATION_EPSILON_METERS,
} from "@/shared/store/robotPoseStoreParams";

type RobotPoseStore = {
  pose: RobotBasePose | null;
  pendingInitialPose: RobotBasePose | null;
  setPose: (pose: RobotBasePose | null | undefined) => void;
  clearPose: () => void;
  requestInitialPose: (pose: RobotBasePose | null | undefined) => void;
  consumeInitialPose: () => RobotBasePose | null;
};

export const useRobotPoseStore = create<RobotPoseStore>((set, get) => ({
  pose: null,
  pendingInitialPose: null,
  setPose: (pose) => {
    if (!isFiniteRobotBasePose(pose)) {
      if (get().pose !== null) {
        set({ pose: null });
      }
      return;
    }

    const previous = get().pose;
    if (
      previous &&
      !hasMeaningfulRobotBasePoseDelta(
        previous,
        pose,
        ROBOT_POSE_STORE_TRANSLATION_EPSILON_METERS,
        ROBOT_POSE_STORE_ROTATION_EPSILON_RAD
      )
    ) {
      return;
    }
    set({ pose: cloneRobotBasePose(pose) ?? null });
  },
  clearPose: () => {
    if (get().pose !== null) {
      set({ pose: null });
    }
  },
  requestInitialPose: (pose) => {
    set({ pendingInitialPose: cloneRobotBasePose(pose) ?? null });
  },
  consumeInitialPose: () => {
    const pose = cloneRobotBasePose(get().pendingInitialPose) ?? null;
    if (get().pendingInitialPose !== null) {
      set({ pendingInitialPose: null });
    }
    return pose;
  },
}));
