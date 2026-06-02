import { useEffect, useState } from "react";

import type { RobotBasePose } from "@/shared/types/feature";
import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { RUNTIME_PREVIEW_BUTTERCLAW_POSE_POLL_INTERVAL_MS } from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";

type ButterClawRuntimePoseResponse = {
  source_path: string;
  pose: {
    ts: number;
    x: number;
    y: number;
    yaw_deg: number;
  } | null;
};

const BUTTERCLAW_RUNTIME_POSE_ENDPOINT =
  `${API_BASE_URL}/runtime/sessions/integrations/butterclaw/pose`;
const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

const toRobotBasePose = (
  pose: NonNullable<ButterClawRuntimePoseResponse["pose"]>
): RobotBasePose => {
  const yawRad = (pose.yaw_deg * Math.PI) / 180;
  return {
    position: {
      x: pose.x,
      y: pose.y,
      z: 0,
    },
    quaternion: {
      x: 0,
      y: 0,
      z: Math.sin(yawRad * 0.5),
      w: Math.cos(yawRad * 0.5),
    },
  };
};

export const useButterClawRuntimePose = ({
  enabled,
}: {
  enabled: boolean;
}): RobotBasePose | null => {
  const [pose, setPose] = useState<RobotBasePose | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPose(null);
      return;
    }

    let disposed = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        const response = await guardedFetch(BUTTERCLAW_RUNTIME_POSE_ENDPOINT, undefined, {
          ...CORE_API_OPTIONS,
          context: "ButterClaw runtime pose",
        });
        if (!response.ok) {
          throw new Error(`ButterClaw runtime pose request failed: ${response.status}`);
        }
        const payload = (await response.json()) as ButterClawRuntimePoseResponse;
        if (!disposed) {
          setPose(payload.pose ? toRobotBasePose(payload.pose) : null);
        }
      } catch {
        if (!disposed) {
          setPose(null);
        }
      } finally {
        if (!disposed) {
          timeoutId = window.setTimeout(
            poll,
            RUNTIME_PREVIEW_BUTTERCLAW_POSE_POLL_INTERVAL_MS
          );
        }
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [enabled]);

  return pose;
};
