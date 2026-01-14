import { escapeHtml, highlightUrdfToHtml } from "./urdfHighlight";
import { parseUrdfStats, type UrdfParseStats } from "./urdfStats";

type UrdfWorkerResponse =
  | { id: number; type: "stats"; result: UrdfParseStats }
  | { id: number; type: "highlight"; result: string }
  | { id: number; type: "error"; error: string };

type PendingRequest = {
  resolve: (value: UrdfWorkerResponse) => void;
  type: "stats" | "highlight";
  xml: string;
};

const highlightFallbackMax = 20000;
let urdfWorker: Worker | null = null;
let urdfWorkerNextId = 0;
const urdfPending = new Map<number, PendingRequest>();

const getUrdfWorker = () => {
  if (typeof Worker === "undefined") {
    return null;
  }

  if (!urdfWorker) {
    urdfWorker = new Worker(new URL("./urdfEditor.worker.ts", import.meta.url), {
      type: "module",
    });
    urdfWorker.onmessage = (event: MessageEvent<UrdfWorkerResponse>) => {
      const response = event.data;
      const pending = urdfPending.get(response.id);
      if (!pending) return;
      urdfPending.delete(response.id);
      pending.resolve(response);
    };
    urdfWorker.onerror = () => {
      const pending = Array.from(urdfPending.values());
      urdfPending.clear();
      urdfWorker?.terminate();
      urdfWorker = null;
      pending.forEach((request) =>
        request.resolve({ id: -1, type: "error", error: "URDF worker failed" })
      );
    };
  }

  return urdfWorker;
};

const runUrdfWorker = async (type: "stats" | "highlight", xml: string) => {
  const worker = getUrdfWorker();
  if (!worker) {
    return null;
  }

  const requestId = urdfWorkerNextId;
  urdfWorkerNextId += 1;

  return new Promise<UrdfWorkerResponse>((resolve) => {
    urdfPending.set(requestId, { resolve, type, xml });
    worker.postMessage({ id: requestId, type, xml });
  });
};

export const parseUrdfStatsAsync = async (xml: string): Promise<UrdfParseStats> => {
  const response = await runUrdfWorker("stats", xml);
  if (!response || response.type !== "stats") {
    return parseUrdfStats(xml);
  }
  return response.result;
};

export const highlightUrdfAsync = async (xml: string): Promise<string> => {
  const response = await runUrdfWorker("highlight", xml);
  if (!response || response.type !== "highlight") {
    if (xml.length <= highlightFallbackMax) {
      return highlightUrdfToHtml(xml);
    }
    return escapeHtml(xml);
  }
  return response.result;
};
