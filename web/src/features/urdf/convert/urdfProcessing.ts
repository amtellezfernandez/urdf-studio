import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";
import { createLruCache, hashString } from "@/shared/lib/cache";
import { escapeHtml, highlightUrdfToHtml } from "../parsing/urdfHighlight";
import { parseUrdfStats, type UrdfParseStats } from "@/shared/lib/urdfBrowser";
import { convertURDFToMJCF, convertURDFToXacro } from "@/shared/lib/urdfCore";

type UrdfWorkerResponse =
  | { id: number; type: "stats"; result: UrdfParseStats }
  | { id: number; type: "highlight"; result: string }
  | { id: number; type: "error"; error: string };

type XacroConversionResult = ReturnType<typeof convertURDFToXacro>;
type MjcfConversionResult = ReturnType<typeof convertURDFToMJCF>;

const statsCache = createLruCache<UrdfParseStats>(48);
const highlightCache = createLruCache<string>(24);
const conversionCache = createLruCache<XacroConversionResult | MjcfConversionResult>(16);

const highlightFallbackMax = 20000;
const highlightWorkerMin = 2500;
const statsWorkerMin = 1500;

const broker = createWorkerTaskBroker<
  { type: "stats" | "highlight"; xml: string },
  UrdfWorkerResponse
>(() => {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(new URL("../editor/urdfEditor.worker.ts", import.meta.url), { type: "module" });
});

const cacheKey = (prefix: string, xml: string) => `${prefix}:${hashString(xml)}`;

export const getUrdfStats = (xml: string) => {
  const key = cacheKey("stats", xml);
  const cached = statsCache.get(key);
  if (cached) return cached;
  const stats = parseUrdfStats(xml);
  statsCache.set(key, stats);
  return stats;
};

export const getUrdfStatsAsync = async (
  xml: string,
  signal?: AbortSignal
): Promise<UrdfParseStats> => {
  const key = cacheKey("stats", xml);
  const cached = statsCache.get(key);
  if (cached) return cached;

  const response = await broker.run(
    { type: "stats", xml },
    {
      signal,
      shouldUseWorker: (request) => request.xml.length >= statsWorkerMin,
      fallback: (request) => ({
        id: -1,
        type: "stats",
        result: parseUrdfStats(request.xml),
      }),
      shouldFallback: (result) => result.type !== "stats",
    }
  );

  const stats = response && response.type === "stats" ? response.result : parseUrdfStats(xml);
  statsCache.set(key, stats);
  return stats;
};

export const highlightUrdfAsync = async (
  xml: string,
  signal?: AbortSignal
): Promise<string> => {
  const key = cacheKey("highlight", xml);
  const cached = highlightCache.get(key);
  if (cached) return cached;

  const response = await broker.run(
    { type: "highlight", xml },
    {
      signal,
      shouldUseWorker: (request) => request.xml.length >= highlightWorkerMin,
      fallback: (request) => ({
        id: -1,
        type: "highlight",
        result: request.xml.length <= highlightFallbackMax
          ? highlightUrdfToHtml(request.xml)
          : escapeHtml(request.xml),
      }),
      shouldFallback: (result) => result.type !== "highlight",
    }
  );

  const highlighted =
    response && response.type === "highlight"
      ? response.result
      : xml.length <= highlightFallbackMax
        ? highlightUrdfToHtml(xml)
        : escapeHtml(xml);

  highlightCache.set(key, highlighted);
  return highlighted;
};

export const convertUrdfToXacroCached = (xml: string): XacroConversionResult => {
  const key = cacheKey("xacro", xml);
  const cached = conversionCache.get(key);
  if (cached) return cached as XacroConversionResult;
  const result = convertURDFToXacro(xml);
  conversionCache.set(key, result);
  return result;
};

export const convertUrdfToMjcfCached = (xml: string): MjcfConversionResult => {
  const key = cacheKey("mjcf", xml);
  const cached = conversionCache.get(key);
  if (cached) return cached as MjcfConversionResult;
  const result = convertURDFToMJCF(xml);
  conversionCache.set(key, result);
  return result;
};
