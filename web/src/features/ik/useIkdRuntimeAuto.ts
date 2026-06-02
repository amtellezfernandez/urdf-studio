import { useEffect, useRef } from "react";
import { API_BASE_URL } from "@/shared/config/api";
import { IKD_RUNTIME_CONFIG } from "@/shared/config/runtime";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { guardedFetch } from "@/shared/lib/backendGuard";

type UseIkdRuntimeAutoParams = {
  selectedSolverId: string;
};

export const useIkdRuntimeAuto = ({ selectedSolverId }: UseIkdRuntimeAutoParams) => {
  const lastDesiredStateRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!IKD_RUNTIME_CONFIG.enabled || !IKD_RUNTIME_CONFIG.useForDrag || !FEATURE_GATES.coreApi.enabled) {
      return;
    }

    const shouldRun = selectedSolverId !== "ik-js";
    if (lastDesiredStateRef.current === shouldRun) {
      return;
    }
    lastDesiredStateRef.current = shouldRun;

    const controller = new AbortController();
    const endpoint = shouldRun ? "start" : "stop";
    void guardedFetch(
      `${API_BASE_URL}/ikd/runtime/${endpoint}`,
      {
        method: "POST",
        signal: controller.signal,
      },
      {
        context: `IKD runtime ${endpoint}`,
        requiredBackends: FEATURE_GATES.coreApi.requiredBackends,
      }
    ).catch(() => {
      // Ignore lifecycle sync failures and keep local solver path available.
    });

    return () => {
      controller.abort();
    };
  }, [selectedSolverId]);
};
