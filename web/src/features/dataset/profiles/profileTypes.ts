import type { RobotBasePose } from "@/shared/types/feature";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

export type DatasetSignalSemantic =
  | "joint_position"
  | "joint_velocity"
  | "joint_effort"
  | "base_twist_planar_x"
  | "base_twist_planar_y"
  | "base_twist_planar_theta"
  | "base_pose_planar_x_mm"
  | "base_pose_planar_y_mm"
  | "base_pose_planar_theta_deg"
  | "unknown";

export type DatasetSignalProfileId = "urdf_native" | "lekiwi_client" | "mixed";
export type DatasetSignalBaseMode = "none" | "twist" | "pose";

export type DatasetSignalChannel = {
  index: number;
  sourceName: string;
  normalizedName: string;
  semantic: DatasetSignalSemantic;
  confidence: "high" | "medium" | "low";
};

export type DatasetSignalMappingReport = {
  mappedChannels: number;
  unmappedChannels: number;
  unmappedNames: string[];
  confidence: "high" | "medium" | "low";
};

export type DatasetSignalProfileResolution = {
  profileId: DatasetSignalProfileId;
  profileVersion: string;
  channels: DatasetSignalChannel[];
  jointChannels: DatasetSignalChannel[];
  planarTwistChannels: {
    x: DatasetSignalChannel | null;
    y: DatasetSignalChannel | null;
    theta: DatasetSignalChannel | null;
    complete: boolean;
  };
  planarBasePoseChannels: {
    xMm: DatasetSignalChannel | null;
    yMm: DatasetSignalChannel | null;
    thetaDeg: DatasetSignalChannel | null;
    complete: boolean;
  };
  report: DatasetSignalMappingReport;
};

export type DatasetNumericRow = {
  timestampMs: number;
  values: number[];
};

export type DatasetRowConversionOptions = {
  signalProfile: DatasetSignalProfileResolution;
  jointMapping?: Record<string, string>;
  jointOffsets?: Record<string, number>;
  jointInversions?: Record<string, boolean>;
  degToRad?: boolean;
  jointLimits?: JointLimits;
};

export type DatasetRowConversionResult = {
  frames: Array<{
    timestamp: number;
    jointPositions: Record<string, number>;
    basePose?: RobotBasePose;
  }>;
  usedPlanarTwist: boolean;
};
