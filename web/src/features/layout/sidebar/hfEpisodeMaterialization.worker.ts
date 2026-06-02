/// <reference lib="webworker" />

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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, ...request } = event.data;
  const response: WorkerResponse = {
    id,
    result: materializeHfEpisodeFrames(request),
  };
  ctx.postMessage(response);
};
