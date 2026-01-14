import type { EpisodeFrame, EpisodeMetadata } from "./episodeTypes";
import { parseEpisodeCsv, type EpisodeCsvParseOptions } from "./episodeCsv";
import {
  parseEpisodeJson,
  type EpisodeJsonEpisode,
  type EpisodeJsonParseOptions,
} from "./episodeFormat";

export type EpisodeParseOptions = EpisodeCsvParseOptions & EpisodeJsonParseOptions;

export type EpisodeParseResult = {
  episodes?: EpisodeJsonEpisode[];
  frames?: EpisodeFrame[];
  jointOrder?: string[];
  metadata?: EpisodeMetadata;
  error?: string;
};

export const parseEpisodeText = (
  rawText: string,
  options: EpisodeParseOptions = {}
): EpisodeParseResult => {
  if (!rawText || rawText.trim().length === 0) {
    return { error: "Failed to read animation data file" };
  }

  const jsonResult = parseEpisodeJson(rawText, options);
  if (jsonResult.episodes && jsonResult.episodes.length > 0) {
    return { episodes: jsonResult.episodes };
  }
  if (jsonResult.frames) {
    return {
      frames: jsonResult.frames,
      jointOrder: jsonResult.jointOrder,
      metadata: jsonResult.metadata,
    };
  }

  const csvResult = parseEpisodeCsv(rawText, options);
  if (csvResult.frames) {
    return { frames: csvResult.frames, jointOrder: csvResult.jointOrder };
  }

  return {
    error: jsonResult.error ?? csvResult.error ?? "Failed to parse animation data file",
  };
};
