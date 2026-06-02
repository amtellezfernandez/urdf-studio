/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_METRICS?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_IKD_BASE_URL?: string;
  readonly VITE_IKD_WS_URL?: string;
  readonly VITE_WORLD_HUB_API_BASE_URL?: string;
  readonly VITE_WORLD_HUB_WEB_BASE_URL?: string;
  readonly VITE_DEFAULT_WORLD_LAYOUT_URL?: string;
  readonly VITE_DEMO_WORLD_LAYOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __URDF_CONFIG__: Record<string, unknown> | undefined;
