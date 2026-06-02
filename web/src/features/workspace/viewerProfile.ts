import {
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

export type ViewerProfile = "studio" | "ros_debug";

type ViewerProfileSource = "default" | "localStorage" | "url";

const STORAGE_KEY = "urdfstudio:viewerProfile";
const CHANGE_EVENT = "urdfstudio:viewerProfileChange";

const listeners = new Set<() => void>();
let listenerBound = false;

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const ensureListenerBound = () => {
  if (typeof window === "undefined" || listenerBound) {
    return;
  }
  window.addEventListener("storage", emitChange);
  window.addEventListener(CHANGE_EVENT, emitChange);
  listenerBound = true;
};

const isViewerProfile = (value: unknown): value is ViewerProfile =>
  value === "studio" || value === "ros_debug";

const readStoredProfile = (): ViewerProfile | null => {
  if (typeof window === "undefined") return null;
  const raw = readBrowserStorageItem(STORAGE_KEY);
  return isViewerProfile(raw) ? raw : null;
};

const readUrlProfile = (): ViewerProfile | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("viewerProfile");
  return isViewerProfile(raw) ? raw : null;
};

export const getViewerProfile = (): ViewerProfile => {
  const fromUrl = readUrlProfile();
  if (fromUrl) return fromUrl;
  const fromStorage = readStoredProfile();
  return fromStorage ?? "studio";
};

export const getViewerProfileSource = (): ViewerProfileSource => {
  if (readUrlProfile()) return "url";
  if (readStoredProfile()) return "localStorage";
  return "default";
};

export const isViewerProfileUrlLocked = (): boolean => readUrlProfile() !== null;

export const setViewerProfile = (profile: ViewerProfile): void => {
  if (typeof window === "undefined") return;
  writeBrowserStorageItem(STORAGE_KEY, profile);
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const subscribeViewerProfile = (listener: () => void): (() => void) => {
  listeners.add(listener);
  ensureListenerBound();
  return () => {
    listeners.delete(listener);
  };
};
