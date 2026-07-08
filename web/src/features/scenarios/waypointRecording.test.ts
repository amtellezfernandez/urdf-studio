import { describe, expect, it } from "vitest";

import {
  buildWaypointsDocument,
  interpolateWaypoints,
  waypointsDuration,
  type RecordedKeyframe,
} from "@/features/scenarios/waypointRecording";

const KEYFRAMES: RecordedKeyframe[] = [
  { time_s: 0, joints: { j: 0 } },
  { time_s: 1, joints: { j: 1 } },
  { time_s: 2, joints: { j: 3 } },
];

describe("interpolateWaypoints (mirrors backend WaypointPolicy)", () => {
  it("clamps before the first and after the last keyframe", () => {
    expect(interpolateWaypoints(KEYFRAMES, -1)).toEqual({ j: 0 });
    expect(interpolateWaypoints(KEYFRAMES, 5)).toEqual({ j: 3 });
  });

  it("interpolates linearly within a segment", () => {
    expect(interpolateWaypoints(KEYFRAMES, 0.5).j).toBeCloseTo(0.5);
    expect(interpolateWaypoints(KEYFRAMES, 1.5).j).toBeCloseTo(2.0);
  });

  it("unions joint names across adjacent keyframes", () => {
    const frames: RecordedKeyframe[] = [
      { time_s: 0, joints: { a: 0 } },
      { time_s: 1, joints: { a: 1, b: 4 } },
    ];
    const mid = interpolateWaypoints(frames, 0.5);
    expect(mid.a).toBeCloseTo(0.5);
    // A joint absent from the earlier keyframe is held at the present value on
    // both sides (matches WaypointPolicy), so it stays constant at 4.
    expect(mid.b).toBeCloseTo(4.0);
  });

  it("handles unsorted input by sorting on time", () => {
    const shuffled: RecordedKeyframe[] = [
      { time_s: 2, joints: { j: 3 } },
      { time_s: 0, joints: { j: 0 } },
      { time_s: 1, joints: { j: 1 } },
    ];
    expect(interpolateWaypoints(shuffled, 0.5).j).toBeCloseTo(0.5);
  });

  it("returns empty for no keyframes", () => {
    expect(interpolateWaypoints([], 0)).toEqual({});
  });
});

describe("buildWaypointsDocument", () => {
  it("emits the backend WaypointPolicy shape, sorted, with optional attach/detach", () => {
    const doc = buildWaypointsDocument([
      { time_s: 1, joints: { j: 1 }, attach: "carton_1" },
      { time_s: 0, joints: { j: 0 } },
      { time_s: 2, joints: { j: 2 }, detach: true },
    ]);
    expect(doc.waypoints.map((w) => w.time_s)).toEqual([0, 1, 2]);
    expect(doc.waypoints[1].attach).toBe("carton_1");
    expect(doc.waypoints[2].detach).toBe(true);
    expect(doc.waypoints[0].attach).toBeUndefined();
  });

  it("computes duration from the last keyframe", () => {
    expect(waypointsDuration(KEYFRAMES)).toBe(2);
  });
});
