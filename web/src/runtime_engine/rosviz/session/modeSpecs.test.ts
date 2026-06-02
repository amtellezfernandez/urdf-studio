import { describe, expect, it } from "vitest";

import {
  ROSVIZ_SESSION_MODE_OPTIONS,
  resolveDefaultSessionMode,
} from "@/runtime_engine/rosviz/session/modeSpecs";

describe("modeSpecs", () => {
  it("covers all supported session modes", () => {
    expect(ROSVIZ_SESSION_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      "live_debug",
      "live_record",
      "replay_rosbag",
      "replay_episode",
      "replay_motion_only",
      "hybrid_compare",
    ]);
  });

  it("resolves defaults from data source", () => {
    expect(resolveDefaultSessionMode("live_ros")).toBe("live_debug");
    expect(resolveDefaultSessionMode("replay")).toBe("replay_rosbag");
    expect(resolveDefaultSessionMode("episode")).toBe("replay_episode");
  });
});
