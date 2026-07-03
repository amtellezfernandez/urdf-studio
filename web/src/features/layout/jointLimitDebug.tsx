import { cn } from "@/shared/lib/utils";
import {
  getLimitAttributeInputTitle,
  type LimitAttributeDebugState,
} from "@/features/layout/jointLimitDebugState";

export const LimitAttributeStatusBadge = ({
  attributeName,
  state,
}: {
  attributeName: "effort" | "velocity";
  state: LimitAttributeDebugState;
}) => {
  if (state.status === "set" || state.status === "missing") {
    return null;
  }

  return (
    <span
      className={cn(
        "rounded-sm border px-0.5 text-[7px] font-medium leading-3",
        state.status === "invalid"
          ? "border-red-400/35 bg-red-500/10 text-red-200"
          : "border-amber-400/35 bg-amber-500/10 text-amber-200"
      )}
      title={getLimitAttributeInputTitle(attributeName, state)}
    >
      {state.status === "invalid" ? "bad" : "zero"}
    </span>
  );
};
