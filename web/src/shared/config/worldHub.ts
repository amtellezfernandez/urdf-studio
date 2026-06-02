const normalizeBaseUrl = (value: string | undefined): string => {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
};

const normalizeWebUrl = (value: string | undefined): string => {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
};

export const WORLD_HUB_API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_WORLD_HUB_API_BASE_URL);
export const WORLD_HUB_WEB_BASE_URL = normalizeWebUrl(import.meta.env.VITE_WORLD_HUB_WEB_BASE_URL);

export const isWorldHubConfigured = () => WORLD_HUB_API_BASE_URL.length > 0;
