import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";
import { parseEpisodeText, type EpisodeParseOptions, type EpisodeParseResult } from "./episodeParserCore";

type WorkerRequest = {
  id: number;
  text: string;
  allowedJoints?: string[] | null;
};

type WorkerResponse = {
  id: number;
  result: EpisodeParseResult;
};

const MIN_WORKER_BYTES = 256 * 1024;
const broker = createWorkerTaskBroker<Omit<WorkerRequest, "id">, WorkerResponse>(() => {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(new URL("./episodeParser.worker.ts", import.meta.url), { type: "module" });
});

export const parseEpisodeTextAsync = async (
  rawText: string,
  options: EpisodeParseOptions = {}
): Promise<EpisodeParseResult> => {
  if (!rawText || rawText.trim().length === 0) {
    return { error: "Failed to read animation data file" };
  }

  if (rawText.length < MIN_WORKER_BYTES) {
    return parseEpisodeText(rawText, options);
  }

  if (typeof Worker === "undefined") {
    return parseEpisodeText(rawText, options);
  }

  const allowedJoints = options.allowedJoints ? Array.from(options.allowedJoints) : undefined;
  const response = await broker.run(
    { text: rawText, allowedJoints },
    {
      shouldUseWorker: (request) => request.text.length >= MIN_WORKER_BYTES,
      fallback: (request) => ({
        id: -1,
        result: parseEpisodeText(request.text, { allowedJoints: request.allowedJoints }),
      }),
      shouldFallback: (result) => Boolean(result?.result?.error),
    }
  );
  if (!response) {
    return parseEpisodeText(rawText, { allowedJoints });
  }
  return response.result;
};
