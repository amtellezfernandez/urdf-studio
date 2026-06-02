export {};

declare global {
  interface WindowEventMap {
    "viewer3d:frameUpdate": CustomEvent<unknown>;
    "jointVisibilityToggle": CustomEvent<unknown>;
    "episodeViewer:jointVisibilityChange": CustomEvent<unknown>;
  }
}
