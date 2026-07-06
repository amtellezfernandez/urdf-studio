import { FEATURE_GATES } from "@/shared/config/featureGates";
import {
  WORLD_HUB_API_BASE_URL,
  isWorldHubConfigured,
} from "@/shared/config/worldHub";
import type {
  WorldScenePackageManifest,
  WorldSceneRegistryEnvelope,
} from "@/features/world-share/worldScenePackageTypes";
import { toWorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageBuilder";
import {
  createWorldScenePackageClient,
  type WorldScenePackageListQuery,
} from "@/features/world-share/worldScenePackageHttp";

const worldHubClient = createWorldScenePackageClient(
  WORLD_HUB_API_BASE_URL,
  FEATURE_GATES.worldsHubRegistry.requiredBackends,
  "URDF Star Hub operation"
);

export const isWorldHubEnabled = () => isWorldHubConfigured();

export const publishWorldScenePackageToHub = (
  manifest: WorldScenePackageManifest | WorldSceneRegistryEnvelope
) =>
  worldHubClient.publishManifest(
    "world" in manifest ? manifest : toWorldSceneRegistryEnvelope(manifest)
  );

export const listWorldScenePackagesFromHub = (query?: WorldScenePackageListQuery) =>
  worldHubClient.listPackages(query);

export const getWorldScenePackageVersionFromHub = (packageId: string, version: string) =>
  worldHubClient.getPackageVersion(packageId, version);

export const getWorldHubCapabilities = () => worldHubClient.getCapabilities();

export const getWorldScenePackageVersionHubUrl = (packageId: string, version: string) =>
  worldHubClient.getVersionUrl(packageId, version);
