import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";
import { HF_LAZY_EPISODE_WORKER_MIN_ROWS } from "@/features/layout/sidebar/hfLazyEpisodeParams";
import {
  materializeHfEpisodeFrames,
  type HfEpisodeMaterializationRequest,
  type HfEpisodeMaterializationResult,
} from "@/features/layout/sidebar/hfEpisodeMaterializationCore";

type WorkerRequest = HfEpisodeMaterializationRequest & {
  id: number;
};

type WorkerResponse = {
  id: number;
  result: HfEpisodeMaterializationResult;
};

const broker = createWorkerTaskBroker<Omit<WorkerRequest, "id">, WorkerResponse>(() => {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(
    new URL("./hfEpisodeMaterialization.worker.ts", import.meta.url),
    { type: "module" }
  );
});

export const materializeHfEpisodeFramesAsync = async (
  request: HfEpisodeMaterializationRequest
): Promise<HfEpisodeMaterializationResult> => {
  if (
    typeof Worker === "undefined" ||
    request.numericRows.length < HF_LAZY_EPISODE_WORKER_MIN_ROWS
  ) {
    return materializeHfEpisodeFrames(request);
  }

  const response = await broker.run(request, {
    shouldUseWorker: (nextRequest) =>
      nextRequest.numericRows.length >= HF_LAZY_EPISODE_WORKER_MIN_ROWS,
    fallback: (nextRequest) => ({
      id: -1,
      result: materializeHfEpisodeFrames(nextRequest),
    }),
    shouldFallback: (result) => Boolean(result.result.error),
  });

  if (!response) {
    return materializeHfEpisodeFrames(request);
  }
  return response.result;
};
