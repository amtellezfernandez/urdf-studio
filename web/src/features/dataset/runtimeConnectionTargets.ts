export type RuntimeConnectionTargets = {
  telemetryIngestUrl: string;
  telemetryChannelsUrl: string;
  telemetryFramesUrl: string;
  statsUrl: string;
  commandsUrl: string;
};

export const buildRuntimeConnectionTargets = (
  apiBaseUrl: string,
  runtimeSessionId: string
): RuntimeConnectionTargets => {
  const sessionId = encodeURIComponent(runtimeSessionId.trim() || "your-session-id");
  const telemetryIngestUrl = `${apiBaseUrl}/runtime/sessions/${sessionId}/telemetry/ingest`;
  const telemetryChannelsUrl = `${apiBaseUrl}/runtime/sessions/${sessionId}/telemetry/channels`;
  const telemetryFramesUrl = `${apiBaseUrl}/runtime/sessions/${sessionId}/telemetry/frames`;
  const statsUrl = `${apiBaseUrl}/runtime/sessions/${sessionId}/stats`;
  const commandsUrl = `${apiBaseUrl}/runtime/sessions/${sessionId}/commands`;

  return {
    telemetryIngestUrl,
    telemetryChannelsUrl,
    telemetryFramesUrl,
    statsUrl,
    commandsUrl,
  };
};
