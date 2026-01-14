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

type PendingRequest = {
  resolve: (result: EpisodeParseResult) => void;
  text: string;
  options: EpisodeParseOptions;
};

const MIN_WORKER_BYTES = 256 * 1024;
let worker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

const getWorker = () => {
  if (typeof Worker === "undefined") {
    return null;
  }

  if (!worker) {
    worker = new Worker(new URL("./episodeParser.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, result } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      pending.resolve(result);
    };
    worker.onerror = () => {
      const pending = Array.from(pendingRequests.values());
      pendingRequests.clear();
      worker?.terminate();
      worker = null;
      pending.forEach(({ resolve, text, options }) => {
        resolve(parseEpisodeText(text, options));
      });
    };
  }

  return worker;
};

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

  const workerInstance = getWorker();
  if (!workerInstance) {
    return parseEpisodeText(rawText, options);
  }

  const allowedJoints = options.allowedJoints ? Array.from(options.allowedJoints) : undefined;
  const requestId = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve) => {
    pendingRequests.set(requestId, {
      resolve,
      text: rawText,
      options: { allowedJoints },
    });
    const message: WorkerRequest = {
      id: requestId,
      text: rawText,
      allowedJoints,
    };
    workerInstance.postMessage(message);
  });
};
