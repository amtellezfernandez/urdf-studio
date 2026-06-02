import type { Dispatch, SetStateAction } from "react";
import type { OriginData } from "@/shared/lib/urdfBrowser";
import { isSafeMeshPath, normalizeMeshPath } from "@/shared/lib/urdfBrowser";
import { updateVector3Value } from "@/features/urdf/editor/link-editor/sizeUtils";

export const INVALID_MESH_PATH_MESSAGE =
  "Invalid mesh path. Avoid parent directory segments.";

export const getNextGeometryParams = (
  currentParams: Record<string, string>,
  key: string,
  value: string
): { errorMessage?: string; nextParams: Record<string, string> } => {
  if (key !== "filename") {
    return {
      nextParams: { ...currentParams, [key]: value },
    };
  }

  const normalizedPath = normalizeMeshPath(value);
  if (normalizedPath && !isSafeMeshPath(normalizedPath)) {
    return {
      errorMessage: INVALID_MESH_PATH_MESSAGE,
      nextParams: currentParams,
    };
  }

  return {
    nextParams: { ...currentParams, [key]: normalizedPath },
  };
};

export const getNextOrigin = (
  origin: OriginData,
  field: "xyz" | "rpy",
  index: number,
  value: number
): OriginData => ({
  ...origin,
  [field]: updateVector3Value(origin[field], index, value),
});

export const createGeometryParamChangeHandler = (
  geometryParams: Record<string, string>,
  setGeometryParams: Dispatch<SetStateAction<Record<string, string>>>,
  scheduleUpdate: () => void,
  options: {
    onInvalidPath?: (message: string) => void;
    onBeforeSchedule?: () => void;
  } = {}
) => {
  return (key: string, value: string) => {
    const { errorMessage, nextParams } = getNextGeometryParams(geometryParams, key, value);
    if (errorMessage) {
      options.onInvalidPath?.(errorMessage);
      return;
    }
    setGeometryParams(nextParams);
    options.onBeforeSchedule?.();
    scheduleUpdate();
  };
};

export const createOriginChangeHandler = (
  setOrigin: Dispatch<SetStateAction<OriginData>>,
  scheduleUpdate: () => void,
  onBeforeSchedule?: () => void
) => {
  return (field: "xyz" | "rpy", index: number, value: number) => {
    setOrigin((previousOrigin) => getNextOrigin(previousOrigin, field, index, value));
    onBeforeSchedule?.();
    scheduleUpdate();
  };
};
