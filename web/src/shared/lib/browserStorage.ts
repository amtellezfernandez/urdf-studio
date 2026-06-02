export type BrowserStorageKind = "local" | "session";

export const resolveBrowserStorage = (
  kind: BrowserStorageKind,
): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
};

export const readBrowserStorageItem = (
  key: string,
  kind: BrowserStorageKind = "local",
): string | null => {
  const storage = resolveBrowserStorage(kind);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const writeBrowserStorageItem = (
  key: string,
  value: string,
  kind: BrowserStorageKind = "local",
): void => {
  const storage = resolveBrowserStorage(kind);
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Browser storage is an optimization. The app must still run when it is
    // blocked, full, or unavailable in private contexts.
  }
};

export const removeBrowserStorageItem = (
  key: string,
  kind: BrowserStorageKind = "local",
): void => {
  const storage = resolveBrowserStorage(kind);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures for the same reason as writes.
  }
};
