const trimWorldLayoutUrl = (value: string | undefined): string => value?.trim() || "";

const toBundledWorldLayoutUrl = (relativePath: string): string =>
  `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, "")}`;

export const HK_PORT_WORLD_PACKAGE_URL =
  trimWorldLayoutUrl(import.meta.env.VITE_HK_PORT_WORLD_PACKAGE_URL) ||
  toBundledWorldLayoutUrl("world-layouts/world-labs-hk-port.world-package.json");

export const DEFAULT_WORLD_LAYOUT_URL =
  trimWorldLayoutUrl(import.meta.env.VITE_DEFAULT_WORLD_LAYOUT_URL) ||
  HK_PORT_WORLD_PACKAGE_URL;

const DEMO_WORLD_LAYOUT_URL =
  trimWorldLayoutUrl(import.meta.env.VITE_DEMO_WORLD_LAYOUT_URL) ||
  DEFAULT_WORLD_LAYOUT_URL;
