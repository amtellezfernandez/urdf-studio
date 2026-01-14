/// <reference lib="webworker" />

import { parseEpisodeText, type EpisodeParseResult } from "./episodeParserCore";

type WorkerRequest = {
  id: number;
  text: string;
  allowedJoints?: string[] | null;
};

type WorkerResponse = {
  id: number;
  result: EpisodeParseResult;
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, text, allowedJoints } = event.data;
  let result: EpisodeParseResult;
  try {
    result = parseEpisodeText(text, { allowedJoints: allowedJoints ?? undefined });
  } catch (error) {
    result = {
      error: error instanceof Error ? error.message : "Failed to parse animation data file",
    };
  }

  const response: WorkerResponse = { id, result };
  ctx.postMessage(response);
};
