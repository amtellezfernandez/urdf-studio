import { describe, expect, it } from "vitest";

import { resolveRosVizSessionSource } from "./sessionSource";

describe("resolveRosVizSessionSource", () => {
  it("defaults to live_ros when no params are present", () => {
    const source = resolveRosVizSessionSource("");
    expect(source).toEqual({ dataSource: "live_ros", replaySource: null });
  });

  it("prefers replay when replay query is provided", () => {
    const source = resolveRosVizSessionSource("?rosVizReplay=demo://sample");
    expect(source).toEqual({ dataSource: "replay", replaySource: "demo://sample" });
  });

  it("maps episode query into episode source", () => {
    const source = resolveRosVizSessionSource("?rosVizEpisode=42");
    expect(source).toEqual({ dataSource: "episode", replaySource: "episode://42" });
  });

  it("respects explicit source override", () => {
    const source = resolveRosVizSessionSource("?rosVizSource=live_ros&rosVizReplay=demo://sample");
    expect(source).toEqual({ dataSource: "live_ros", replaySource: null });
  });
});
