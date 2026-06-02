import { DEMO_MODE } from "@/shared/config/demo";
import { IKD_RUNTIME_CONFIG } from "@/shared/config/runtime";
import { isWorldHubConfigured } from "@/shared/config/worldHub";

export type BackendId = "core-api" | "ikd" | "world-hub-api";
export type BackendIdList = readonly BackendId[];
export type BackendMap<T> = Record<BackendId, T>;

type BackendDescriptor = {
  id: BackendId;
  label: string;
  available: boolean;
  unavailableReason: string;
};

const BACKENDS: BackendMap<BackendDescriptor> = {
  "core-api": {
    id: "core-api",
    label: "Core API",
    available: !DEMO_MODE,
    unavailableReason: "Core API is unavailable in demo mode.",
  },
  ikd: {
    id: "ikd",
    label: "IKD Service",
    available: !DEMO_MODE && IKD_RUNTIME_CONFIG.enabled === true,
    unavailableReason:
      IKD_RUNTIME_CONFIG.enabled === true
        ? "IKD Service is unavailable in demo mode."
        : "IKD Service is disabled in runtime config.",
  },
  "world-hub-api": {
    id: "world-hub-api",
    label: "URDF Star Hub API",
    available: isWorldHubConfigured(),
    unavailableReason:
      "URDF Star Hub API is not configured. Set VITE_WORLD_HUB_API_BASE_URL.",
  },
};

const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

export const getBackendById = (id: BackendId): BackendDescriptor => BACKENDS[id];

export const listUnavailableBackends = (required: BackendIdList): BackendDescriptor[] => {
  const ids = unique(required);
  return ids
    .map((id) => BACKENDS[id])
    .filter((backend) => !backend.available);
};

export const formatBackendNames = (required: BackendIdList): string =>
  unique(required)
    .map((id) => BACKENDS[id].label)
    .join(" + ");

export const formatRuntimeUnavailableBackends = (required: BackendIdList): string => {
  const names = formatBackendNames(required);
  return names ? `backend unreachable: ${names}` : "backend unreachable";
};

export const buildRuntimeUnavailableBackendsReason = (required: BackendIdList): string => {
  const names = formatBackendNames(required);
  if (!names) return "Required backend is unreachable. Check backend services and retry.";
  const verb = unique(required).length === 1 ? "is" : "are";
  return `${names} ${verb} unreachable. Check backend services and retry.`;
};

export const formatUnavailableBackends = (required: BackendIdList): string => {
  const unavailable = listUnavailableBackends(required);
  if (unavailable.length === 0) return "";
  return `backend unavailable: ${unavailable.map((backend) => backend.label).join(" + ")}`;
};

export const buildBackendUnavailableReason = (required: BackendIdList): string => {
  const unavailable = listUnavailableBackends(required);
  if (unavailable.length === 0) return "";
  return unavailable.map((backend) => backend.unavailableReason).join(" ");
};

export const createBackendUnavailableError = (
  required: BackendIdList,
  context?: string
): Error => {
  const unavailableText = formatUnavailableBackends(required);
  const reason = buildBackendUnavailableReason(required);
  const prefix = context ? `${context}: ` : "";
  return new Error(`${prefix}${unavailableText}.${reason ? ` ${reason}` : ""}`.trim());
};

export const createBackendRuntimeUnavailableError = (
  required: BackendIdList,
  context?: string
): Error => {
  const unavailableText = formatRuntimeUnavailableBackends(required);
  const reason = buildRuntimeUnavailableBackendsReason(required);
  const prefix = context ? `${context}: ` : "";
  return new Error(`${prefix}${unavailableText}.${reason ? ` ${reason}` : ""}`.trim());
};

export const assertBackendsAvailable = (required: BackendIdList, context?: string): void => {
  const unavailable = listUnavailableBackends(required);
  if (unavailable.length === 0) return;
  throw createBackendUnavailableError(required, context);
};
