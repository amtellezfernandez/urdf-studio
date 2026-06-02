export {};

declare global {
  type ThumbnailRenderStateSnapshot = {
    phase: "idle" | "loading" | "framing" | "ready" | "error";
    ready: boolean;
    hasBoundingBox: boolean;
    cameraApplied: boolean;
    error: string | null;
    cameraPosition: [number, number, number] | null;
    cameraTarget: [number, number, number] | null;
  };

  interface Window {
    __URDF_THUMB_READY__?: boolean;
    __URDF_THUMB_ERROR__?: string;
    __URDF_GALLERY_RENDER_STATE__?: ThumbnailRenderStateSnapshot;
  }
}
