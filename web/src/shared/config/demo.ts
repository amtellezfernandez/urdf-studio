export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
export const DEMO_AUTOLOAD = import.meta.env.VITE_DEMO_AUTOLOAD !== "false";
export const DEMO_LOCAL_MANIFEST_URL = `${import.meta.env.BASE_URL}demo/manifest.json`;
export const DEMO_MANIFEST_URL =
  import.meta.env.VITE_DEMO_MANIFEST_URL ?? DEMO_LOCAL_MANIFEST_URL;
