import { describe, expect, it } from "vitest";

import { resolveRosVizSessionSource } from "./sessionSource";

describe("resolveRosVizSessionSource", () => {
  it("defaults to live_ros when no params are present", () => {
    const source = resolveRosVizSessionSource("");
    expect(source).toEqual({ dataSource: "live_ros" });
  });

  it("ignores unsupported query parameters", () => {
    const source = resolveRosVizSessionSource("?rosVizInput=demo://sample");
    expect(source).toEqual({ dataSource: "live_ros" });
  });

  it("respects explicit source override", () => {
    const source = resolveRosVizSessionSource("?rosVizSource=live_ros&rosVizInput=demo://sample");
    expect(source).toEqual({ dataSource: "live_ros" });
  });

});
