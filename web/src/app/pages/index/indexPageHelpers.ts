import { WORLD_SCENE_PACKAGE_DEFAULT_VERSION } from "@/features/world-share/worldScenePackageParams";
import { INDEX_PAGE_HELPER_PARAMS } from "@/app/pages/index/indexPageHelperParams";
import type { WorldScenePublishDraft } from "@/features/world-share/WorldPublishDialog";

export const DEFAULT_WORLD_SCENE_PACKAGE_ID = INDEX_PAGE_HELPER_PARAMS.defaultWorldScenePackageId;
export const DEFAULT_WORLD_SCENE_PACKAGE_TITLE = INDEX_PAGE_HELPER_PARAMS.defaultWorldScenePackageTitle;
export const WORLD_SCENE_PACKAGE_IMPORT_ACCEPT = INDEX_PAGE_HELPER_PARAMS.worldScenePackageImportAccept;
const DEFAULT_WORLD_LAYOUT_EXPORT_NAME = INDEX_PAGE_HELPER_PARAMS.defaultWorldLayoutExportName;
const ROBOT_NAME_PATTERN = /<robot\b[^>]*\bname=["']([^"']+)["']/i;
export const toWorldRegistryRecordKey = (packageId: string, version: string) =>
  `${packageId}@${version}`;
export const IMPORT_WORLD_SCENE_URL_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldSceneUrlParam;
export const IMPORT_WORLD_SCENE_ID_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldSceneIdParam;
export const IMPORT_WORLD_SCENE_VERSION_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldSceneVersionParam;
export const IMPORT_WORLD_URL_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldUrlParam;
export const IMPORT_WORLD_ID_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldIdParam;
export const IMPORT_WORLD_VERSION_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldVersionParam;
export const IMPORT_WORLD_LAYOUT_URL_PARAM = INDEX_PAGE_HELPER_PARAMS.importWorldLayoutUrlParam;
const RECENT_WORLD_LAYOUT_LINKS_STORAGE_KEY = INDEX_PAGE_HELPER_PARAMS.recentWorldLayoutLinksStorageKey;
const MAX_RECENT_WORLD_LAYOUT_LINKS = INDEX_PAGE_HELPER_PARAMS.maxRecentWorldLayoutLinks;

export type WorldPublishTarget = "registry" | "hub";

export type WorldPublishManifestOverrides = {
  package_id: string;
  version: string;
  title: string;
  description?: string;
};

export type WorldPublishDraftPreparation =
  | {
      ok: true;
      manifestOverrides: WorldPublishManifestOverrides;
    }
  | {
      ok: false;
      errorMessage: string;
    };

export const createDefaultWorldPublishDraft = (
  robotName: string | null
): WorldScenePublishDraft => ({
  packageId: robotName || DEFAULT_WORLD_SCENE_PACKAGE_ID,
  version: WORLD_SCENE_PACKAGE_DEFAULT_VERSION,
  title: robotName || DEFAULT_WORLD_SCENE_PACKAGE_TITLE,
  description: "",
});

export const prepareWorldPublishManifestOverrides = ({
  draft,
  resolvedRobotName,
}: {
  draft: WorldScenePublishDraft;
  resolvedRobotName: string | null;
}): WorldPublishDraftPreparation => {
  const packageId = draft.packageId.trim();
  if (!packageId) {
    return {
      ok: false,
      errorMessage: "Package ID is required",
    };
  }

  const description = draft.description.trim();
  const manifestOverrides: WorldPublishManifestOverrides = {
    package_id: packageId,
    version: draft.version.trim() || WORLD_SCENE_PACKAGE_DEFAULT_VERSION,
    title: draft.title.trim() || resolvedRobotName || DEFAULT_WORLD_SCENE_PACKAGE_TITLE,
  };
  if (description) {
    manifestOverrides.description = description;
  }

  return {
    ok: true,
    manifestOverrides,
  };
};

export const toWorldPublishTargetLabel = (target: WorldPublishTarget) =>
  target === "hub" ? "URDF Star Hub" : "World Registry";

export const toWorldPublishSuccessLabel = (target: WorldPublishTarget) =>
  target === "hub" ? "Published to URDF Star" : "Published";

export const toWorldPublishFailureMessage = (target: WorldPublishTarget) =>
  target === "hub" ? "Failed to publish to URDF Star" : "Failed to publish world package";

export const parseRobotNameFromUrdf = (urdfContent: string) => {
  const match = urdfContent.match(ROBOT_NAME_PATTERN);
  return match?.[1] || null;
};

export const resolveRemoteUrdfFileUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (
    (host === "huggingface.co" || host === "www.huggingface.co" || host === "hf.co") &&
    pathParts.includes("blob")
  ) {
    parsed.pathname = `/${pathParts
      .map((part) => part === "blob" ? "resolve" : part)
      .join("/")}`;
    return parsed.toString();
  }

  if (host === "github.com" && pathParts.length >= 5 && pathParts[2] === "blob") {
    const [owner, repo, , branch, ...filePathParts] = pathParts;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePathParts.join("/")}`;
  }

  return parsed.toString();
};

export const inferRemoteUrdfFileName = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (/\.(urdf|xacro|xml)$/i.test(name)) {
      return name;
    }
  } catch {
    // Fall through to the default name.
  }
  return "robot.urdf";
};

export const toWorldLayoutFilename = (worldLayoutName: string): string => {
  const slug = worldLayoutName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || DEFAULT_WORLD_LAYOUT_EXPORT_NAME}.world-layout.json`;
};
