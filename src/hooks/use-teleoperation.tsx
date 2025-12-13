import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Teleoperation data structure for receiving joint commands
 */
export interface TeleoperationData {
  // Joint positions keyed by joint name
  jointPositions?: Record<string, number>;

  // End effector position for IK-based teleoperation
  endEffectorPosition?: {
    x: number;
    y: number;
    z: number;
  };

  // End effector orientation (quaternion)
  endEffectorOrientation?: {
    x: number;
    y: number;
    z: number;
    w: number;
  };

  // Timestamp of the data
  timestamp?: number;

  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Configuration for teleoperation data input
 */
export interface TeleoperationConfig {
  // Enable/disable teleoperation
  enabled: boolean;

  // Data source type
  sourceType?: 'websocket' | 'http' | 'manual';

  // WebSocket URL (if using WebSocket)
  websocketUrl?: string;

  // HTTP polling URL (if using HTTP)
  httpUrl?: string;

  // Polling interval in ms (for HTTP)
  pollingInterval?: number;
}

/**
 * Hook for managing teleoperation data inputs
 *
 * @example
 * ```tsx
 * const { data, isConnected, updateData, connect, disconnect } = useTeleoperation({
 *   enabled: true,
 *   sourceType: 'websocket',
 *   websocketUrl: 'ws://localhost:8080/teleoperation'
 * });
 * ```
 */
export function useTeleoperation(config: TeleoperationConfig = { enabled: false }) {
  const [data, setData] = useState<TeleoperationData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Manually update teleoperation data
   */
  const updateData = useCallback((newData: TeleoperationData) => {
    setData({
      ...newData,
      timestamp: newData.timestamp || Date.now(),
    });
  }, []);

  /**
   * Connect to WebSocket source
   */
  const connectWebSocket = useCallback((url: string) => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[Teleoperation] WebSocket connected');
        setIsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const receivedData = JSON.parse(event.data) as TeleoperationData;
          updateData(receivedData);
        } catch (err) {
          console.error('[Teleoperation] Failed to parse WebSocket message:', err);
          setError('Failed to parse incoming data');
        }
      };

      ws.onerror = (event) => {
        console.error('[Teleoperation] WebSocket error:', event);
        setError('WebSocket connection error');
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('[Teleoperation] WebSocket disconnected');
        setIsConnected(false);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[Teleoperation] Failed to create WebSocket:', err);
      setError('Failed to create WebSocket connection');
    }
  }, [updateData]);

  /**
   * Connect to HTTP polling source
   */
  const connectHttpPolling = useCallback((url: string, interval: number = 100) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const receivedData = await response.json() as TeleoperationData;
        updateData(receivedData);
        setIsConnected(true);
        setError(null);
      } catch (err) {
        console.error('[Teleoperation] HTTP polling error:', err);
        setError(err instanceof Error ? err.message : 'HTTP polling error');
        setIsConnected(false);
      }
    };

    // Initial poll
    poll();

    // Set up interval
    pollingIntervalRef.current = setInterval(poll, interval);
  }, [updateData]);

  /**
   * Connect based on configuration
   */
  const connect = useCallback(() => {
    if (!config.enabled) return;

    disconnect(); // Disconnect any existing connection

    if (config.sourceType === 'websocket' && config.websocketUrl) {
      connectWebSocket(config.websocketUrl);
    } else if (config.sourceType === 'http' && config.httpUrl) {
      connectHttpPolling(config.httpUrl, config.pollingInterval);
    }
  }, [config, connectWebSocket, connectHttpPolling]);

  /**
   * Disconnect from all sources
   */
  const disconnect = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    setIsConnected(false);
  }, []);

  /**
   * Auto-connect when config changes
   */
  useEffect(() => {
    if (config.enabled && (config.sourceType === 'websocket' || config.sourceType === 'http')) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [config.enabled, config.sourceType, config.websocketUrl, config.httpUrl, connect, disconnect]);

  return {
    data,
    isConnected,
    error,
    updateData,
    connect,
    disconnect,
  };
}
