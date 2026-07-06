import { API_BASE_URL } from "@/shared/config/api";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import {
  createWorldScenePackageClient,
  type WorldScenePackageListQuery,
} from "@/features/world-share/worldScenePackageHttp";

const localWorldRegistryClient = createWorldScenePackageClient(
  API_BASE_URL,
  FEATURE_GATES.worldsRegistry.requiredBackends,
  "World package operation"
);

export const validateWorldScenePackageManifest = (manifest: WorldSceneRegistryEnvelope) =>
  localWorldRegistryClient.validateManifest(manifest);

export const publishWorldScenePackageManifest = (manifest: WorldSceneRegistryEnvelope) =>
  localWorldRegistryClient.publishManifest(manifest);

export const listWorldScenePackages = (query?: WorldScenePackageListQuery) =>
  localWorldRegistryClient.listPackages(query);

export const getWorldScenePackageVersion = (packageId: string, version: string) =>
  localWorldRegistryClient.getPackageVersion(packageId, version);

export const getWorldRegistryCapabilities = () => localWorldRegistryClient.getCapabilities();

export const getWorldScenePackageVersionUrl = (packageId: string, version: string) =>
  localWorldRegistryClient.getVersionUrl(packageId, version);
