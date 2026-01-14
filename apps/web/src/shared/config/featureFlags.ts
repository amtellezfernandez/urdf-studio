type FeatureFlagValues = {
  playbackTrace: boolean;
};

const STORAGE_KEY = "urdfstudio:featureFlags";
const LEGACY_PLAYBACK_DEBUG_KEY = "urdfstudio:playbackDebug";

const DEFAULT_FEATURE_FLAGS: FeatureFlagValues = {
  playbackTrace: false,
};

const sanitizeFlags = (
  input: Partial<Record<keyof FeatureFlagValues, unknown>>
): Partial<FeatureFlagValues> => {
  const next: Partial<FeatureFlagValues> = {};
  if (typeof input.playbackTrace === "boolean") {
    next.playbackTrace = input.playbackTrace;
  }
  return next;
};

const readStoredFlags = (): Partial<FeatureFlagValues> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<FeatureFlagValues>;
    return sanitizeFlags(parsed ?? {});
  } catch {
    return {};
  }
};

const readUrlFlags = (): Partial<FeatureFlagValues> => {
  if (typeof window === "undefined") {
    return {};
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("flags");
  if (!raw) return {};

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const overrides: Partial<FeatureFlagValues> = {};
  entries.forEach((entry) => {
    const isDisabled = entry.startsWith("-") || entry.startsWith("!");
    const key = (isDisabled ? entry.slice(1) : entry) as keyof FeatureFlagValues;
    if (key === "playbackTrace") {
      overrides.playbackTrace = !isDisabled;
    }
  });

  return overrides;
};

const getFeatureFlags = (): FeatureFlagValues => {
  if (typeof window === "undefined") {
    return { ...DEFAULT_FEATURE_FLAGS };
  }

  const stored = readStoredFlags();
  const urlFlags = readUrlFlags();
  const legacyPlaybackDebug =
    window.localStorage.getItem(LEGACY_PLAYBACK_DEBUG_KEY) === "1";

  const merged: FeatureFlagValues = {
    ...DEFAULT_FEATURE_FLAGS,
    ...stored,
    ...urlFlags,
  };

  if (legacyPlaybackDebug) {
    merged.playbackTrace = true;
  }

  return merged;
};

export const isFeatureFlagEnabled = (flag: keyof FeatureFlagValues): boolean => {
  const flags = getFeatureFlags();
  return Boolean(flags[flag]);
};
