import {
  generateV3DatasetArchive,
  type Episode,
} from "@/features/dataset";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";

type JSZipConstructor = typeof import("jszip");

export type DatasetArchiveArtifact = {
  blob: Blob;
  datasetName: string;
  totalFrames: number;
  packDurationMs: number;
};

const countEpisodeFrames = (episodes: Episode[]) =>
  episodes.reduce((totalFrames, episode) => totalFrames + episode.frames.length, 0);

export const buildDatasetArchiveArtifact = async ({
  episodes,
  robotBaseName,
  robotName,
  availableJoints,
  exportLimitMode,
  jointLimits,
  loadJSZip,
  metricsEnabled,
  datasetName = `${robotBaseName}_v3`,
}: {
  episodes: Episode[];
  robotBaseName: string;
  robotName: string;
  availableJoints: string[];
  exportLimitMode: JointLimitMode;
  jointLimits: JointLimits;
  loadJSZip: () => Promise<JSZipConstructor>;
  metricsEnabled: boolean;
  datasetName?: string;
}): Promise<DatasetArchiveArtifact> => {
  const packStart = metricsEnabled ? performance.now() : 0;
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  await generateV3DatasetArchive(
    episodes,
    robotBaseName,
    zip,
    datasetName,
    robotName,
    availableJoints,
    { mode: exportLimitMode, jointLimits }
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const totalFrames = countEpisodeFrames(episodes);

  return {
    blob,
    datasetName,
    totalFrames,
    packDurationMs: metricsEnabled ? performance.now() - packStart : 0,
  };
};
