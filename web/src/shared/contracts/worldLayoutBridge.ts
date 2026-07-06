import { isRecord } from "@/shared/lib/records";

const APPLY_WORLD_LAYOUT_MESSAGE_TYPE = "urdf-star:apply-world-layout-url";
export const APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE = "urdf-star:world-layout-apply-result";

export type ApplyWorldLayoutMessage = {
  type: typeof APPLY_WORLD_LAYOUT_MESSAGE_TYPE;
  requestId?: string;
  worldLayoutUrl?: string;
};

export const isApplyWorldLayoutMessage = (value: unknown): value is ApplyWorldLayoutMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== APPLY_WORLD_LAYOUT_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.worldLayoutUrl != null && typeof value.worldLayoutUrl !== "string") return false;
  return true;
};
