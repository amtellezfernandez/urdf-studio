import { API_BASE_URL } from "@/shared/config/api";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import type {
  WorldScenePackageManifest,
  WorldSceneRegistryEnvelope,
} from "@/features/world-share/worldScenePackageTypes";
import { toWorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageBuilder";
import {
  createWorldScenePackageClient,
  type WorldScenePackageListQuery,
} from "@/features/world-share/worldScenePackageHttp";

const localWorldRegistryClient = createWorldScenePackageClient(
  API_BASE_URL,
  FEATURE_GATES.worldsRegistry.requiredBackends,
  "World package operation"
);

export const validateWorldScenePackageManifest = (
  manifest: WorldScenePackageManifest | WorldSceneRegistryEnvelope
) =>
  localWorldRegistryClient.validateManifest(
    "world" in manifest ? manifest : toWorldSceneRegistryEnvelope(manifest)
  );

export const publishWorldScenePackageManifest = (
  manifest: WorldScenePackageManifest | WorldSceneRegistryEnvelope
) =>
  localWorldRegistryClient.publishManifest(
    "world" in manifest ? manifest : toWorldSceneRegistryEnvelope(manifest)
  );

export const listWorldScenePackages = (query?: WorldScenePackageListQuery) =>
  localWorldRegistryClient.listPackages(query);

export const getWorldScenePackageVersion = (packageId: string, version: string) =>
  localWorldRegistryClient.getPackageVersion(packageId, version);

export const getWorldRegistryCapabilities = () => localWorldRegistryClient.getCapabilities();

export const getWorldScenePackageVersionUrl = (packageId: string, version: string) =>
  localWorldRegistryClient.getVersionUrl(packageId, version);
