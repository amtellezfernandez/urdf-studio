/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROBOT_LOADING_MESSAGE } from "@/features/layout/page/loadingScreenParams";

vi.mock("@/shared/lib/metrics", () => ({
  isMetricsEnabled: vi.fn(),
}));

vi.mock("@/features/layout/page/TopNavBar", async () => {
  const React = await import("react");
  return {
    TopNavBar: () => React.createElement("div", { "data-top-nav": "true" }),
  };
});

vi.mock("@/features/layout/page/LeftSidebarPanel", async () => {
  const React = await import("react");
  return {
    LeftSidebarPanel: () =>
      React.createElement("aside", { "data-left-sidebar": "true" }),
  };
});

vi.mock("@/features/layout/page/ViewerLayout", async () => {
  const React = await import("react");
  return {
    ViewerLayout: () =>
      React.createElement("main", { "data-viewer-layout": "true" }),
  };
});

vi.mock("@/features/layout/page/RightSidebarPanel", async () => {
  const React = await import("react");
  return {
    RightSidebarPanel: () =>
      React.createElement("aside", { "data-right-sidebar": "true" }),
  };
});

vi.mock("@/features/layout/page/UrdfStatusBanner", async () => {
  const React = await import("react");
  return {
    UrdfStatusBanner: () =>
      React.createElement("div", { "data-urdf-status-banner": "true" }),
  };
});

import { PageShell } from "@/features/layout/page/PageShell";
import { isMetricsEnabled } from "@/shared/lib/metrics";

const mockIsMetricsEnabled = vi.mocked(isMetricsEnabled);

type PageShellProps = ComponentProps<typeof PageShell>;

const createProps = (overrides: Partial<PageShellProps> = {}): PageShellProps => ({
  isLoading: false,
  topNavBarProps: {} as PageShellProps["topNavBarProps"],
  leftSidebarProps: {} as PageShellProps["leftSidebarProps"],
  viewerLayoutProps: {} as PageShellProps["viewerLayoutProps"],
  rightSidebarProps: {} as PageShellProps["rightSidebarProps"],
  urdfStatusBannerProps: {} as PageShellProps["urdfStatusBannerProps"],
  ...overrides,
});

const renderPageShell = async (props: PageShellProps) => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(PageShell, props));
  });

  return { container, root };
};

describe("PageShell", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockIsMetricsEnabled.mockReset();
    mockIsMetricsEnabled.mockReturnValue(false);
    vi.restoreAllMocks();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows the robot loading screen while a URDF is loading", async () => {
    const { container, root } = await renderPageShell(
      createProps({ isLoading: true })
    );

    expect(container.textContent).toContain(ROBOT_LOADING_MESSAGE);
    expect(container.querySelector("[data-top-nav]")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the page shell sections once loading finishes", async () => {
    const { container, root } = await renderPageShell(createProps());

    expect(container.querySelector('[data-top-nav="true"]')).toBeTruthy();
    expect(
      container.querySelector('[data-urdf-status-banner="true"]')
    ).toBeTruthy();
    expect(container.querySelector('[data-left-sidebar="true"]')).toBeTruthy();
    expect(container.querySelector('[data-viewer-layout="true"]')).toBeTruthy();
    expect(container.querySelector('[data-right-sidebar="true"]')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it("emits profiler logs for the instrumented panels when metrics are enabled", async () => {
    mockIsMetricsEnabled.mockReturnValue(true);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { root } = await renderPageShell(createProps());

    expect(debugSpy).toHaveBeenCalledTimes(3);
    expect(debugSpy).toHaveBeenNthCalledWith(
      1,
      "[metrics] ui:left-sidebar",
      expect.objectContaining({ phase: "mount" })
    );
    expect(debugSpy).toHaveBeenNthCalledWith(
      2,
      "[metrics] ui:viewer-layout",
      expect.objectContaining({ phase: "mount" })
    );
    expect(debugSpy).toHaveBeenNthCalledWith(
      3,
      "[metrics] ui:right-sidebar",
      expect.objectContaining({ phase: "mount" })
    );

    await act(async () => {
      root.unmount();
    });
  });
});
