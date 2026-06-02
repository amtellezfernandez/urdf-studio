import {
  extractHfRepoIdFromSourceName,
  RECORDING_INTERVAL_MS,
  type Episode,
  type RecordedFrame,
} from "@/features/dataset";
import { HF_DATASET_DEFAULT_FPS } from "@/features/layout/sidebar/hfLazyEpisodeParams";
import {
  RECORDING_SECONDS_PER_MILLISECOND,
} from "@/features/layout/sidebar/recordingParams";
import { OPERATOR_TELEOP_MJLAB_MOTION_LIMITS } from "@/features/teleop/recording/operatorTeleopMotionSafetyParams";
import { cloneRobotBasePose } from "@/shared/lib/robotBasePose";
import type { JointLimitMode } from "@/shared/types/feature";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

export const computeEpisodeDurationSecFromFrames = (frames: RecordedFrame[]) => {
  if (!frames || frames.length === 0) return 0;
  const start = frames[0]?.timestamp ?? 0;
  const end = frames[frames.length - 1]?.timestamp ?? start;
  const durationMs = end - start;
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs / 1000;
  }
  if (Number.isFinite(end) && end > 0) {
    return end / 1000;
  }
  return 0;
};

export const computeGlobalVideoClipBoundsFromRows = (
  rows: Array<Record<string, unknown>>,
  fpsHint: number
): { startSec: number; endSec: number } | null => {
  if (!rows || rows.length === 0) return null;
  let minIndex = Number.POSITIVE_INFINITY;
  let maxIndex = Number.NEGATIVE_INFINITY;

  rows.forEach((row) => {
    const rawIndex = toFiniteNumber(row.index, Number.NaN);
    if (!Number.isFinite(rawIndex)) return;
    const indexValue = Math.max(0, Math.trunc(rawIndex));
    if (indexValue < minIndex) minIndex = indexValue;
    if (indexValue > maxIndex) maxIndex = indexValue;
  });

  if (!Number.isFinite(minIndex) || !Number.isFinite(maxIndex) || maxIndex < minIndex) {
    return null;
  }

  const fps =
    Number.isFinite(fpsHint) && fpsHint > 0
      ? fpsHint
      : HF_DATASET_DEFAULT_FPS;
  return {
    startSec: minIndex / fps,
    endSec: (maxIndex + 1) / fps,
  };
};

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const parseRetryAfterMs = (value: string | null): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isFinite(retryAt)) {
    const delta = retryAt - Date.now();
    return delta > 0 ? delta : null;
  }

  return null;
};

export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
    fetcher?: typeof fetch;
  }
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 200);
  const maxDelayMs = Math.max(baseDelayMs, options?.maxDelayMs ?? 5000);
  const label = options?.label ?? "request";
  const fetcher = options?.fetcher ?? fetch;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let retryAfterMs: number | null = null;
    try {
      const response = await fetcher(url, init);
      if (response.ok) {
        return (await response.json()) as T;
      }

      const retryable = RETRYABLE_HTTP_STATUS.has(response.status);
      const error = new Error(
        `${label} failed (${response.status} ${response.statusText})`
      );
      lastError = error;
      if (retryable) {
        retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      }
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
    } catch (error) {
      const asError =
        error instanceof Error ? error : new Error("Network request failed");
      const wrappedError = new Error(`${label} failed (${asError.message})`);
      lastError = wrappedError;
      if (attempt === maxAttempts) {
        throw wrappedError;
      }
    }

    const jitter = Math.floor(Math.random() * 120);
    const exponentialBackoff = baseDelayMs * 2 ** (attempt - 1) + jitter;
    const cappedBackoff = Math.min(exponentialBackoff, maxDelayMs);
    const cappedRetryAfterMs =
      retryAfterMs !== null ? Math.min(retryAfterMs, maxDelayMs) : null;
    const backoff =
      cappedRetryAfterMs !== null
        ? Math.max(cappedRetryAfterMs, cappedBackoff)
        : cappedBackoff;
    await sleep(backoff);
  }

  throw lastError ?? new Error(`${label} failed`);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type HfDatasetServerRow =
  | { row?: Record<string, unknown>; row_idx?: number }
  | Record<string, unknown>;

export const unwrapHfDatasetServerRow = (
  wrapper: HfDatasetServerRow | undefined
): Record<string, unknown> | null => {
  if (!wrapper || !isRecord(wrapper)) return null;
  const nested = wrapper.row;
  if (isRecord(nested)) {
    return nested;
  }
  return wrapper;
};

const HF_VIDEO_ALLOWED_FIELDS = new Set([
  "path",
  "url",
  "hf_url",
  "src",
  "uri",
  "filename",
  "format",
  "type",
  "fps",
  "width",
  "height",
  "camera",
  "video_key",
  "path_template",
  "chunk_index",
  "file_index",
  "episode_index",
  "chunk",
  "file",
  "frame_index",
  "timestamp",
]);
const HF_VIDEO_GLOBAL_HINT_FIELDS = [
  "episode_index",
  "chunk_index",
  "file_index",
  "chunk",
  "file",
  "frame_index",
  "timestamp",
] as const;
const OBSERVATION_IMAGES_PREFIX = "observation.images.";

const parseCameraFieldFromSuffix = (
  rawSuffix: string
): { cameraName: string; field: string | null } | null => {
  const suffix = rawSuffix.trim();
  if (!suffix) return null;
  const segments = suffix
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  if (segments.length === 1) {
    return {
      cameraName: segments[0],
      field: null,
    };
  }

  const maybeField = segments[segments.length - 1];
  if (HF_VIDEO_ALLOWED_FIELDS.has(maybeField)) {
    return {
      cameraName: segments.slice(0, -1).join("."),
      field: maybeField,
    };
  }

  return {
    cameraName: segments.join("."),
    field: null,
  };
};

const toCanonicalVideoCameraKey = (rawCameraName: string): string => {
  const trimmed = rawCameraName.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith(OBSERVATION_IMAGES_PREFIX)) {
    const suffix = trimmed.slice(OBSERVATION_IMAGES_PREFIX.length);
    const parsed = parseCameraFieldFromSuffix(suffix);
    if (!parsed || !parsed.cameraName) return "";
    return `${OBSERVATION_IMAGES_PREFIX}${parsed.cameraName}`;
  }

  const parsed = parseCameraFieldFromSuffix(trimmed);
  return parsed?.cameraName ?? "";
};

const parseObservationImagesCameraField = (
  rawSuffix: string
): { cameraName: string; field: string | null } | null => {
  const parsed = parseCameraFieldFromSuffix(rawSuffix);
  if (!parsed || !parsed.cameraName) return null;
  return {
    cameraName: `${OBSERVATION_IMAGES_PREFIX}${parsed.cameraName}`,
    field: parsed.field,
  };
};

const addCameraFromSegment = (target: Set<string>, rawSegment: string) => {
  const canonicalCamera = toCanonicalVideoCameraKey(rawSegment);
  if (canonicalCamera) {
    target.add(canonicalCamera);
  }
};

export const extractHfVideoCameraKeysFromFeatures = (
  features: Record<string, unknown>
): string[] => {
  const cameraKeys = new Set<string>();

  Object.keys(features).forEach((featureKey) => {
    if (featureKey.startsWith("observation.images.")) {
      const parsed = parseObservationImagesCameraField(
        featureKey.slice(OBSERVATION_IMAGES_PREFIX.length)
      );
      if (parsed?.cameraName) {
        cameraKeys.add(parsed.cameraName);
      }
    } else if (featureKey.startsWith("videos.")) {
      addCameraFromSegment(cameraKeys, featureKey.slice("videos.".length));
    }
  });

  const observationImages = features["observation.images"];
  if (isRecord(observationImages)) {
    Object.entries(observationImages).forEach(([key, value]) => {
      if (key === "dtype" || key === "shape" || key === "feature") return;
      if (key === "names" && Array.isArray(value)) {
        value.forEach((name) => {
          if (typeof name === "string" && name.trim().length > 0) {
            const canonicalCamera = toCanonicalVideoCameraKey(
              name.trim().startsWith(OBSERVATION_IMAGES_PREFIX)
                ? name.trim()
                : `${OBSERVATION_IMAGES_PREFIX}${name.trim()}`
            );
            if (canonicalCamera) {
              cameraKeys.add(canonicalCamera);
            }
          }
        });
        return;
      }
      if (isRecord(value) || typeof value === "string") {
        const canonicalCamera = toCanonicalVideoCameraKey(
          `${OBSERVATION_IMAGES_PREFIX}${key}`
        );
        if (canonicalCamera) {
          cameraKeys.add(canonicalCamera);
        }
      }
    });
  }

  const videos = features.videos;
  if (isRecord(videos)) {
    Object.entries(videos).forEach(([key, value]) => {
      if (key === "dtype" || key === "shape" || key === "feature") return;
      if (isRecord(value) || typeof value === "string") {
        const canonicalCamera = toCanonicalVideoCameraKey(key);
        if (canonicalCamera) {
          cameraKeys.add(canonicalCamera);
        }
      }
    });
  }

  return Array.from(cameraKeys);
};

export const extractHfVideoCameraKeysFromInfoJson = (
  infoJson: Record<string, unknown>
): string[] => {
  const features = infoJson.features;
  if (!isRecord(features)) {
    return [];
  }
  return extractHfVideoCameraKeysFromFeatures(features);
};

const mergeVideoDescriptorField = (
  target: Record<string, unknown>,
  field: string,
  value: unknown
) => {
  if (!HF_VIDEO_ALLOWED_FIELDS.has(field)) return;
  if (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  ) {
    target[field] = value;
  }
};

const mergeVideoDescriptorValue = (
  target: Record<string, unknown>,
  value: unknown
) => {
  if (typeof value === "string") {
    if (!target.path) {
      target.path = value;
    }
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([field, fieldValue]) => {
    mergeVideoDescriptorField(target, field, fieldValue);
  });
};

const buildHfRowVideoDescriptors = (row: Record<string, unknown>) => {
  const descriptors: Record<string, Record<string, unknown>> = {};
  const ensureDescriptor = (cameraName: string) => {
    const canonicalCameraName = toCanonicalVideoCameraKey(cameraName);
    if (!canonicalCameraName) return null;
    if (!descriptors[canonicalCameraName]) {
      descriptors[canonicalCameraName] = {};
    }
    return descriptors[canonicalCameraName];
  };

  const assignCameraValue = (
    rawCameraName: string,
    field: string | null,
    value: unknown
  ) => {
    const descriptor = ensureDescriptor(rawCameraName);
    if (!descriptor) return;
    if (field) {
      mergeVideoDescriptorField(descriptor, field, value);
      return;
    }
    mergeVideoDescriptorValue(descriptor, value);
  };

  const videos = row.videos;
  if (isRecord(videos)) {
    Object.entries(videos).forEach(([cameraName, value]) => {
      assignCameraValue(cameraName, null, value);
    });
  }

  const observation = row.observation;
  if (isRecord(observation) && isRecord(observation.images)) {
    Object.entries(observation.images).forEach(([cameraName, value]) => {
      assignCameraValue(`${OBSERVATION_IMAGES_PREFIX}${cameraName}`, null, value);
    });
  }

  const observationImages = row["observation.images"];
  if (isRecord(observationImages)) {
    Object.entries(observationImages).forEach(([cameraName, value]) => {
      assignCameraValue(`${OBSERVATION_IMAGES_PREFIX}${cameraName}`, null, value);
    });
  }

  Object.entries(row).forEach(([key, value]) => {
    if (key.startsWith("observation.images.")) {
      const parsed = parseObservationImagesCameraField(
        key.slice(OBSERVATION_IMAGES_PREFIX.length)
      );
      if (!parsed) return;
      assignCameraValue(parsed.cameraName, parsed.field, value);
      return;
    } else if (key.startsWith("videos.")) {
      const parsed = parseCameraFieldFromSuffix(key.slice("videos.".length));
      if (!parsed) return;
      assignCameraValue(parsed.cameraName, parsed.field, value);
      return;
    } else if (key.startsWith("video.")) {
      const parsed = parseCameraFieldFromSuffix(key.slice("video.".length));
      if (!parsed) return;
      assignCameraValue(parsed.cameraName, parsed.field, value);
      return;
    } else {
      return;
    }
  });

  const globalHints: Record<string, unknown> = {};
  HF_VIDEO_GLOBAL_HINT_FIELDS.forEach((hintKey) => {
    const hintValue = row[hintKey];
    if (
      typeof hintValue === "string" ||
      (typeof hintValue === "number" && Number.isFinite(hintValue))
    ) {
      globalHints[hintKey] = hintValue;
    }
  });

  if (Object.keys(globalHints).length > 0) {
    Object.values(descriptors).forEach((descriptor) => {
      Object.entries(globalHints).forEach(([hintKey, hintValue]) => {
        if (descriptor[hintKey] === undefined) {
          descriptor[hintKey] = hintValue;
        }
      });
    });
  }

  return descriptors;
};

export const collectHfVideoCameraKeysFromRows = (
  rows: Array<Record<string, unknown>>
): string[] => {
  const keys = new Set<string>();
  rows.forEach((row) => {
    const descriptors = buildHfRowVideoDescriptors(row);
    Object.keys(descriptors).forEach((cameraName) => keys.add(cameraName));
  });
  return Array.from(keys);
};

const toVideoPathCameraKey = (cameraName: string) => {
  const trimmed = cameraName.trim();
  if (trimmed.startsWith(OBSERVATION_IMAGES_PREFIX)) {
    return trimmed.slice(OBSERVATION_IMAGES_PREFIX.length);
  }
  return trimmed;
};

const buildVideoPathCameraKeyCandidates = (cameraName: string): string[] => {
  const raw = cameraName.trim();
  const normalized = toVideoPathCameraKey(cameraName);
  const candidates = [normalized, raw].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  return Array.from(new Set(candidates));
};

export const buildHfEpisodeVideosMetadata = (
  rows: Array<Record<string, unknown>>,
  fallbackCameraKeys: string[],
  videoPathTemplate?: string
): Record<string, unknown> => {
  const descriptorsByCamera = new Map<string, Record<string, unknown>>();

  rows.forEach((row) => {
    const rowDescriptors = buildHfRowVideoDescriptors(row);
    Object.entries(rowDescriptors).forEach(([cameraName, descriptor]) => {
      const existing = descriptorsByCamera.get(cameraName) ?? {};
      descriptorsByCamera.set(cameraName, {
        ...existing,
        ...descriptor,
      });
    });
  });

  fallbackCameraKeys.forEach((cameraName) => {
    if (!descriptorsByCamera.has(cameraName)) {
      descriptorsByCamera.set(cameraName, {});
    }
  });

  if (videoPathTemplate) {
    descriptorsByCamera.forEach((descriptor, cameraName) => {
      if (typeof descriptor.path !== "string" || descriptor.path.length === 0) {
        descriptor.path_template = videoPathTemplate;
      }
    });
  }

  return Object.fromEntries(descriptorsByCamera.entries());
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const encodePathForUrl = (path: string) =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const resolveVideoUrlForEpisode = (
  rawPathOrUrl: string,
  episode: Episode
): string | null => {
  const raw = rawPathOrUrl.trim();
  if (!raw || raw.includes("{") || raw.includes("}")) {
    return null;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const sourceNameRaw = episode.metadata?.additional?.sourceName;
  const sourceName = typeof sourceNameRaw === "string" ? sourceNameRaw : null;
  const hfRepoFromAdditionalRaw = episode.metadata?.additional?.hfDatasetRepo;
  const hfRepoFromAdditional =
    typeof hfRepoFromAdditionalRaw === "string" ? hfRepoFromAdditionalRaw : null;
  const hfRepo =
    hfRepoFromAdditional ?? extractHfRepoIdFromSourceName(sourceName) ?? null;
  if (!hfRepo) {
    return null;
  }

  const normalized = raw.replace(/^\.?\//, "");
  const repoPrefix = `${hfRepo}/`;
  const relativePath = normalized.startsWith(repoPrefix)
    ? normalized.slice(repoPrefix.length)
    : normalized;
  const encodedPath = encodePathForUrl(relativePath);
  if (!encodedPath) {
    return null;
  }
  return `https://huggingface.co/datasets/${hfRepo}/resolve/main/${encodedPath}`;
};

export const getEpisodeVideoClipBounds = (
  episode: Episode
): { startSec: number; endSec: number | null } => {
  const additional = isRecord(episode.metadata?.additional)
    ? episode.metadata.additional
    : {};
  const startRaw = toFiniteNumber(additional.video_clip_start_sec, Number.NaN);
  const startSec = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 0;
  const endRaw = toFiniteNumber(additional.video_clip_end_sec, Number.NaN);
  const endSec =
    Number.isFinite(endRaw) && endRaw > startSec ? endRaw : null;
  return { startSec, endSec };
};

const resolveVideoTemplatePath = (
  template: string,
  descriptor: Record<string, unknown>,
  cameraName: string,
  episode: Episode,
  cameraTokenOverride?: string
): string | null => {
  if (!template.includes("{")) {
    return template;
  }

  const scalar = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${Math.trunc(value)}`;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return null;
  };

  const getTokenValue = (token: string): string | null => {
    const templateCameraKey = toVideoPathCameraKey(cameraName);
    const episodeIndex = (() => {
      const fromDescriptor = toFiniteNumber(descriptor.episode_index, Number.NaN);
      if (Number.isFinite(fromDescriptor)) {
        return Math.max(0, Math.trunc(fromDescriptor));
      }
      const fromMetadata = toFiniteNumber(
        episode.metadata?.episode_index,
        Number.NaN
      );
      if (Number.isFinite(fromMetadata)) {
        return Math.max(0, Math.trunc(fromMetadata));
      }
      return null;
    })();

    if (token === "video_key" || token === "camera") {
      if (
        typeof cameraTokenOverride === "string" &&
        cameraTokenOverride.trim().length > 0
      ) {
        return cameraTokenOverride.trim();
      }
      return templateCameraKey || cameraName;
    }
    if (token === "episode_index") {
      return episodeIndex !== null ? `${episodeIndex}` : null;
    }
    const direct = scalar(descriptor[token]);
    if (direct) return direct;
    if (token === "chunk_index" || token.includes("chunk")) {
      const explicit = scalar(descriptor.chunk_index ?? descriptor.chunk);
      if (explicit) return explicit;
      if (episodeIndex !== null) return `${Math.floor(episodeIndex / 1000)}`;
      return "0";
    }
    if (token === "file_index" || token.includes("file")) {
      const explicit = scalar(
        descriptor.file_index ?? descriptor.file ?? descriptor.frame_index
      );
      if (explicit) return explicit;
      if (episodeIndex !== null) return `${episodeIndex % 1000}`;
      return "0";
    }
    if (token.includes("episode") && episodeIndex !== null) {
      return `${episodeIndex}`;
    }
    return null;
  };

  let unresolved = false;
  const resolved = template.replace(
    /\{([a-zA-Z0-9_]+)(?::0?(\d+)d)?\}/g,
    (_full, rawToken: string, rawWidth?: string) => {
      const token = String(rawToken);
      const value = getTokenValue(token);
      if (!value) {
        unresolved = true;
        return "";
      }
      const width = rawWidth ? Number(rawWidth) : 0;
      if (width > 0 && /^-?\d+$/.test(value)) {
        return String(Math.trunc(Number(value))).padStart(width, "0");
      }
      return value;
    }
  );

  if (unresolved || !resolved || resolved.includes("{") || resolved.includes("}")) {
    return null;
  }
  return resolved;
};

const buildFallbackVideoPathCandidates = (
  cameraName: string,
  episode: Episode
): string[] => {
  const cameraKeyCandidates = buildVideoPathCameraKeyCandidates(cameraName);
  if (cameraKeyCandidates.length === 0) return [];
  const episodeIndex = toFiniteNumber(episode.metadata?.episode_index, Number.NaN);
  if (!Number.isFinite(episodeIndex)) {
    return [];
  }
  const ep = Math.max(0, Math.trunc(episodeIndex));
  const chunk = Math.floor(ep / 1000);
  const file = ep % 1000;
  const pad = (value: number, width: number) => String(value).padStart(width, "0");

  const candidates: string[] = [];
  cameraKeyCandidates.forEach((cameraKey) => {
    candidates.push(
      `videos/${cameraKey}/chunk-${pad(chunk, 3)}/file-${pad(file, 3)}.mp4`,
      `videos/${cameraKey}/chunk-000/file-000.mp4`,
      `videos/${cameraKey}/chunk-000/file-${pad(ep, 3)}.mp4`,
      `videos/${cameraKey}/episode_${pad(ep, 6)}.mp4`
    );
  });
  return Array.from(new Set(candidates));
};

export const extractVideoUrlsFromDescriptor = (
  descriptor: unknown,
  episode: Episode,
  cameraName: string
): string[] => {
  const urlCandidates: string[] = [];
  const addCandidate = (candidate: string | null) => {
    if (!candidate) return;
    if (!urlCandidates.includes(candidate)) {
      urlCandidates.push(candidate);
    }
  };
  const cameraTokenCandidates = buildVideoPathCameraKeyCandidates(cameraName);
  const direct = toNonEmptyString(descriptor);
  if (direct) {
    addCandidate(resolveVideoUrlForEpisode(direct, episode));
    return urlCandidates;
  }
  if (!isRecord(descriptor)) {
    return urlCandidates;
  }

  const pathTemplate = toNonEmptyString(
    descriptor.path_template ?? descriptor.video_path ?? descriptor.template
  );
  if (pathTemplate) {
    const templateKeys =
      cameraTokenCandidates.length > 0 ? cameraTokenCandidates : [cameraName];
    templateKeys.forEach((tokenCameraKey) => {
      const resolvedPath = resolveVideoTemplatePath(
        pathTemplate,
        descriptor,
        cameraName,
        episode,
        tokenCameraKey
      );
      if (!resolvedPath) return;
      addCandidate(resolveVideoUrlForEpisode(resolvedPath, episode));
    });
  }

  const candidates = [
    descriptor.url,
    descriptor.hf_url,
    descriptor.src,
    descriptor.uri,
    descriptor.path,
    descriptor.filename,
  ];
  for (const candidate of candidates) {
    const value = toNonEmptyString(candidate);
    if (!value) continue;
    if (value.includes("{") || value.includes("}")) {
      if (pathTemplate) {
        continue;
      }
      const templateKeys =
        cameraTokenCandidates.length > 0 ? cameraTokenCandidates : [cameraName];
      templateKeys.forEach((tokenCameraKey) => {
        const resolvedTemplateValue = resolveVideoTemplatePath(
          value,
          descriptor,
          cameraName,
          episode,
          tokenCameraKey
        );
        if (!resolvedTemplateValue) return;
        addCandidate(resolveVideoUrlForEpisode(resolvedTemplateValue, episode));
      });
      continue;
    }
    addCandidate(resolveVideoUrlForEpisode(value, episode));
  }
  const fallbackCandidates = buildFallbackVideoPathCandidates(cameraName, episode);
  for (const fallbackPath of fallbackCandidates) {
    addCandidate(resolveVideoUrlForEpisode(fallbackPath, episode));
  }
  return urlCandidates;
};

const resolveVelocityLimitEntries = (
  jointLimits: JointLimits | undefined
): Array<{ jointName: string; velocity: number }> =>
  Object.entries(jointLimits ?? {})
    .map(([jointName, info]) => ({
      jointName,
      velocity: resolveMotionVelocityLimit(info.velocity),
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.velocity) &&
        (entry.velocity as number) > 0
    ) as Array<{ jointName: string; velocity: number }>;

const resolveMotionVelocityLimit = (jointVelocityLimit?: number | null): number => {
  const mjlabLimit = OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointVelocityRadPerSec;
  const effectiveLimit =
    Number.isFinite(jointVelocityLimit) && (jointVelocityLimit as number) > 0
    ? Math.min(jointVelocityLimit as number, mjlabLimit)
    : mjlabLimit;
  return effectiveLimit * OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.safetyScale;
};

const resolveFrameJointMotionVelocityLimit = (
  jointLimits: JointLimits | undefined,
  jointName: string
): number =>
  resolveMotionVelocityLimit(jointLimits?.[jointName]?.velocity);

const collectRecordedJointNames = (frames: RecordedFrame[]): string[] =>
  Array.from(
    frames.reduce((jointNames, frame) => {
      Object.keys(frame.jointPositions).forEach((jointName) => {
        jointNames.add(jointName);
      });
      return jointNames;
    }, new Set<string>())
  );

const toMjlabTimestampMs = (timestampMs: number): number =>
  Number.isFinite(timestampMs) ? Math.max(0, Math.round(timestampMs)) : 0;

export const normalizeRecordedFrameTimestampsForMjlab = (
  frames: RecordedFrame[]
): RecordedFrame[] =>
  frames.map((frame) => ({
    timestamp: toMjlabTimestampMs(frame.timestamp),
    jointPositions: { ...frame.jointPositions },
    basePose: cloneRobotBasePose(frame.basePose),
  }));

const secondsBetweenFrames = (
  previousFrame: RecordedFrame,
  currentFrame: RecordedFrame
): number => {
  const dtMs =
    toMjlabTimestampMs(currentFrame.timestamp) -
    toMjlabTimestampMs(previousFrame.timestamp);
  return Number.isFinite(dtMs) && dtMs > 0
    ? dtMs * RECORDING_SECONDS_PER_MILLISECOND
    : 0;
};

export type RecordedFrameMotionLimitClampResult = {
  frames: RecordedFrame[];
  clampedSteps: number;
  clampedJoints: number;
  velocityClampedSteps: number;
  accelerationClampedSteps: number;
};

export const applyMotionLimitsToRecordedFrames = (
  frames: RecordedFrame[],
  jointLimits: JointLimits | undefined,
  options: {
    maxJointAccelerationRadPerSec2?: number | null;
  } = {}
): RecordedFrameMotionLimitClampResult => {
  const sourceFrames = normalizeRecordedFrameTimestampsForMjlab(frames);
  if (sourceFrames.length < 2) {
    return {
      frames: sourceFrames,
      clampedSteps: 0,
      clampedJoints: 0,
      velocityClampedSteps: 0,
      accelerationClampedSteps: 0,
    };
  }

  const jointNamesWithVelocityLimits = collectRecordedJointNames(sourceFrames);
  const accelerationLimit =
    options.maxJointAccelerationRadPerSec2 === null
      ? null
      : options.maxJointAccelerationRadPerSec2 ??
        OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointAccelerationRadPerSec2;
  const hasAccelerationLimit =
    Number.isFinite(accelerationLimit) && (accelerationLimit as number) > 0;
  const effectiveAccelerationLimit = hasAccelerationLimit
    ? (accelerationLimit as number) *
      OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.safetyScale
    : null;
  if (jointNamesWithVelocityLimits.length === 0 && !hasAccelerationLimit) {
    return {
      frames: sourceFrames,
      clampedSteps: 0,
      clampedJoints: 0,
      velocityClampedSteps: 0,
      accelerationClampedSteps: 0,
    };
  }

  const nextFrames: RecordedFrame[] = [
    {
      timestamp: sourceFrames[0].timestamp,
      jointPositions: { ...sourceFrames[0].jointPositions },
      basePose: cloneRobotBasePose(sourceFrames[0].basePose),
    },
  ];
  let clampedSteps = 0;
  let velocityClampedSteps = 0;
  let accelerationClampedSteps = 0;
  const clampedJointNames = new Set<string>();
  const previousVelocityByJoint = new Map<string, number>();

  for (let i = 1; i < sourceFrames.length; i += 1) {
    const prevFrame = nextFrames[i - 1];
    const sourceFrame = sourceFrames[i];
    const dt = secondsBetweenFrames(prevFrame, sourceFrame);
    if (dt <= 0) {
      nextFrames.push({
        timestamp: sourceFrame.timestamp,
        jointPositions: { ...sourceFrame.jointPositions },
        basePose: cloneRobotBasePose(sourceFrame.basePose),
      });
      continue;
    }

    let nextPositions: Record<string, number> | null = null;
    const jointNames = new Set([
      ...Object.keys(prevFrame.jointPositions),
      ...Object.keys(sourceFrame.jointPositions),
    ]);
    jointNames.forEach((jointName) => {
      const previous = prevFrame.jointPositions[jointName];
      const current = sourceFrame.jointPositions[jointName];
      if (!Number.isFinite(previous) || !Number.isFinite(current)) return;

      const requestedVelocity = (current - previous) / dt;
      let minVelocity = Number.NEGATIVE_INFINITY;
      let maxVelocity = Number.POSITIVE_INFINITY;
      const jointVelocityLimit = resolveFrameJointMotionVelocityLimit(
        jointLimits,
        jointName
      );
      if (Number.isFinite(jointVelocityLimit) && (jointVelocityLimit as number) > 0) {
        minVelocity = Math.max(minVelocity, -(jointVelocityLimit as number));
        maxVelocity = Math.min(maxVelocity, jointVelocityLimit as number);
      }

      const previousVelocity = previousVelocityByJoint.get(jointName);
      if (
        previousVelocity !== undefined &&
        hasAccelerationLimit &&
        Number.isFinite(previousVelocity)
      ) {
        const accelerationVelocityDelta = (effectiveAccelerationLimit as number) * dt;
        minVelocity = Math.max(minVelocity, previousVelocity - accelerationVelocityDelta);
        maxVelocity = Math.min(maxVelocity, previousVelocity + accelerationVelocityDelta);
      }

      const clampedVelocity =
        minVelocity <= maxVelocity
          ? clampNumber(requestedVelocity, minVelocity, maxVelocity)
          : clampNumber(requestedVelocity, -Math.abs(maxVelocity), Math.abs(maxVelocity));
      const nextValue = previous + clampedVelocity * dt;
      previousVelocityByJoint.set(jointName, clampedVelocity);

      if (Math.abs(nextValue - current) <= Number.EPSILON) {
        return;
      }

      if (!nextPositions) {
        nextPositions = { ...sourceFrame.jointPositions };
      }
      nextPositions[jointName] = nextValue;
      clampedJointNames.add(jointName);
      clampedSteps += 1;
      if (
        Number.isFinite(jointVelocityLimit) &&
        (jointVelocityLimit as number) > 0 &&
        Math.abs(requestedVelocity) > (jointVelocityLimit as number)
      ) {
        velocityClampedSteps += 1;
      }
      if (
        previousVelocity !== undefined &&
        hasAccelerationLimit &&
        Number.isFinite(previousVelocity) &&
        Math.abs(requestedVelocity - previousVelocity) / dt >
          (effectiveAccelerationLimit as number)
      ) {
        accelerationClampedSteps += 1;
      }
    });

    nextFrames.push(
      nextPositions
        ? {
            timestamp: sourceFrame.timestamp,
            jointPositions: nextPositions,
            basePose: cloneRobotBasePose(sourceFrame.basePose),
          }
        : {
            timestamp: sourceFrame.timestamp,
            jointPositions: { ...sourceFrame.jointPositions },
            basePose: cloneRobotBasePose(sourceFrame.basePose),
          }
    );
  }

  if (clampedSteps === 0) {
    return {
      frames: sourceFrames,
      clampedSteps: 0,
      clampedJoints: 0,
      velocityClampedSteps: 0,
      accelerationClampedSteps: 0,
    };
  }

  return {
    frames: nextFrames,
    clampedSteps,
    clampedJoints: clampedJointNames.size,
    velocityClampedSteps,
    accelerationClampedSteps,
  };
};

export type EpisodeVelocityStatus = {
  overCount: number;
  maxRatio: number;
  worstJoint: string | null;
  worstFrame: number | null;
  worstTimeSec: number | null;
};

const EMPTY_VELOCITY_STATUS: EpisodeVelocityStatus = {
  overCount: 0,
  maxRatio: 0,
  worstJoint: null,
  worstFrame: null,
  worstTimeSec: null,
};

export const computeVelocityStatusForFrames = (
  frames: RecordedFrame[],
  jointLimits: JointLimits | undefined,
  tolerance = 0.05
): EpisodeVelocityStatus => {
  if (frames.length < 2) {
    return EMPTY_VELOCITY_STATUS;
  }

  const velocityLimits = jointLimits
    ? resolveVelocityLimitEntries(jointLimits)
    : collectRecordedJointNames(frames).map((jointName) => ({
        jointName,
        velocity: OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointVelocityRadPerSec,
      }));
  if (velocityLimits.length === 0) {
    return EMPTY_VELOCITY_STATUS;
  }

  const maxRatios = new Map<string, { ratio: number; frame: number; timeSec: number }>();
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const current = frames[i];
    const dt = secondsBetweenFrames(prev, current);
    if (dt <= 0) continue;

    velocityLimits.forEach(({ jointName, velocity: limit }) => {
      const prevValue = prev.jointPositions[jointName];
      const currValue = current.jointPositions[jointName];
      if (!Number.isFinite(prevValue) || !Number.isFinite(currValue)) return;
      if (!(limit > 0)) return;

      const ratio = Math.abs(currValue - prevValue) / (limit * dt);
      const existingRatio = maxRatios.get(jointName)?.ratio ?? 0;
      if (ratio > existingRatio) {
        maxRatios.set(jointName, {
          ratio,
          frame: i,
          timeSec: current.timestamp * RECORDING_SECONDS_PER_MILLISECOND,
        });
      }
    });
  }

  let overCount = 0;
  let maxRatio = 0;
  let worstJoint: string | null = null;
  let worstFrame: number | null = null;
  let worstTimeSec: number | null = null;
  velocityLimits.forEach(({ jointName, velocity }) => {
    if (velocity <= 0) return;
    const ratioData = maxRatios.get(jointName);
    const ratio = ratioData?.ratio ?? 0;
    if (ratio > 1 + tolerance) {
      overCount += 1;
    }
    if (ratio > maxRatio) {
      maxRatio = ratio;
      worstJoint = jointName;
      worstFrame = ratioData?.frame ?? null;
      worstTimeSec = ratioData?.timeSec ?? null;
    }
  });

  return {
    overCount,
    maxRatio,
    worstJoint,
    worstFrame,
    worstTimeSec,
  };
};

export type EpisodeAccelerationStatus = EpisodeVelocityStatus;

const EMPTY_ACCELERATION_STATUS: EpisodeAccelerationStatus = {
  overCount: 0,
  maxRatio: 0,
  worstJoint: null,
  worstFrame: null,
  worstTimeSec: null,
};

const computeAccelerationStatusForFrames = (
  frames: RecordedFrame[],
  maxJointAccelerationRadPerSec2 =
    OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointAccelerationRadPerSec2,
  tolerance = 0.05
): EpisodeAccelerationStatus => {
  if (
    frames.length < 3 ||
    !Number.isFinite(maxJointAccelerationRadPerSec2) ||
    maxJointAccelerationRadPerSec2 <= 0
  ) {
    return EMPTY_ACCELERATION_STATUS;
  }

  const previousVelocityByJoint = new Map<string, number>();
  const maxRatios = new Map<string, { ratio: number; frame: number; timeSec: number }>();

  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const current = frames[i];
    const dt = secondsBetweenFrames(prev, current);
    if (dt <= 0) continue;

    const jointNames = new Set([
      ...Object.keys(prev.jointPositions),
      ...Object.keys(current.jointPositions),
    ]);
    jointNames.forEach((jointName) => {
      const prevValue = prev.jointPositions[jointName];
      const currValue = current.jointPositions[jointName];
      if (!Number.isFinite(prevValue) || !Number.isFinite(currValue)) return;

      const velocity = (currValue - prevValue) / dt;
      const previousVelocity = previousVelocityByJoint.get(jointName);
      if (previousVelocity !== undefined && Number.isFinite(previousVelocity)) {
        const acceleration = Math.abs(velocity - previousVelocity) / dt;
        const ratio = acceleration / maxJointAccelerationRadPerSec2;
        const existingRatio = maxRatios.get(jointName)?.ratio ?? 0;
        if (ratio > existingRatio) {
          maxRatios.set(jointName, {
            ratio,
            frame: i,
            timeSec: current.timestamp * RECORDING_SECONDS_PER_MILLISECOND,
          });
        }
      }
      previousVelocityByJoint.set(jointName, velocity);
    });
  }

  let overCount = 0;
  let maxRatio = 0;
  let worstJoint: string | null = null;
  let worstFrame: number | null = null;
  let worstTimeSec: number | null = null;
  maxRatios.forEach((ratioData, jointName) => {
    if (ratioData.ratio > 1 + tolerance) {
      overCount += 1;
    }
    if (ratioData.ratio > maxRatio) {
      maxRatio = ratioData.ratio;
      worstJoint = jointName;
      worstFrame = ratioData.frame;
      worstTimeSec = ratioData.timeSec;
    }
  });

  return {
    overCount,
    maxRatio,
    worstJoint,
    worstFrame,
    worstTimeSec,
  };
};

export type EpisodeMotionLimitStatus = {
  overCount: number;
  maxRatio: number;
  worstKind: "velocity" | "acceleration" | null;
  worstJoint: string | null;
  worstFrame: number | null;
  worstTimeSec: number | null;
  velocity: EpisodeVelocityStatus;
  acceleration: EpisodeAccelerationStatus;
};

export const computeMotionLimitStatusForFrames = (
  frames: RecordedFrame[],
  jointLimits: JointLimits | undefined,
  tolerance = 0.05,
  maxJointAccelerationRadPerSec2 =
    OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointAccelerationRadPerSec2
): EpisodeMotionLimitStatus => {
  const velocity = computeVelocityStatusForFrames(frames, jointLimits, tolerance);
  const acceleration = computeAccelerationStatusForFrames(
    frames,
    maxJointAccelerationRadPerSec2,
    tolerance
  );
  const accelerationIsWorst = acceleration.maxRatio > velocity.maxRatio;
  const worst = accelerationIsWorst ? acceleration : velocity;
  return {
    overCount: velocity.overCount + acceleration.overCount,
    maxRatio: Math.max(velocity.maxRatio, acceleration.maxRatio),
    worstKind:
      worst.maxRatio > 0
        ? accelerationIsWorst
          ? "acceleration"
          : "velocity"
        : null,
    worstJoint: worst.worstJoint,
    worstFrame: worst.worstFrame,
    worstTimeSec: worst.worstTimeSec,
    velocity,
    acceleration,
  };
};

export type EpisodeTimestampGapStatus = {
  overCount: number;
  maxGapMs: number;
  worstFrame: number | null;
  worstTimeSec: number | null;
};

export const computeTimestampGapStatusForFrames = (
  frames: RecordedFrame[],
  maxTimestampGapMs = OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxTimestampGapMs
): EpisodeTimestampGapStatus => {
  let overCount = 0;
  let maxGapMs = 0;
  let worstFrame: number | null = null;
  let worstTimeSec: number | null = null;

  for (let i = 1; i < frames.length; i += 1) {
    const previousTimestamp = frames[i - 1]?.timestamp;
    const currentTimestamp = frames[i]?.timestamp;
    if (!Number.isFinite(previousTimestamp) || !Number.isFinite(currentTimestamp)) {
      continue;
    }
    const gapMs = (currentTimestamp as number) - (previousTimestamp as number);
    if (!Number.isFinite(gapMs) || gapMs <= 0) {
      continue;
    }
    if (gapMs > maxGapMs) {
      maxGapMs = gapMs;
      worstFrame = i;
      worstTimeSec =
        (currentTimestamp as number) * RECORDING_SECONDS_PER_MILLISECOND;
    }
    if (gapMs > maxTimestampGapMs) {
      overCount += 1;
    }
  }

  return {
    overCount,
    maxGapMs,
    worstFrame,
    worstTimeSec,
  };
};
