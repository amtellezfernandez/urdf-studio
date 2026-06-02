import { useMemo } from "react";
import {
  EMPTY_ILU_LAUNCH_PARAMS,
  EMPTY_THUMBNAIL_PARAMS,
  EMPTY_WORLD_IMPORT_PARAMS,
  parseIndexPageQueryParams,
  type ThumbnailParams,
  type WorldImportParams,
} from "@/app/pages/index/indexPageParams";

export type { ThumbnailParams, WorldImportParams } from "@/app/pages/index/indexPageParams";

export const useIndexPageParams = () => {
  const parsedParams = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        hasExplicitWorldImport: false,
        ilu: EMPTY_ILU_LAUNCH_PARAMS,
        thumbnail: EMPTY_THUMBNAIL_PARAMS,
        worldImport: EMPTY_WORLD_IMPORT_PARAMS,
      };
    }
    return parseIndexPageQueryParams(window.location.search);
  }, []);

  const thumbnailParams: ThumbnailParams = parsedParams.thumbnail;
  const worldImportParams: WorldImportParams = parsedParams.worldImport;

  return {
    hasExplicitWorldImport: parsedParams.hasExplicitWorldImport,
    iluAssemblyParam: parsedParams.ilu.assemblyId,
    iluCalibrateParam: parsedParams.ilu.calibrate,
    iluFocusJointParam: parsedParams.ilu.focusJoint,
    iluSessionParam: parsedParams.ilu.sessionId,
    thumbnailParams,
    worldImportParams,
  };
};
