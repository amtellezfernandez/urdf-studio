import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IKD_BASE_URL, IKD_WS_URL } from "@/shared/config/runtime";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import type {
  NativeModelLoadAck,
  NativeModelLoadRequest,
  NativeTargetAck,
  NativeTargetRequest,
  NativeTelemetryFrame,
} from "../contracts/nativeIkTypes";

type UseNativeTeleopParams = {
  enabled: boolean;
};

const WS_RECONNECT_MS = 1200;

export const useNativeTeleop = ({ enabled }: UseNativeTeleopParams) => {
  const ikdGate = FEATURE_GATES.ikdNativeTeleop;
  const [connected, setConnected] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [lastTelemetry, setLastTelemetry] = useState<NativeTelemetryFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelKeyRef = useRef<string | null>(null);
  const targetInFlightRef = useRef(false);
  const targetQueuedRef = useRef<NativeTargetRequest | null>(null);

  const active = enabled && ikdGate.enabled;

  const clearReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (!active || wsRef.current) {
      return;
    }

    try {
      const ws = new WebSocket(IKD_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as NativeTelemetryFrame;
          if (parsed?.schema_version !== "1") {
            return;
          }
          setLastTelemetry(parsed);
        } catch {
          // Ignore malformed telemetry frames.
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        setModelReady(false);
        modelKeyRef.current = null;
        if (active) {
          clearReconnect();
          reconnectTimerRef.current = setTimeout(() => connect(), WS_RECONNECT_MS);
        }
      };

      ws.onerror = () => {
        setError("IKD websocket error");
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect IKD websocket");
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      clearReconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setModelReady(false);
      setLastTelemetry(null);
      modelKeyRef.current = null;
      return;
    }

    connect();
    return () => {
      clearReconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setModelReady(false);
    };
  }, [active, connect]);

  const sendTarget = useCallback(async (target: NativeTargetRequest): Promise<NativeTargetAck> => {
    const response = await guardedFetch(`${IKD_BASE_URL}/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    }, {
      requiredBackends: ikdGate.requiredBackends,
      context: "IKD target push",
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = await response.json();
        detail = data?.message || data?.detail || detail;
      } catch {
        // Preserve the last browser status text.
      }
      throw new Error(`IKD target rejected: ${detail}`);
    }

    return (await response.json()) as NativeTargetAck;
  }, [ikdGate.requiredBackends]);

  const flushLatestTarget = useCallback(async () => {
    if (targetInFlightRef.current) {
      return;
    }
    const next = targetQueuedRef.current;
    if (!next) {
      return;
    }
    targetQueuedRef.current = null;
    targetInFlightRef.current = true;
    try {
      await sendTarget(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "IKD target push failed");
    } finally {
      targetInFlightRef.current = false;
      if (targetQueuedRef.current) {
        void flushLatestTarget();
      }
    }
  }, [sendTarget]);

  const sendTargetLatest = useCallback(
    (target: NativeTargetRequest) => {
      if (!active || !connected || !modelReady) {
        return false;
      }
      targetQueuedRef.current = target;
      void flushLatestTarget();
      return true;
    },
    [active, connected, modelReady, flushLatestTarget]
  );

  const ensureModel = useCallback(
    async (model: { urdfXml: string; targetLink: string; seedJointValues: Record<string, number> }) => {
      if (!active) {
        throw new Error(
          ikdGate.enabled
            ? "IKD native mode disabled"
            : `${ikdGate.unavailableSuffix}. ${ikdGate.unavailableReason}`
        );
      }
      const modelKey = `${model.targetLink}:${model.urdfXml.length}`;
      if (modelReady && modelKeyRef.current === modelKey) {
        return;
      }
      setModelReady(false);
      modelKeyRef.current = null;

      const payload: NativeModelLoadRequest = {
        schema_version: "1",
        urdf_xml: model.urdfXml,
        target_link: model.targetLink,
        seed_joint_values_rad: model.seedJointValues,
      };

      const response = await guardedFetch(`${IKD_BASE_URL}/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, {
        requiredBackends: ikdGate.requiredBackends,
        context: "IKD model load",
      });

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const data = await response.json();
          detail = data?.message || data?.detail || detail;
        } catch {
          // Preserve the last browser status text.
        }
        throw new Error(`IKD model load failed: ${detail}`);
      }

      const ack = (await response.json()) as NativeModelLoadAck;
      if (!ack.loaded) {
        throw new Error("IKD model load rejected");
      }
      if (!Array.isArray(ack.actuated_joint_names) || ack.actuated_joint_names.length === 0) {
        throw new Error("IKD model load failed: no actuated joints found for selected target link");
      }
      modelKeyRef.current = modelKey;
      setModelReady(true);
    },
    [active, ikdGate.enabled, ikdGate.requiredBackends, ikdGate.unavailableReason, ikdGate.unavailableSuffix, modelReady]
  );

  return useMemo(
    () => ({
      enabled: active,
      connected,
      modelReady,
      lastTelemetry,
      error,
      sendTarget,
      sendTargetLatest,
      ensureModel,
    }),
    [active, connected, modelReady, lastTelemetry, error, sendTarget, sendTargetLatest, ensureModel]
  );
};
