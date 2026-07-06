import { getBrowserFileRelativePath } from "@/shared/lib/browserFilePaths";

export const CORE_FOLDER_UPLOAD_SCREEN_PARAMS = {
  setupEntryWideContainerClass: "max-w-7xl space-y-6",
  setupEntryPrimaryGridClass:
    "grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start",
  setupEntryStackClass: "space-y-4",
  recentCameraConfigsStorageKey: "urdfstudio:recent-camera-configs",
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

export const deriveLocalSourceLabel = (files: File[]): string => {
  const firstPath = files[0] ? getBrowserFileRelativePath(files[0]) : "";
  const firstSegment = firstPath.split("/").filter(Boolean)[0];
  if (firstSegment && firstSegment !== files[0]?.name) return firstSegment;
  if (files.length === 1 && files[0]) return files[0].name;
  return `${files.length} local files`;
};

export const fileListToArray = (fileList: FileList | null): File[] =>
  fileList ? Array.from(fileList) : [];
