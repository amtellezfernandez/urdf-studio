import {
  isRuntimeDemoEnabled,
  RUNTIME_DEMO_QUERY_PARAM,
  RUNTIME_DEMO_QUERY_VALUE,
  RUNTIME_ROBOT_PREVIEW_NAME,
  RUNTIME_ROBOT_PREVIEW_QUERY,
} from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";
import {
  DIRECT_RUNTIME_DEMO_COMMAND_MESSAGE_TYPE,
  isSelectRuntimeObjectMessage,
  RUN_RUNTIME_DEMO_SCAN_MESSAGE_TYPE,
  SET_RUNTIME_DEMO_RESTRICTED_AREA_MESSAGE_TYPE,
  SET_RUNTIME_DEMO_SPEED_MESSAGE_TYPE,
  SET_RUNTIME_DEMO_TRAJECTORY_MESSAGE_TYPE,
} from "@/shared/contracts/previewBridge";
import { useEffect, useRef } from "react";

const resolveRuntimeRobotPreviewUrl = () => {
  if (typeof window === "undefined") {
    return RUNTIME_ROBOT_PREVIEW_QUERY;
  }
  const url = new URL(window.location.href);
  const searchParams = new URLSearchParams(RUNTIME_ROBOT_PREVIEW_QUERY.replace(/^\?/, ""));
  if (isRuntimeDemoEnabled(window.location.search)) {
    searchParams.set(RUNTIME_DEMO_QUERY_PARAM, RUNTIME_DEMO_QUERY_VALUE);
  }
  url.search = `?${searchParams.toString()}`;
  url.hash = "";
  return url.toString();
};

export const RuntimeRobotPreview = () => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeSrcRef = useRef(resolveRuntimeRobotPreviewUrl());

  useEffect(() => {
    const onRuntimeDemoScan = () => {
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow) {
        return;
      }
      const requestId = String(Date.now());
      contentWindow.postMessage(
        {
          type: RUN_RUNTIME_DEMO_SCAN_MESSAGE_TYPE,
          requestId,
        },
        window.location.origin
      );
    };
    const onRuntimeDemoTrajectory = (event: Event) => {
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow || !(event instanceof CustomEvent)) {
        return;
      }
      const detail = (event.detail ?? {}) as {
        fromLabel?: string | null;
        toLabel?: string | null;
      };
      contentWindow.postMessage(
        {
          type: SET_RUNTIME_DEMO_TRAJECTORY_MESSAGE_TYPE,
          requestId: String(Date.now()),
          fromLabel: detail.fromLabel ?? null,
          toLabel: detail.toLabel ?? null,
        },
        window.location.origin
      );
    };
    const onRuntimeDemoRestrictedArea = (event: Event) => {
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow || !(event instanceof CustomEvent)) {
        return;
      }
      const detail = (event.detail ?? {}) as {
        areaIds?: string[];
      };
      contentWindow.postMessage(
        {
          type: SET_RUNTIME_DEMO_RESTRICTED_AREA_MESSAGE_TYPE,
          requestId: String(Date.now()),
          areaIds: Array.isArray(detail.areaIds) ? detail.areaIds : [],
        },
        window.location.origin
      );
    };
    const onRuntimeDemoSpeed = (event: Event) => {
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow || !(event instanceof CustomEvent)) {
        return;
      }
      const detail = (event.detail ?? {}) as {
        speedMode?: "slow" | "normal" | "fast";
      };
      contentWindow.postMessage(
        {
          type: SET_RUNTIME_DEMO_SPEED_MESSAGE_TYPE,
          requestId: String(Date.now()),
          speedMode: detail.speedMode ?? "normal",
        },
        window.location.origin
      );
    };
    const onRuntimeDemoDirectCommand = (event: Event) => {
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow || !(event instanceof CustomEvent)) {
        return;
      }
      const detail = (event.detail ?? {}) as {
        command?: "move" | "rotate" | "stop" | "status";
        xVel?: number;
        yVel?: number;
        durationS?: number;
        degrees?: number;
        thetaVel?: number;
      };
      contentWindow.postMessage(
        {
          type: DIRECT_RUNTIME_DEMO_COMMAND_MESSAGE_TYPE,
          requestId: String(Date.now()),
          command: detail.command,
          xVel: detail.xVel,
          yVel: detail.yVel,
          durationS: detail.durationS,
          degrees: detail.degrees,
          thetaVel: detail.thetaVel,
        },
        window.location.origin
      );
    };
    window.addEventListener("urdfstudio:runtime-demo-scan", onRuntimeDemoScan);
    window.addEventListener("urdfstudio:runtime-demo-trajectory", onRuntimeDemoTrajectory);
    window.addEventListener(
      "urdfstudio:runtime-demo-restricted-area",
      onRuntimeDemoRestrictedArea
    );
    window.addEventListener("urdfstudio:runtime-demo-speed", onRuntimeDemoSpeed);
    window.addEventListener("urdfstudio:runtime-demo-direct-command", onRuntimeDemoDirectCommand);
    return () => {
      window.removeEventListener("urdfstudio:runtime-demo-scan", onRuntimeDemoScan);
      window.removeEventListener("urdfstudio:runtime-demo-trajectory", onRuntimeDemoTrajectory);
      window.removeEventListener(
        "urdfstudio:runtime-demo-restricted-area",
        onRuntimeDemoRestrictedArea
      );
      window.removeEventListener("urdfstudio:runtime-demo-speed", onRuntimeDemoSpeed);
      window.removeEventListener("urdfstudio:runtime-demo-direct-command", onRuntimeDemoDirectCommand);
    };
  }, []);

  useEffect(() => {
    const onIframeMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!isSelectRuntimeObjectMessage(event.data)) {
        return;
      }
      const label = event.data.label?.trim();
      if (!label) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-demo-trajectory", {
          detail: { fromLabel: null, toLabel: label },
        })
      );
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-object-selected", {
          detail: { label },
        })
      );
    };
    window.addEventListener("message", onIframeMessage);
    return () => {
      window.removeEventListener("message", onIframeMessage);
    };
  }, []);

  return (
    <div className="h-full w-full bg-background">
      <iframe
        ref={iframeRef}
        title={`${RUNTIME_ROBOT_PREVIEW_NAME} runtime preview`}
        src={iframeSrcRef.current}
        className="h-full w-full border-0 bg-background"
        loading="eager"
      />
    </div>
  );
};
