/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/layout/page/PageShell", async () => {
  const React = await import("react");
  return {
    PageShell: (props: { isLoading: boolean }) =>
      React.createElement("div", {
        "data-page-shell": String(props.isLoading),
      }),
  };
});

vi.mock("@/features/layout/page/PageOverlays", async () => {
  const React = await import("react");
  return {
    PageOverlays: () => React.createElement("div", { "data-page-overlays": "true" }),
  };
});

vi.mock("@/features/layout/page/PageDialogs", async () => {
  const React = await import("react");
  return {
    PageDialogs: () => React.createElement("div", { "data-page-dialogs": "true" }),
  };
});

vi.mock("@/features/layout/page/WorkspacePanels", async () => {
  const React = await import("react");
  return {
    WorkspacePanels: () => React.createElement("div", { "data-workspace-panels": "true" }),
  };
});

import { PageLayout } from "@/features/layout/page/PageLayout";

type PageLayoutProps = ComponentProps<typeof PageLayout>;

const createProps = (): PageLayoutProps => ({
  isLoading: false,
  topNavBarProps: {} as PageLayoutProps["topNavBarProps"],
  leftSidebarProps: {} as PageLayoutProps["leftSidebarProps"],
  viewerLayoutProps: {} as PageLayoutProps["viewerLayoutProps"],
  rightSidebarProps: {} as PageLayoutProps["rightSidebarProps"],
  urdfStatusBannerProps: {} as PageLayoutProps["urdfStatusBannerProps"],
  loadIssuesPanelProps: {} as PageLayoutProps["loadIssuesPanelProps"],
  healthActionPanelProps: {} as PageLayoutProps["healthActionPanelProps"],
  povCamerasOverlayProps: {} as PageLayoutProps["povCamerasOverlayProps"],
  creationDialogsProps: {} as PageLayoutProps["creationDialogsProps"],
});

describe("PageLayout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders the shell, overlays, dialogs, and workspace panels together", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(PageLayout, createProps()));
    });

    expect(container.querySelector('[data-page-shell="false"]')).toBeTruthy();
    expect(container.querySelector('[data-page-overlays="true"]')).toBeTruthy();
    expect(container.querySelector('[data-page-dialogs="true"]')).toBeTruthy();
    expect(container.querySelector('[data-workspace-panels="true"]')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });
});
