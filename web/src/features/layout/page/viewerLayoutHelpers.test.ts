import { describe, expect, it } from "vitest";

import { resolveViewerLayoutMainStyle } from "@/features/layout/page/viewerLayoutHelpers";

describe("viewerLayoutHelpers", () => {
  it("resolves viewer layout margins from sidebar collapse state", () => {
    expect(
      resolveViewerLayoutMainStyle({
        isRightSidebarCollapsed: false,
        isSidebarCollapsed: false,
        rightSidebarWidth: 260,
        sidebarWidth: 320,
      })
    ).toEqual({
      marginLeft: 320,
      marginRight: 260,
      marginTop: "28px",
    });

    expect(
      resolveViewerLayoutMainStyle({
        isRightSidebarCollapsed: true,
        isSidebarCollapsed: true,
        rightSidebarWidth: 260,
        sidebarWidth: 320,
      })
    ).toEqual({
      marginLeft: 0,
      marginRight: 0,
      marginTop: "28px",
    });
  });
});
