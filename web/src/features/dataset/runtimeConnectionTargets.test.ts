import { describe, expect, it } from "vitest";

import { buildRuntimeConnectionTargets } from "./runtimeConnectionTargets";

describe("runtimeConnectionTargets", () => {
  it("builds authenticated HTTP runtime connection targets", () => {
    const targets = buildRuntimeConnectionTargets("https://studio.example.com/api", "robot-session");

    expect(targets.telemetryIngestUrl).toBe(
      "https://studio.example.com/api/runtime/sessions/robot-session/telemetry/ingest"
    );
    expect(targets.telemetryChannelsUrl).toBe(
      "https://studio.example.com/api/runtime/sessions/robot-session/telemetry/channels"
    );
    expect(targets.commandsUrl).toBe(
      "https://studio.example.com/api/runtime/sessions/robot-session/commands"
    );
  });

  it("falls back to relative HTTP targets for non-url api bases", () => {
    const targets = buildRuntimeConnectionTargets("/api", "demo");

    expect(targets.telemetryFramesUrl).toBe("/api/runtime/sessions/demo/telemetry/frames");
    expect(targets.statsUrl).toBe("/api/runtime/sessions/demo/stats");
  });
});
