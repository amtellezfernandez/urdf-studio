import { THUMBNAIL_RENDER_STATE_PARAMS } from "@/app/pages/index/thumbnailRenderStateParams";

export type ThumbnailRenderPhase = "idle" | "loading" | "framing" | "ready" | "error";

export type ThumbnailRenderState = {
  phase: ThumbnailRenderPhase;
  ready: boolean;
  hasBoundingBox: boolean;
  cameraApplied: boolean;
  error: string | null;
  cameraPosition: [number, number, number] | null;
  cameraTarget: [number, number, number] | null;
};

const THUMB_READY_ATTRIBUTE = THUMBNAIL_RENDER_STATE_PARAMS.readyAttribute;

const DEFAULT_THUMBNAIL_RENDER_STATE: ThumbnailRenderState = {
  phase: "idle",
  ready: false,
  hasBoundingBox: false,
  cameraApplied: false,
  error: null,
  cameraPosition: null,
  cameraTarget: null,
};

const THUMBNAIL_RENDER_PHASES: ReadonlySet<ThumbnailRenderPhase> = new Set([
  "idle",
  "loading",
  "framing",
  "ready",
  "error",
]);

const normalizeVector = (value: unknown): [number, number, number] | null => {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    return null;
  }
  return [value[0], value[1], value[2]];
};

const normalizeState = (value: Partial<ThumbnailRenderState> | null | undefined): ThumbnailRenderState => {
  const phase = value?.phase;
  return {
    phase:
      typeof phase === "string" && THUMBNAIL_RENDER_PHASES.has(phase as ThumbnailRenderPhase)
        ? (phase as ThumbnailRenderPhase)
        : DEFAULT_THUMBNAIL_RENDER_STATE.phase,
    ready: value?.ready === true,
    hasBoundingBox: value?.hasBoundingBox === true,
    cameraApplied: value?.cameraApplied === true,
    error: typeof value?.error === "string" && value.error.trim() ? value.error : null,
    cameraPosition: normalizeVector(value?.cameraPosition),
    cameraTarget: normalizeVector(value?.cameraTarget),
  };
};

export const readThumbnailRenderState = (): ThumbnailRenderState => {
  if (typeof window === "undefined") {
    return { ...DEFAULT_THUMBNAIL_RENDER_STATE };
  }
  return normalizeState(window.__URDF_GALLERY_RENDER_STATE__);
};

export const writeThumbnailRenderState = (
  patch: Partial<ThumbnailRenderState>,
  options?: { reset?: boolean }
): ThumbnailRenderState => {
  const nextState = normalizeState({
    ...(options?.reset ? DEFAULT_THUMBNAIL_RENDER_STATE : readThumbnailRenderState()),
    ...patch,
  });
  if (typeof window === "undefined") {
    return nextState;
  }
  window.__URDF_GALLERY_RENDER_STATE__ = nextState;
  window.__URDF_THUMB_READY__ = nextState.ready;
  window.__URDF_THUMB_ERROR__ = nextState.error ?? undefined;
  if (typeof document !== "undefined" && document.body) {
    if (nextState.phase === "idle" && !nextState.ready && !nextState.error) {
      document.body.removeAttribute(THUMB_READY_ATTRIBUTE);
    } else {
      document.body.setAttribute(THUMB_READY_ATTRIBUTE, nextState.ready ? "1" : "0");
    }
  }
  return nextState;
};
