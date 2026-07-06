import {
  ROBOT_ASSET_DEFAULT_FILE_MIME_TYPE,
  ROBOT_ASSET_FILE_FETCH_ACCEPT_HEADER,
  ROBOT_ASSET_MANIFEST_ACCEPT_HEADER,
  ROBOT_ASSET_MANIFEST_FETCH_CONCURRENCY,
  ROBOT_ASSET_MIN_FETCH_WORKERS,
  ROBOT_ASSET_PATH_SEPARATOR,
} from "@/shared/robotAssets/robotAssetManifestParams";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";

export type RobotAssetManifestFileEntry = {
  path: string;
  url: string;
  mime?: string;
};

export type RobotAssetManifestPreferences = {
  prepareDemoWorldLayoutOnMotion?: boolean;
  preserveDemoWorldLayoutOnMotion?: boolean;
  suppressDefaultWorldLayoutAutoImport?: boolean;
};

type RobotAssetManifest = {
  label?: string;
  files: RobotAssetManifestFileEntry[];
  preferences: RobotAssetManifestPreferences;
};

export type ProgressiveRobotAssetFileList = {
  initialFileList: FileList;
  loadRemainingFileList: () => Promise<FileList>;
  preferences: RobotAssetManifestPreferences;
};

export type RobotAssetManifestCopy = {
  assetRequestLabel: string;
  bootstrapFailedPrefix: string;
  manifestLabel: string;
  manifestLowerLabel: string;
  noManifestUrlsConfigured: string;
  progressiveBootstrapFailedPrefix: string;
};

const DEFAULT_ROBOT_ASSET_MANIFEST_COPY: RobotAssetManifestCopy = {
  assetRequestLabel: "Robot asset",
  bootstrapFailedPrefix: "Robot asset bootstrap failed for all manifest sources.",
  manifestLabel: "Robot asset",
  manifestLowerLabel: "robot asset",
  noManifestUrlsConfigured: "No robot asset manifest URLs configured.",
  progressiveBootstrapFailedPrefix:
    "Robot asset progressive bootstrap failed for all manifest sources.",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const normalizeManifestPath = (value: string): string =>
  value
    .replace(/\\/g, ROBOT_ASSET_PATH_SEPARATOR)
    .replace(/^\/+/, "")
    .replace(/\/+/g, ROBOT_ASSET_PATH_SEPARATOR);

const toManifestFileEntry = (
  value: unknown,
  index: number,
  copy: RobotAssetManifestCopy
): RobotAssetManifestFileEntry => {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${copy.manifestLowerLabel} manifest file entry at index ${index}.`);
  }
  const rawPath = readString(value.path);
  const rawUrl = readString(value.url);
  if (!rawPath || !rawUrl) {
    throw new Error(`${copy.manifestLabel} manifest file entry ${index} is missing path or url.`);
  }
  const normalizedPath = normalizeManifestPath(rawPath);
  if (!normalizedPath) {
    throw new Error(`${copy.manifestLabel} manifest file entry ${index} has an invalid path.`);
  }
  const mime = readString(value.mime) ?? undefined;
  return {
    path: normalizedPath,
    url: rawUrl,
    mime,
  };
};

const parseManifestPreferences = (
  value: unknown,
  copy: RobotAssetManifestCopy
): RobotAssetManifestPreferences => {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${copy.manifestLabel} manifest preferences must be an object.`);
  }
  const preferences: RobotAssetManifestPreferences = {};
  const suppressDefaultWorldLayoutAutoImport = readBoolean(
    value.suppressDefaultWorldLayoutAutoImport
  );
  if (suppressDefaultWorldLayoutAutoImport !== null) {
    preferences.suppressDefaultWorldLayoutAutoImport = suppressDefaultWorldLayoutAutoImport;
  }
  const prepareDemoWorldLayoutOnMotion = readBoolean(value.prepareDemoWorldLayoutOnMotion);
  if (prepareDemoWorldLayoutOnMotion !== null) {
    preferences.prepareDemoWorldLayoutOnMotion = prepareDemoWorldLayoutOnMotion;
  }
  const preserveDemoWorldLayoutOnMotion = readBoolean(value.preserveDemoWorldLayoutOnMotion);
  if (preserveDemoWorldLayoutOnMotion !== null) {
    preferences.preserveDemoWorldLayoutOnMotion = preserveDemoWorldLayoutOnMotion;
  }
  return preferences;
};

const parseRobotAssetManifest = (
  payload: unknown,
  copy: RobotAssetManifestCopy
): RobotAssetManifest => {
  if (!isRecord(payload)) {
    throw new Error(`Invalid ${copy.manifestLowerLabel} manifest payload.`);
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error(`${copy.manifestLabel} manifest does not include files.`);
  }
  return {
    label: readString(payload.label) ?? undefined,
    files: payload.files.map((entry, index) => toManifestFileEntry(entry, index, copy)),
    preferences: parseManifestPreferences(payload.preferences, copy),
  };
};

const toAbsoluteManifestUrl = (
  manifestUrl: string,
  copy: RobotAssetManifestCopy
): string => {
  try {
    return new URL(manifestUrl).toString();
  } catch {
    if (typeof window !== "undefined") {
      return new URL(manifestUrl, window.location.href).toString();
    }
    throw new Error(`Invalid ${copy.manifestLowerLabel} manifest URL: ${manifestUrl}`);
  }
};

const resolveManifestResourceUrl = (
  manifestUrl: string,
  resourceUrl: string,
  copy: RobotAssetManifestCopy
): string => {
  try {
    return new URL(resourceUrl, manifestUrl).toString();
  } catch {
    throw new Error(`Invalid ${copy.manifestLowerLabel} manifest resource URL: ${resourceUrl}`);
  }
};

const resolveFileNameFromPath = (path: string): string => {
  const pathParts = path.split(ROBOT_ASSET_PATH_SEPARATOR).filter(Boolean);
  const fileName = pathParts[pathParts.length - 1];
  return fileName || "robot-asset-file";
};

const isUrdfManifestEntry = (entry: RobotAssetManifestFileEntry): boolean =>
  entry.path.toLowerCase().endsWith(".urdf");

const assignWebkitRelativePath = (file: File, relativePath: string): void => {
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    writable: false,
    enumerable: true,
    configurable: true,
  });
};

const createDataTransfer = (): DataTransfer => {
  if (typeof DataTransfer === "undefined") {
    throw new Error("DataTransfer is unavailable in this runtime.");
  }
  return new DataTransfer();
};

const readResponseAsBlob = async (response: Response, mimeType?: string): Promise<Blob> => {
  const buffer = await response.arrayBuffer();
  return new Blob([buffer], {
    type: mimeType || response.headers.get("content-type") || ROBOT_ASSET_DEFAULT_FILE_MIME_TYPE,
  });
};

const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (values.length === 0) return [];

  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const workerCount = Math.max(ROBOT_ASSET_MIN_FETCH_WORKERS, Math.min(limit, values.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= values.length) return;
      results[currentIndex] = await mapper(values[currentIndex] as T, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

const loadManifestEntryBlob = async (
  manifestUrl: string,
  entry: RobotAssetManifestFileEntry,
  fetchImpl: typeof fetch,
  copy: RobotAssetManifestCopy
): Promise<Blob> => {
  const fileUrl = resolveManifestResourceUrl(manifestUrl, entry.url, copy);
  const fileResponse = await fetchImpl(fileUrl, {
    headers: { Accept: ROBOT_ASSET_FILE_FETCH_ACCEPT_HEADER },
  });
  if (!fileResponse.ok) {
    throw new Error(
      `${copy.assetRequestLabel} request failed for ${entry.path} (HTTP ${fileResponse.status}).`
    );
  }
  return readResponseAsBlob(fileResponse, entry.mime);
};

const loadManifestEntriesAsFileList = async (
  manifestUrl: string,
  entries: readonly RobotAssetManifestFileEntry[],
  fetchImpl: typeof fetch,
  copy: RobotAssetManifestCopy
): Promise<FileList> => {
  const dataTransfer = createDataTransfer();
  const blobByFileUrl = new Map<string, Promise<Blob>>();

  const blobs = await mapWithConcurrency(
    entries,
    ROBOT_ASSET_MANIFEST_FETCH_CONCURRENCY,
    async (entry) => {
      const fileUrl = resolveManifestResourceUrl(manifestUrl, entry.url, copy);
      let blobPromise = blobByFileUrl.get(fileUrl);
      if (!blobPromise) {
        blobPromise = loadManifestEntryBlob(manifestUrl, entry, fetchImpl, copy).catch((error) => {
          blobByFileUrl.delete(fileUrl);
          throw error;
        });
        blobByFileUrl.set(fileUrl, blobPromise);
      }
      return blobPromise;
    }
  );

  entries.forEach((entry, index) => {
    const blob = blobs[index] as Blob;
    const fileMimeType = (entry.mime ?? blob.type) || ROBOT_ASSET_DEFAULT_FILE_MIME_TYPE;
    const file = new File([blob], resolveFileNameFromPath(entry.path), {
      type: fileMimeType,
    });
    assignWebkitRelativePath(file, entry.path);
    dataTransfer.items.add(file);
  });

  return dataTransfer.files;
};

const loadRobotAssetManifestFromUrl = async (
  manifestUrl: string,
  fetchImpl: typeof fetch,
  copy: RobotAssetManifestCopy
): Promise<{ absoluteManifestUrl: string; manifest: RobotAssetManifest }> => {
  const absoluteManifestUrl = toAbsoluteManifestUrl(manifestUrl, copy);
  const manifestResponse = await fetchImpl(absoluteManifestUrl, {
    headers: { Accept: ROBOT_ASSET_MANIFEST_ACCEPT_HEADER },
  });
  if (!manifestResponse.ok) {
    throw new Error(`${copy.manifestLabel} manifest request failed (HTTP ${manifestResponse.status}).`);
  }

  const manifest = parseRobotAssetManifest((await manifestResponse.json()) as unknown, copy);
  return {
    absoluteManifestUrl,
    manifest,
  };
};

export const loadRobotAssetFileListFromManifestUrl = async (
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch,
  copy: RobotAssetManifestCopy = DEFAULT_ROBOT_ASSET_MANIFEST_COPY
): Promise<FileList> => {
  const { absoluteManifestUrl, manifest } = await loadRobotAssetManifestFromUrl(
    manifestUrl,
    fetchImpl,
    copy
  );
  return loadManifestEntriesAsFileList(absoluteManifestUrl, manifest.files, fetchImpl, copy);
};

export const loadRobotAssetFileListProgressivelyFromManifestUrl = async (
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch,
  copy: RobotAssetManifestCopy = DEFAULT_ROBOT_ASSET_MANIFEST_COPY
): Promise<ProgressiveRobotAssetFileList> => {
  const { absoluteManifestUrl, manifest } = await loadRobotAssetManifestFromUrl(
    manifestUrl,
    fetchImpl,
    copy
  );
  const initialEntry = manifest.files.find(isUrdfManifestEntry);
  if (!initialEntry) {
    throw new Error(
      `${copy.manifestLabel} manifest does not include a URDF file for progressive loading.`
    );
  }
  const remainingEntries = manifest.files.filter((entry) => entry !== initialEntry);

  return {
    initialFileList: await loadManifestEntriesAsFileList(
      absoluteManifestUrl,
      [initialEntry],
      fetchImpl,
      copy
    ),
    loadRemainingFileList: () =>
      loadManifestEntriesAsFileList(absoluteManifestUrl, remainingEntries, fetchImpl, copy),
    preferences: manifest.preferences,
  };
};

const normalizeManifestUrlCandidates = (manifestUrls: readonly string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  manifestUrls.forEach((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  });
  return out;
};

const loadFromManifestUrlCandidates = async<T>({
  manifestUrls,
  fetchImpl,
  copy,
  failurePrefix,
  loadCandidate,
}: {
  manifestUrls: readonly string[];
  fetchImpl: typeof fetch;
  copy: RobotAssetManifestCopy;
  failurePrefix: string;
  loadCandidate: (
    manifestUrl: string,
    fetchImpl: typeof fetch,
    copy: RobotAssetManifestCopy
  ) => Promise<T>;
}): Promise<T> => {
  const candidates = normalizeManifestUrlCandidates(manifestUrls);
  if (candidates.length === 0) {
    throw new Error(copy.noManifestUrlsConfigured);
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return await loadCandidate(candidate, fetchImpl, copy);
    } catch (error) {
      const reason = readUnknownErrorMessage(error, String(error));
      failures.push(`${candidate}: ${reason}`);
    }
  }

  throw new Error(`${failurePrefix} ${failures.join(" | ")}`);
};

export const loadRobotAssetFileListFromManifestUrls = async (
  manifestUrls: readonly string[],
  fetchImpl: typeof fetch = fetch,
  copy: RobotAssetManifestCopy = DEFAULT_ROBOT_ASSET_MANIFEST_COPY
): Promise<FileList> =>
  loadFromManifestUrlCandidates({
    manifestUrls,
    fetchImpl,
    copy,
    failurePrefix: copy.bootstrapFailedPrefix,
    loadCandidate: loadRobotAssetFileListFromManifestUrl,
  });

export const loadRobotAssetFileListProgressivelyFromManifestUrls = async (
  manifestUrls: readonly string[],
  fetchImpl: typeof fetch = fetch,
  copy: RobotAssetManifestCopy = DEFAULT_ROBOT_ASSET_MANIFEST_COPY
): Promise<ProgressiveRobotAssetFileList> =>
  loadFromManifestUrlCandidates({
    manifestUrls,
    fetchImpl,
    copy,
    failurePrefix: copy.progressiveBootstrapFailedPrefix,
    loadCandidate: loadRobotAssetFileListProgressivelyFromManifestUrl,
  });
