import {
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

export type FeatureFlagValues = {
  playbackTrace: boolean;
  rosVizV2: boolean;
  motionKernelV2: boolean;
};

export type FeatureFlagKey = keyof FeatureFlagValues;
export type FeatureFlagSource = "default" | "localStorage" | "url";
type FeatureFlagSources = Record<FeatureFlagKey, FeatureFlagSource>;

const STORAGE_KEY = "urdfstudio:featureFlags";
const LEGACY_PLAYBACK_DEBUG_KEY = "urdfstudio:playbackDebug";
const FEATURE_FLAGS_CHANGE_EVENT = "urdfstudio:featureFlagsChange";

const DEFAULT_FEATURE_FLAGS: FeatureFlagValues = {
  playbackTrace: false,
  rosVizV2: false,
  motionKernelV2: true,
};

const DEFAULT_FEATURE_FLAG_SOURCES: FeatureFlagSources = {
  playbackTrace: "default",
  rosVizV2: "default",
  motionKernelV2: "default",
};

const listeners = new Set<() => void>();
let storageListenerBound = false;

const sanitizeFlags = (
  input: Partial<Record<FeatureFlagKey, unknown>>
): Partial<FeatureFlagValues> => {
  const next: Partial<FeatureFlagValues> = {};
  if (typeof input.playbackTrace === "boolean") {
    next.playbackTrace = input.playbackTrace;
  }
  if (typeof input.rosVizV2 === "boolean") {
    next.rosVizV2 = input.rosVizV2;
  }
  if (typeof input.motionKernelV2 === "boolean") {
    next.motionKernelV2 = input.motionKernelV2;
  }
  return next;
};

const emitFeatureFlagsChanged = () => {
  listeners.forEach((listener) => listener());
};

const handleStorageOrCustomEvent = () => {
  emitFeatureFlagsChanged();
};

const ensureStorageListenerBound = () => {
  if (typeof window === "undefined" || storageListenerBound) {
    return;
  }
  window.addEventListener("storage", handleStorageOrCustomEvent);
  window.addEventListener(FEATURE_FLAGS_CHANGE_EVENT, handleStorageOrCustomEvent);
  storageListenerBound = true;
};

const readStoredFlags = (): Partial<FeatureFlagValues> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = readBrowserStorageItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<FeatureFlagValues>;
    return sanitizeFlags(parsed ?? {});
  } catch {
    return {};
  }
};

const readUrlFlags = (): {
  values: Partial<FeatureFlagValues>;
  urlLocked: Set<FeatureFlagKey>;
} => {
  if (typeof window === "undefined") {
    return {
      values: {},
      urlLocked: new Set<FeatureFlagKey>(),
    };
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("flags");
  if (!raw) {
    return {
      values: {},
      urlLocked: new Set<FeatureFlagKey>(),
    };
  }

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const overrides: Partial<FeatureFlagValues> = {};
  const urlLocked = new Set<FeatureFlagKey>();
  entries.forEach((entry) => {
    const isDisabled = entry.startsWith("-") || entry.startsWith("!");
    const key = (isDisabled ? entry.slice(1) : entry) as FeatureFlagKey;
    if (key === "playbackTrace") {
      overrides.playbackTrace = !isDisabled;
      urlLocked.add("playbackTrace");
    }
    if (key === "rosVizV2") {
      overrides.rosVizV2 = !isDisabled;
      urlLocked.add("rosVizV2");
    }
    if (key === "motionKernelV2") {
      overrides.motionKernelV2 = !isDisabled;
      urlLocked.add("motionKernelV2");
    }
  });

  return {
    values: overrides,
    urlLocked,
  };
};

const getFeatureFlagState = (): {
  values: FeatureFlagValues;
  sources: FeatureFlagSources;
  urlLocked: Set<FeatureFlagKey>;
} => {
  if (typeof window === "undefined") {
    return {
      values: { ...DEFAULT_FEATURE_FLAGS },
      sources: { ...DEFAULT_FEATURE_FLAG_SOURCES },
      urlLocked: new Set<FeatureFlagKey>(),
    };
  }

  const stored = readStoredFlags();
  const url = readUrlFlags();
  const legacyPlaybackDebug =
    readBrowserStorageItem(LEGACY_PLAYBACK_DEBUG_KEY) === "1";

  const values: FeatureFlagValues = {
    ...DEFAULT_FEATURE_FLAGS,
    ...stored,
    ...url.values,
  };
  const sources: FeatureFlagSources = {
    ...DEFAULT_FEATURE_FLAG_SOURCES,
  };

  if (typeof stored.playbackTrace === "boolean") {
    sources.playbackTrace = "localStorage";
  }
  if (typeof stored.rosVizV2 === "boolean") {
    sources.rosVizV2 = "localStorage";
  }
  if (typeof stored.motionKernelV2 === "boolean") {
    sources.motionKernelV2 = "localStorage";
  }
  if (typeof url.values.playbackTrace === "boolean") {
    sources.playbackTrace = "url";
  }
  if (typeof url.values.rosVizV2 === "boolean") {
    sources.rosVizV2 = "url";
  }
  if (typeof url.values.motionKernelV2 === "boolean") {
    sources.motionKernelV2 = "url";
  }
  if (legacyPlaybackDebug) {
    values.playbackTrace = true;
    if (sources.playbackTrace === "default") {
      sources.playbackTrace = "localStorage";
    }
  }

  return {
    values,
    sources,
    urlLocked: url.urlLocked,
  };
};

export const getFeatureFlags = (): FeatureFlagValues => getFeatureFlagState().values;

export const getFeatureFlagSource = (flag: FeatureFlagKey): FeatureFlagSource =>
  getFeatureFlagState().sources[flag];

export const isFeatureFlagUrlLocked = (flag: FeatureFlagKey): boolean =>
  getFeatureFlagState().urlLocked.has(flag);

export const subscribeFeatureFlags = (listener: () => void): (() => void) => {
  listeners.add(listener);
  ensureStorageListenerBound();
  return () => {
    listeners.delete(listener);
  };
};

export const setFeatureFlag = (flag: FeatureFlagKey, enabled: boolean): void => {
  if (typeof window === "undefined") {
    return;
  }
  const stored = readStoredFlags();
  const nextStored = {
    ...stored,
    [flag]: enabled,
  };
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(nextStored));
  window.dispatchEvent(new Event(FEATURE_FLAGS_CHANGE_EVENT));
};

export const isFeatureFlagEnabled = (flag: FeatureFlagKey): boolean => {
  const flags = getFeatureFlags();
  return Boolean(flags[flag]);
};
