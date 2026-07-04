import { describe, expect, it } from "vitest";

import {
  clampLeftSidebarTopPanelHeight,
  clampRightSidebarWidth,
  clampSidebarWidth,
  resolveExpandedRightSidebarWidth,
  resolveExpandedSidebarWidth,
  resolveResizeDoubleClick,
} from "@/features/layout/layoutResizeHelpers";
import {
  DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
  MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT,
  MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
} from "@/features/layout/page/constants";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  JOINT_LIST_SIDEBAR_PARAMS,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/features/layout/jointListSidebarParams";

describe("layoutResizeHelpers", () => {
  it("clamps left sidebar width to the configured range", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 100)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("clamps right sidebar width to the configured range", () => {
    expect(clampRightSidebarWidth(RIGHT_SIDEBAR_MIN_WIDTH - 100)).toBe(
      RIGHT_SIDEBAR_MIN_WIDTH
    );
    expect(clampRightSidebarWidth(RIGHT_SIDEBAR_MAX_WIDTH + 100)).toBe(
      RIGHT_SIDEBAR_MAX_WIDTH
    );
  });

  it("uses default widths when restoring collapsed sidebars", () => {
    expect(resolveExpandedSidebarWidth(0)).toBe(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH));
    expect(resolveExpandedRightSidebarWidth(0)).toBe(
      clampRightSidebarWidth(DEFAULT_RIGHT_SIDEBAR_WIDTH)
    );
  });

  it("returns the default top panel height for non-finite input", () => {
    expect(clampLeftSidebarTopPanelHeight(Number.NaN, 800)).toBe(
      DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT
    );
  });

  it("clamps the top panel ratio using container constraints", () => {
    const containerHeight = 800;
    const minRatio = Math.min(0.95, MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT / containerHeight);
    const maxRatio = Math.max(
      minRatio,
      Math.min(0.95, 1 - MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT / containerHeight)
    );

    expect(clampLeftSidebarTopPanelHeight(-1, containerHeight)).toBe(minRatio);
    expect(clampLeftSidebarTopPanelHeight(2, containerHeight)).toBe(maxRatio);
  });

  it("consumes a resize double click within the configured thresholds", () => {
    const previousPointerDown = { t: 100, x: 200 };
    const result = resolveResizeDoubleClick({
      currentTimestamp:
        100 + JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxIntervalMs - 1,
      pointerX: 200 + JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxDeltaPx,
      previousPointerDown,
    });

    expect(result).toEqual({
      consumedDoubleClick: true,
      nextPointerDown: null,
    });
  });

  it("stores the latest pointer down when the click is outside the double-click threshold", () => {
    const nextTimestamp =
      100 + JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxIntervalMs + 1;
    const result = resolveResizeDoubleClick({
      currentTimestamp: nextTimestamp,
      pointerX: 300,
      previousPointerDown: { t: 100, x: 200 },
    });

    expect(result).toEqual({
      consumedDoubleClick: false,
      nextPointerDown: { t: nextTimestamp, x: 300 },
    });
  });
});
