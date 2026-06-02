import type { RobotBasePose } from "@/shared/types/feature";

export interface AnimationFrame {
  timestamp: number;
  joints: Record<string, number>;
  basePose?: RobotBasePose;
}
