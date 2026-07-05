export const CORE_FOLDER_UPLOAD_SCREEN_PARAMS = {
  setupEntryWideContainerClass: "max-w-7xl space-y-6",
  setupEntryPrimaryGridClass:
    "grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start",
  setupEntryStackClass: "space-y-4",
  recentCameraConfigsStorageKey: "urdfstudio:recent-camera-configs",
  recentRobotSourcesStorageKey: "urdfstudio:recent-robot-sources",
  recentWorldLayoutsStorageKey: "urdfstudio:recent-world-layouts",
  lastLocalCameraConfigStorageKey: "urdfstudio:last-local-camera-config",
  lastLocalRobotSourceStorageKey: "urdfstudio:last-local-robot-source",
  lastLocalWorldLayoutStorageKey: "urdfstudio:last-local-world-layout",
  sourceButtonClass:
    "h-8 rounded-md border border-border bg-muted px-3 text-xs text-foreground hover:bg-muted/80",
  launcherActionButtonClass:
    "h-8 rounded-md border border-[#ff63d5]/30 bg-[#ff63d5]/[0.08] px-3 text-xs text-foreground hover:bg-[#ff63d5]/[0.14] disabled:border-border disabled:bg-muted/20 disabled:text-muted-foreground",
} as const;

export const readStoredJsonArray = (storageKey: string): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const writeStoredJsonArray = (storageKey: string, values: string[]): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(values));
};

export const readStoredString = (storageKey: string): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey);
};

export const writeStoredString = (storageKey: string, value: string | null): void => {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(storageKey, value);
    return;
  }
  window.localStorage.removeItem(storageKey);
};

export const addRecentValue = (storageKey: string, value: string, maxItems = 3): string[] => {
  const trimmed = value.trim();
  if (!trimmed) return readStoredJsonArray(storageKey);
  const nextValues = [
    trimmed,
    ...readStoredJsonArray(storageKey).filter((item) => item !== trimmed),
  ].slice(0, maxItems);
  writeStoredJsonArray(storageKey, nextValues);
  return nextValues;
};

export const removeRecentValue = (storageKey: string, value: string): string[] => {
  const nextValues = readStoredJsonArray(storageKey).filter((item) => item !== value);
  writeStoredJsonArray(storageKey, nextValues);
  return nextValues;
};

export type RecentRobotSource =
  | { kind: "github"; repoUrl: string; urdfPath?: string }
  | { kind: "url"; url: string };

export type RecentLinkEntry = {
  key: string;
  label: string;
  title: string;
};

export const recentRobotSourceKey = (source: RecentRobotSource): string =>
  source.kind === "github"
    ? `github:${source.repoUrl}#${source.urdfPath ?? ""}`
    : `url:${source.url}`;

const isRecentRobotSource = (value: unknown): value is RecentRobotSource => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "github") {
    return (
      typeof candidate.repoUrl === "string" &&
      (candidate.urdfPath === undefined || typeof candidate.urdfPath === "string")
    );
  }
  return candidate.kind === "url" && typeof candidate.url === "string";
};

export const readRecentRobotSources = (storageKey: string): RecentRobotSource[] => {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecentRobotSource) : [];
  } catch {
    return [];
  }
};

const writeRecentRobotSources = (storageKey: string, sources: RecentRobotSource[]): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(sources));
};

export const addRecentRobotSource = (
  storageKey: string,
  source: RecentRobotSource,
  maxItems = 3
): RecentRobotSource[] => {
  const sourceKey = recentRobotSourceKey(source);
  const nextSources = [
    source,
    ...readRecentRobotSources(storageKey).filter(
      (item) => recentRobotSourceKey(item) !== sourceKey
    ),
  ].slice(0, maxItems);
  writeRecentRobotSources(storageKey, nextSources);
  return nextSources;
};

export const removeRecentRobotSource = (
  storageKey: string,
  sourceKey: string
): RecentRobotSource[] => {
  const nextSources = readRecentRobotSources(storageKey).filter(
    (item) => recentRobotSourceKey(item) !== sourceKey
  );
  writeRecentRobotSources(storageKey, nextSources);
  return nextSources;
};

export const deriveSourceLabel = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    return segment || parsed.hostname || fallback;
  } catch {
    const segment = trimmed.split("/").filter(Boolean).pop();
    return segment || fallback;
  }
};

export const toRecentLinkEntries = (urls: string[]): RecentLinkEntry[] =>
  urls.map((url) => ({
    key: url,
    label: deriveSourceLabel(url, url),
    title: url,
  }));

export const toRecentRobotSourceEntries = (sources: RecentRobotSource[]): RecentLinkEntry[] =>
  sources.map((source) =>
    source.kind === "github"
      ? {
          key: recentRobotSourceKey(source),
          label: deriveSourceLabel(source.urdfPath || source.repoUrl, "GitHub robot"),
          title: source.urdfPath ? `${source.repoUrl} · ${source.urdfPath}` : source.repoUrl,
        }
      : {
          key: recentRobotSourceKey(source),
          label: deriveSourceLabel(source.url, "Remote robot"),
          title: source.url,
        }
  );

const getFileRelativePath = (file: File): string =>
  ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(
    /\\/g,
    "/"
  );

export const deriveLocalSourceLabel = (files: File[]): string => {
  const firstPath = files[0] ? getFileRelativePath(files[0]) : "";
  const firstSegment = firstPath.split("/").filter(Boolean)[0];
  if (firstSegment && firstSegment !== files[0]?.name) return firstSegment;
  if (files.length === 1 && files[0]) return files[0].name;
  return `${files.length} local files`;
};

export const fileListToArray = (fileList: FileList | null): File[] =>
  fileList ? Array.from(fileList) : [];
