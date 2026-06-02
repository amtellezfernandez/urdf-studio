import { describe, expect, it } from "vitest";

import type { RosVizMarkerDeltaBatchPayload } from "@/runtime_engine/rosviz/types";
import {
  applyMarkerDeltaBatch,
  markerStoreKey,
  pruneExpiredMarkers,
} from "./markerStore";

const buildDeltaBatch = (
  deltas: RosVizMarkerDeltaBatchPayload["deltas"]
): RosVizMarkerDeltaBatchPayload => ({
  fixed_frame: "map",
  t_ns: 1,
  deltas,
});

describe("markerStore", () => {
  it("adds and updates markers by namespace/id", () => {
    const markers = applyMarkerDeltaBatch(
      new Map(),
      buildDeltaBatch([
        {
          action: "add_or_modify",
          namespace: "test",
          marker_id: 1,
          marker: {
            namespace: "test",
            marker_id: 1,
            frame_id: "map",
            marker_type: "sphere",
            pose_position_xyz: [0, 0, 0],
            pose_quaternion_xyzw: [0, 0, 0, 1],
            scale_xyz: [0.1, 0.1, 0.1],
            color_rgba: [1, 0, 0, 1],
            points_xyz: [],
            lifetime_ms: 0,
          },
        },
      ]),
      5n
    );
    expect(markers.size).toBe(1);

    const updated = applyMarkerDeltaBatch(
      markers,
      buildDeltaBatch([
        {
          action: "add_or_modify",
          namespace: "test",
          marker_id: 1,
          marker: {
            namespace: "test",
            marker_id: 1,
            frame_id: "map",
            marker_type: "sphere",
            pose_position_xyz: [1, 0, 0],
            pose_quaternion_xyzw: [0, 0, 0, 1],
            scale_xyz: [0.1, 0.1, 0.1],
            color_rgba: [0, 1, 0, 1],
            points_xyz: [],
            lifetime_ms: 0,
          },
        },
      ]),
      6n
    );
    const entry = updated.get(markerStoreKey("test", 1));
    expect(entry?.marker.pose_position_xyz[0]).toBe(1);
    expect(entry?.marker.color_rgba[1]).toBe(1);
  });

  it("deletes one marker and supports delete_all", () => {
    const base = applyMarkerDeltaBatch(
      new Map(),
      buildDeltaBatch([
        {
          action: "add_or_modify",
          namespace: "a",
          marker_id: 1,
          marker: {
            namespace: "a",
            marker_id: 1,
            frame_id: "map",
            marker_type: "cube",
            pose_position_xyz: [0, 0, 0],
            pose_quaternion_xyzw: [0, 0, 0, 1],
            scale_xyz: [0.1, 0.1, 0.1],
            color_rgba: [1, 1, 1, 1],
            points_xyz: [],
            lifetime_ms: 0,
          },
        },
        {
          action: "add_or_modify",
          namespace: "a",
          marker_id: 2,
          marker: {
            namespace: "a",
            marker_id: 2,
            frame_id: "map",
            marker_type: "cube",
            pose_position_xyz: [0, 0, 0],
            pose_quaternion_xyzw: [0, 0, 0, 1],
            scale_xyz: [0.1, 0.1, 0.1],
            color_rgba: [1, 1, 1, 1],
            points_xyz: [],
            lifetime_ms: 0,
          },
        },
      ]),
      5n
    );

    const afterDelete = applyMarkerDeltaBatch(
      base,
      buildDeltaBatch([
        {
          action: "delete",
          namespace: "a",
          marker_id: 1,
          marker: null,
        },
      ]),
      6n
    );
    expect(afterDelete.size).toBe(1);
    expect(afterDelete.has(markerStoreKey("a", 1))).toBe(false);

    const afterDeleteAll = applyMarkerDeltaBatch(
      afterDelete,
      buildDeltaBatch([
        {
          action: "delete_all",
          namespace: "a",
          marker_id: null,
          marker: null,
        },
      ]),
      7n
    );
    expect(afterDeleteAll.size).toBe(0);
  });

  it("expires markers by lifetime", () => {
    const markers = applyMarkerDeltaBatch(
      new Map(),
      buildDeltaBatch([
        {
          action: "add_or_modify",
          namespace: "life",
          marker_id: 1,
          marker: {
            namespace: "life",
            marker_id: 1,
            frame_id: "map",
            marker_type: "sphere",
            pose_position_xyz: [0, 0, 0],
            pose_quaternion_xyzw: [0, 0, 0, 1],
            scale_xyz: [0.1, 0.1, 0.1],
            color_rgba: [1, 1, 0, 1],
            points_xyz: [],
            lifetime_ms: 10,
          },
        },
      ]),
      1_000_000_000n
    );
    expect(markers.size).toBe(1);

    const pruned = pruneExpiredMarkers(markers, 1_010_000_001n);
    expect(pruned.size).toBe(0);
  });
});
