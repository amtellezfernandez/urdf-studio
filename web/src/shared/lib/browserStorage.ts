export type BrowserStorageKind = "local" | "session";

const readStorageSafely = <TValue>(readValue: () => TValue, fallback: TValue): TValue => {
  try {
    return readValue();
  } catch {
    return fallback;
  }
};

const writeStorageSafely = (writeValue: () => void): void => {
  try {
    writeValue();
  } catch {
    // Browser storage is an optimization. The app must still run when it is
    // blocked, full, or unavailable in private contexts.
  }
};

export const resolveBrowserStorage = (
  kind: BrowserStorageKind,
): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  return readStorageSafely(
    () => (kind === "local" ? window.localStorage : window.sessionStorage),
    undefined
  );
};

export const readBrowserStorageItem = (
  key: string,
  kind: BrowserStorageKind = "local",
): string | null => {
  const storage = resolveBrowserStorage(kind);
  if (!storage) return null;
  return readStorageSafely(() => storage.getItem(key), null);
};

export const writeBrowserStorageItem = (
  key: string,
  value: string,
  kind: BrowserStorageKind = "local",
): void => {
  const storage = resolveBrowserStorage(kind);
  if (!storage) return;
  writeStorageSafely(() => storage.setItem(key, value));
};

export const removeBrowserStorageItem = (
  key: string,
  kind: BrowserStorageKind = "local",
): void => {
  const storage = resolveBrowserStorage(kind);
  if (!storage) return;
  writeStorageSafely(() => storage.removeItem(key));
};
