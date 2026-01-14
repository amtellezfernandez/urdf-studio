import { createWorkerTaskRunner } from "@/shared/lib/workerTaskRunner";
import { escapeHtml, highlightUrdfToHtml } from "./urdfHighlight";
import { parseUrdfStats, type UrdfParseStats } from "./urdfStats";

type UrdfWorkerResponse =
  | { id: number; type: "stats"; result: UrdfParseStats }
  | { id: number; type: "highlight"; result: string }
  | { id: number; type: "error"; error: string };

const highlightFallbackMax = 20000;
const runner = createWorkerTaskRunner<
  { id: number; type: "stats" | "highlight"; xml: string },
  UrdfWorkerResponse
>(() => {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(new URL("./urdfEditor.worker.ts", import.meta.url), {
    type: "module",
  });
});

export const parseUrdfStatsAsync = async (xml: string): Promise<UrdfParseStats> => {
  const response = await runner.run({ type: "stats", xml });
  if (!response || response.type !== "stats") {
    return parseUrdfStats(xml);
  }
  return response.result;
};

export const highlightUrdfAsync = async (xml: string): Promise<string> => {
  const response = await runner.run({ type: "highlight", xml });
  if (!response || response.type !== "highlight") {
    if (xml.length <= highlightFallbackMax) {
      return highlightUrdfToHtml(xml);
    }
    return escapeHtml(xml);
  }
  return response.result;
};
