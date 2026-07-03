import { hasExplicitWorldImportRequest } from "@/features/world-share/defaultSceneAutoLoadPolicy";
import {
  IMPORT_WORLD_ID_PARAM,
  IMPORT_WORLD_LAYOUT_URL_PARAM,
  IMPORT_WORLD_SCENE_ID_PARAM,
  IMPORT_WORLD_SCENE_URL_PARAM,
  IMPORT_WORLD_SCENE_VERSION_PARAM,
  IMPORT_WORLD_URL_PARAM,
  IMPORT_WORLD_VERSION_PARAM,
} from "@/app/pages/index/indexPageHelpers";

export type ThumbnailParams = {
  demo: boolean;
  enabled: boolean;
  repoUrl: string;
  urdfTarget: string;
};

export type WorldImportParams = {
  importUrl: string;
  packageId: string;
  version: string;
  worldLayoutImportUrl: string;
};

export type IluLaunchParams = {
  assemblyId: string;
  calibrate: boolean;
  focusJoint: string;
  sessionId: string;
};

export type IndexPageQueryParams = {
  hasExplicitWorldImport: boolean;
  ilu: IluLaunchParams;
  thumbnail: ThumbnailParams;
  worldImport: WorldImportParams;
};

export const EMPTY_THUMBNAIL_PARAMS: ThumbnailParams = {
  demo: false,
  enabled: false,
  repoUrl: "",
  urdfTarget: "",
};

export const EMPTY_WORLD_IMPORT_PARAMS: WorldImportParams = {
  importUrl: "",
  packageId: "",
  version: "",
  worldLayoutImportUrl: "",
};

export const EMPTY_ILU_LAUNCH_PARAMS: IluLaunchParams = {
  assemblyId: "",
  calibrate: false,
  focusJoint: "",
  sessionId: "",
};

export const parseIndexPageQueryParams = (search: string): IndexPageQueryParams => {
  const params = new URLSearchParams(search);
  const worldImport: WorldImportParams = {
    importUrl:
      params.get(IMPORT_WORLD_SCENE_URL_PARAM)?.trim() ||
      params.get(IMPORT_WORLD_URL_PARAM)?.trim() ||
      "",
    packageId:
      params.get(IMPORT_WORLD_SCENE_ID_PARAM)?.trim() ||
      params.get(IMPORT_WORLD_ID_PARAM)?.trim() ||
      "",
    version:
      params.get(IMPORT_WORLD_SCENE_VERSION_PARAM)?.trim() ||
      params.get(IMPORT_WORLD_VERSION_PARAM)?.trim() ||
      "",
    worldLayoutImportUrl: params.get(IMPORT_WORLD_LAYOUT_URL_PARAM)?.trim() || "",
  };

  return {
    thumbnail: {
      demo: params.get("demo") === "1",
      enabled: params.get("thumbnail") === "1",
      repoUrl: params.get("github") || params.get("repo") || "",
      urdfTarget: params.get("urdf") || "",
    },
    worldImport,
    ilu: {
      assemblyId: params.get("ilu_assembly")?.trim() || "",
      calibrate: params.get("ilu_calibrate") === "1",
      focusJoint: params.get("ilu_focus_joint")?.trim() || "",
      sessionId: params.get("ilu_session")?.trim() || "",
    },
    hasExplicitWorldImport: hasExplicitWorldImportRequest(
      worldImport.importUrl,
      worldImport.packageId,
      worldImport.version
    ),
  };
};
