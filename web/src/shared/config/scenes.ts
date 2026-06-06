const trimWorldLayoutUrl = (value: string | undefined): string => value?.trim() || "";

const toBundledWorldLayoutUrl = (relativePath: string): string =>
  `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, "")}`;

export const DEFAULT_WORLD_LAYOUT_URL =
  trimWorldLayoutUrl(import.meta.env.VITE_DEFAULT_WORLD_LAYOUT_URL) ||
  toBundledWorldLayoutUrl("world-layouts/hk-cargo-port.world-layout.json");

const DEMO_WORLD_LAYOUT_URL =
  trimWorldLayoutUrl(import.meta.env.VITE_DEMO_WORLD_LAYOUT_URL) ||
  DEFAULT_WORLD_LAYOUT_URL;
