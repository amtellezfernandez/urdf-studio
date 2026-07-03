export {};

declare global {
  interface WindowEventMap {
    "viewer3d:frameUpdate": CustomEvent<unknown>;
  }
}
