import {
  loadRobotAssetFileListFromManifestUrl,
  loadRobotAssetFileListFromManifestUrls,
  loadRobotAssetFileListProgressivelyFromManifestUrl,
  loadRobotAssetFileListProgressivelyFromManifestUrls,
  type RobotAssetManifestPreferences,
  type ProgressiveRobotAssetFileList,
} from "@/shared/robotAssets/robotAssetManifest";
import { DEMO_ROBOT_ASSET_MANIFEST_COPY } from "@/app/pages/index/demoBootstrapParams";

export type ProgressiveDemoFileList = ProgressiveRobotAssetFileList;
export type DemoRobotAssetPreferences = RobotAssetManifestPreferences;

export const loadDemoFileListFromManifestUrl = (
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<FileList> =>
  loadRobotAssetFileListFromManifestUrl(
    manifestUrl,
    fetchImpl,
    DEMO_ROBOT_ASSET_MANIFEST_COPY
  );

export const loadDemoFileListProgressivelyFromManifestUrl = (
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProgressiveDemoFileList> =>
  loadRobotAssetFileListProgressivelyFromManifestUrl(
    manifestUrl,
    fetchImpl,
    DEMO_ROBOT_ASSET_MANIFEST_COPY
  );

export const loadDemoFileListFromManifestUrls = (
  manifestUrls: readonly string[],
  fetchImpl: typeof fetch = fetch
): Promise<FileList> =>
  loadRobotAssetFileListFromManifestUrls(
    manifestUrls,
    fetchImpl,
    DEMO_ROBOT_ASSET_MANIFEST_COPY
  );

export const loadDemoFileListProgressivelyFromManifestUrls = (
  manifestUrls: readonly string[],
  fetchImpl: typeof fetch = fetch
): Promise<ProgressiveDemoFileList> =>
  loadRobotAssetFileListProgressivelyFromManifestUrls(
    manifestUrls,
    fetchImpl,
    DEMO_ROBOT_ASSET_MANIFEST_COPY
  );
