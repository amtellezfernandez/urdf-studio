type EpisodeLike = {
  frames: Array<unknown>;
};

export type PlaybackMode = "all" | "single" | null;

type PlaybackEndAction =
  | { type: "none" }
  | { type: "stop" }
  | { type: "advance"; nextIndex: number };

export const findNextPlayableEpisodeIndex = (
  episodes: EpisodeLike[],
  startIndex: number
) => {
  if (episodes.length === 0) return null;
  const normalizedStart =
    ((startIndex % episodes.length) + episodes.length) % episodes.length;
  for (let offset = 0; offset < episodes.length; offset += 1) {
    const candidate = (normalizedStart + offset) % episodes.length;
    if (episodes[candidate]?.frames.length > 0) {
      return candidate;
    }
  }
  return null;
};

export const getPlaybackEndAction = ({
  mode,
  currentFrame,
  totalFrames,
  currentEpisodeIndex,
  episodes,
}: {
  mode: PlaybackMode;
  currentFrame: number;
  totalFrames: number;
  currentEpisodeIndex: number | null;
  episodes: EpisodeLike[];
}): PlaybackEndAction => {
  if (!mode) return { type: "none" };
  if (totalFrames <= 0) return { type: "none" };
  if (currentFrame < totalFrames - 1) return { type: "none" };

  if (mode === "single") {
    return { type: "stop" };
  }

  const startIndex = (currentEpisodeIndex ?? -1) + 1;
  const nextIndex = findNextPlayableEpisodeIndex(episodes, startIndex);
  if (nextIndex === null) {
    return { type: "stop" };
  }
  return { type: "advance", nextIndex };
};
