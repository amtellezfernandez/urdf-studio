import {
  convertDatasetRowsToRecordedFrames,
  applyJointLimitCorrectionsToFrames,
  summarizeJointLimitCorrections,
  type DatasetNumericRow,
  type DatasetSignalProfileResolution,
  type RecordedFrame,
} from "@/features/dataset";
import { resolveHfDatasetEpisodeFps } from "@/features/layout/sidebar/hfDatasetLoadHelpers";
import { computeEpisodeDurationSecFromFrames } from "@/features/layout/sidebar/sidebarHelpers";
import { HF_DATASET_DEFAULT_FPS } from "@/features/layout/sidebar/hfLazyEpisodeParams";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";

export type HfEpisodeMaterializationRequest = {
  numericRows: DatasetNumericRow[];
  signalProfile: DatasetSignalProfileResolution;
  jointMapping: Record<string, string>;
  jointOffsets: Record<string, number>;
  jointInversions: Record<string, boolean>;
  degToRad: boolean;
  jointLimitsSnapshot: JointLimits;
  limitModesByJoint: Record<string, JointLimitMode | undefined>;
  fallbackFps?: number;
};

export type HfEpisodeMaterializationResult = {
  frames: RecordedFrame[];
  report: Record<string, unknown> | null;
  fps: number;
  durationSec: number;
  mappedJointNames: string[];
  error?: string;
};

export const materializeHfEpisodeFrames = ({
  numericRows,
  signalProfile,
  jointMapping,
  jointOffsets,
  jointInversions,
  degToRad,
  jointLimitsSnapshot,
  limitModesByJoint,
  fallbackFps = HF_DATASET_DEFAULT_FPS,
}: HfEpisodeMaterializationRequest): HfEpisodeMaterializationResult => {
  try {
    const converted = convertDatasetRowsToRecordedFrames(numericRows, {
      signalProfile,
      jointMapping,
      jointOffsets,
      jointInversions,
      degToRad,
      jointLimits: jointLimitsSnapshot,
    });
    const { frames: correctedFrames, summaries, violations } =
      applyJointLimitCorrectionsToFrames(
        converted.frames,
        jointLimitsSnapshot,
        limitModesByJoint
      );
    const report = summarizeJointLimitCorrections(summaries, violations);
    const fps = resolveHfDatasetEpisodeFps({
      frameCount: correctedFrames.length,
      durationMs:
        (correctedFrames[correctedFrames.length - 1]?.timestamp ?? 0) -
        (correctedFrames[0]?.timestamp ?? 0),
      fallbackFps,
    });

    return {
      frames: correctedFrames,
      report:
        report.totalViolations === 0 && report.totalClamped === 0 ? null : report,
      fps,
      durationSec: computeEpisodeDurationSecFromFrames(correctedFrames),
      mappedJointNames: Object.keys(correctedFrames[0]?.jointPositions ?? {}),
    };
  } catch (error) {
    return {
      frames: [],
      report: null,
      fps: fallbackFps,
      durationSec: 0,
      mappedJointNames: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to materialize HF episode frames",
    };
  }
};
