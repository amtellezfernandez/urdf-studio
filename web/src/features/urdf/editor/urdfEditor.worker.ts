/// <reference lib="webworker" />

import { highlightUrdfToHtml } from "../parsing/urdfHighlight";
import { parseUrdfStats, type UrdfParseStats } from "@/shared/lib/urdfBrowser";

type UrdfWorkerRequest = {
  id: number;
  type: "stats" | "highlight";
  xml: string;
};

type UrdfWorkerResponse =
  | { id: number; type: "stats"; result: UrdfParseStats }
  | { id: number; type: "highlight"; result: string }
  | { id: number; type: "error"; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<UrdfWorkerRequest>) => {
  const { id, type, xml } = event.data;
  try {
    if (type === "stats") {
      const stats = parseUrdfStats(xml);
      const response: UrdfWorkerResponse = { id, type, result: stats };
      workerScope.postMessage(response);
      return;
    }

    if (type === "highlight") {
      const html = highlightUrdfToHtml(xml);
      const response: UrdfWorkerResponse = { id, type, result: html };
      workerScope.postMessage(response);
      return;
    }

    const response: UrdfWorkerResponse = { id, type: "error", error: "Unknown URDF worker task" };
    workerScope.postMessage(response);
  } catch (error) {
    const response: UrdfWorkerResponse = {
      id,
      type: "error",
      error: error instanceof Error ? error.message : "URDF worker failed",
    };
    workerScope.postMessage(response);
  }
};
