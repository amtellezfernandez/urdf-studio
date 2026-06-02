import { useCallback, useEffect, useRef } from "react";
import { IKD_APPROACH_WS_URL } from "@/shared/config/runtime";
import { IKD_APPROACH_TASK_STREAM_PARAMS } from "@/features/viewer/ikdApproachTaskParams";
import {
  IKD_APPROACH_SCHEMA_VERSION,
  type IkdApproachTaskEvent,
} from "@/features/viewer/ikdApproachTaskTypes";
import { useBackendRuntimeStore } from "@/shared/store/useBackendRuntimeStore";
import { useIkdApproachTaskStore } from "@/features/viewer/useIkdApproachTaskStore";

type UseIkdApproachTaskStreamParams = {
  enabled: boolean;
};

const isIkdApproachTaskEvent = (value: unknown): value is IkdApproachTaskEvent => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<IkdApproachTaskEvent>;
  return (
    candidate.schema_version === IKD_APPROACH_SCHEMA_VERSION &&
    typeof candidate.event_kind === "string" &&
    typeof candidate.emitted_at_ts_ns === "number"
  );
};

export const useIkdApproachTaskStream = ({
  enabled,
}: UseIkdApproachTaskStreamParams): void => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || wsRef.current) {
      return;
    }
    useIkdApproachTaskStore.getState().setConnectionStatus("connecting");
    try {
      const ws = new WebSocket(IKD_APPROACH_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        useBackendRuntimeStore.getState().markBackendsHealthy(["ikd"]);
        useIkdApproachTaskStore.getState().setConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as unknown;
          if (!isIkdApproachTaskEvent(parsed)) {
            return;
          }
          useIkdApproachTaskStore.getState().applyEvent(parsed);
        } catch {
          // Ignore malformed approach task frames.
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        useIkdApproachTaskStore.getState().setConnectionStatus("idle");
        if (enabled) {
          clearReconnect();
          reconnectTimerRef.current = setTimeout(
            () => connect(),
            IKD_APPROACH_TASK_STREAM_PARAMS.reconnectMs
          );
        }
      };

      ws.onerror = () => {
        useBackendRuntimeStore
          .getState()
          .markBackendsUnreachable(["ikd"], "IKD approach websocket error");
        useIkdApproachTaskStore
          .getState()
          .setConnectionStatus("error", "IKD approach websocket error");
      };
    } catch (error) {
      useIkdApproachTaskStore
        .getState()
        .setConnectionStatus(
          "error",
          error instanceof Error ? error.message : "Failed to connect IKD approach websocket"
        );
    }
  }, [clearReconnect, enabled]);

  useEffect(() => {
    if (!enabled) {
      clearReconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      useIkdApproachTaskStore.getState().reset();
      return;
    }

    connect();
    return () => {
      clearReconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      useIkdApproachTaskStore.getState().reset();
    };
  }, [clearReconnect, connect, enabled]);
};
