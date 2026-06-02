import type { RosVizDataSource } from "@/runtime_engine/rosviz/types";

export type RosVizSessionSource = {
  dataSource: RosVizDataSource;
  replaySource: string | null;
};

const isDataSource = (value: string | null): value is RosVizDataSource =>
  value === "live_ros" || value === "replay" || value === "episode";

const normalizeReplaySource = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveRosVizSessionSource = (
  search: string | null | undefined = typeof window !== "undefined" ? window.location.search : ""
): RosVizSessionSource => {
  const params = new URLSearchParams(search || "");

  const explicitSource = params.get("rosVizSource");
  const replayParam = normalizeReplaySource(params.get("rosVizReplay"));
  const episodeParam = normalizeReplaySource(params.get("rosVizEpisode"));

  if (isDataSource(explicitSource)) {
    if (explicitSource === "replay") {
      return {
        dataSource: "replay",
        replaySource: replayParam,
      };
    }
    if (explicitSource === "episode") {
      return {
        dataSource: "episode",
        replaySource: episodeParam ? `episode://${episodeParam}` : replayParam,
      };
    }
    return {
      dataSource: "live_ros",
      replaySource: null,
    };
  }

  if (episodeParam) {
    return {
      dataSource: "episode",
      replaySource: `episode://${episodeParam}`,
    };
  }

  if (replayParam) {
    return {
      dataSource: "replay",
      replaySource: replayParam,
    };
  }

  return {
    dataSource: "live_ros",
    replaySource: null,
  };
};
