import {
  normalizeInsertIndex,
  renumberEpisodes,
  resolvePersistedEpisodeIndex,
  type Episode,
} from "@/features/dataset";
import {
  LOCAL_DATASET_DEFAULT_SOURCE_NAME,
  LOCAL_DATASET_FILE_EXTENSIONS,
  LOCAL_DATASET_INFO_ENTRY_PATH,
  LOCAL_DATASET_V3_CODEBASE_VERSION,
  LOCAL_DATASET_V3_FORMAT_VERSION,
} from "@/features/layout/sidebar/localDatasetImportParams";

export type LocalDatasetFileWithRelativePath = File & {
  webkitRelativePath?: string;
};

const compareLocalDatasetPaths = (left: string, right: string) =>
  left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });

const normalizeLocalDatasetPath = (value: string) =>
  value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");

export const getLocalDatasetRelativePath = (
  file: LocalDatasetFileWithRelativePath
) => normalizeLocalDatasetPath(file.webkitRelativePath || file.name);

export const isLocalDatasetV3InfoPath = (path: string) =>
  normalizeLocalDatasetPath(path).endsWith(LOCAL_DATASET_INFO_ENTRY_PATH);

export const hasLocalDatasetV3InfoFile = (
  files: readonly LocalDatasetFileWithRelativePath[]
) => files.some((file) => isLocalDatasetV3InfoPath(getLocalDatasetRelativePath(file)));

export const resolveLocalDatasetFolderBasePath = (infoPath: string) => {
  const normalizedInfoPath = normalizeLocalDatasetPath(infoPath);
  if (!isLocalDatasetV3InfoPath(normalizedInfoPath)) {
    return "";
  }
  const basePath = normalizedInfoPath.slice(
    0,
    normalizedInfoPath.length - LOCAL_DATASET_INFO_ENTRY_PATH.length
  );
  return basePath.replace(/\/+$/, "");
};

export const toLocalDatasetArchivePath = (
  path: string,
  basePath: string
) => {
  const normalizedPath = normalizeLocalDatasetPath(path);
  const normalizedBasePath = normalizeLocalDatasetPath(basePath).replace(/\/+$/, "");
  if (
    normalizedBasePath &&
    normalizedPath.startsWith(`${normalizedBasePath}/`)
  ) {
    return normalizedPath.slice(normalizedBasePath.length + 1);
  }
  return normalizedPath;
};

export const resolveLocalDatasetFolderSourceName = (
  files: readonly LocalDatasetFileWithRelativePath[]
) => {
  const firstFile = files[0];
  if (!firstFile) {
    return LOCAL_DATASET_DEFAULT_SOURCE_NAME;
  }
  const relativePath = getLocalDatasetRelativePath(firstFile);
  const [rootSegment] = relativePath.split("/").filter(Boolean);
  return rootSegment || firstFile.name || LOCAL_DATASET_DEFAULT_SOURCE_NAME;
};

const isSupportedLocalDatasetFileName = (name: string) => {
  const normalizedName = name.trim().toLowerCase();
  return LOCAL_DATASET_FILE_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension)
  );
};

export const listSortedLocalDatasetMotionFiles = (
  files: readonly LocalDatasetFileWithRelativePath[]
) =>
  files
    .filter((file) => isSupportedLocalDatasetFileName(file.name))
    .sort((left, right) =>
      compareLocalDatasetPaths(
        getLocalDatasetRelativePath(left),
        getLocalDatasetRelativePath(right)
      )
    );

export const isLocalDatasetV3InfoPayload = (value: unknown) => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const info = value as Record<string, unknown>;
  return (
    info.codebase_version === LOCAL_DATASET_V3_CODEBASE_VERSION ||
    info.dataset_format_version === LOCAL_DATASET_V3_FORMAT_VERSION
  );
};

export const parseLocalDatasetJsonLines = <
  Row extends Record<string, unknown> = Record<string, unknown>,
>(
  content: string
) => {
  const rows: Row[] = [];
  content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .forEach((line) => {
      try {
        rows.push(JSON.parse(line) as Row);
      } catch (error) {
        console.warn("Failed to parse local dataset line:", error);
      }
    });
  return rows;
};

export const groupLocalDatasetRowsByEpisodeIndex = <
  Row extends Record<string, unknown>,
>(
  rows: readonly Row[]
) => {
  const episodesByIndex = new Map<number, Row[]>();
  rows.forEach((row) => {
    const episodeIndex = row.episode_index;
    if (typeof episodeIndex !== "number" || !Number.isFinite(episodeIndex)) {
      return;
    }
    const normalizedEpisodeIndex = Math.max(0, Math.trunc(episodeIndex));
    const existingRows = episodesByIndex.get(normalizedEpisodeIndex);
    if (existingRows) {
      existingRows.push(row);
    } else {
      episodesByIndex.set(normalizedEpisodeIndex, [row]);
    }
  });
  return episodesByIndex;
};

export const buildImportedEpisodeId = (prefix: string, suffix?: string | number) => {
  const baseId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return suffix === undefined ? `${prefix}-${baseId}` : `${prefix}-${baseId}-${suffix}`;
};

export const mergeEpisodesByPersistedIndex = (
  currentEpisodes: readonly Episode[],
  importedEpisodes: readonly Episode[]
) => {
  if (importedEpisodes.length === 0) {
    return [...currentEpisodes];
  }

  const nextEpisodes = [...currentEpisodes];
  const sortedImportedEpisodes = [...importedEpisodes].sort((left, right) => {
    const leftIndex = resolvePersistedEpisodeIndex(left.metadata, left.number - 1);
    const rightIndex = resolvePersistedEpisodeIndex(right.metadata, right.number - 1);
    return leftIndex - rightIndex;
  });

  sortedImportedEpisodes.forEach((episode) => {
    const targetEpisodeIndex = resolvePersistedEpisodeIndex(
      episode.metadata,
      nextEpisodes.length
    );
    const insertionCandidateIndex = nextEpisodes.findIndex((currentEpisode, currentIndex) => {
      const currentEpisodeIndex = resolvePersistedEpisodeIndex(
        currentEpisode.metadata,
        currentIndex
      );
      return currentEpisodeIndex > targetEpisodeIndex;
    });
    const insertIndex = normalizeInsertIndex(
      nextEpisodes.length,
      insertionCandidateIndex >= 0 ? insertionCandidateIndex : nextEpisodes.length
    );
    nextEpisodes.splice(insertIndex, 0, episode);
  });

  return renumberEpisodes(nextEpisodes);
};
