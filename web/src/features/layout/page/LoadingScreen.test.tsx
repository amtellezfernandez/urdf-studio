// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import { LoadingScreen } from "@/features/layout/page/LoadingScreen";
import {
  ROBOT_LOADING_MESSAGE,
  STUDIO_LOADING_MESSAGE,
} from "@/features/layout/page/loadingScreenParams";

const renderLoadingScreen = async (message?: string) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(LoadingScreen, message ? { message } : undefined));
  });
  return { container, root };
};

describe("LoadingScreen", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("uses a Studio loading message for app shell startup", async () => {
    const { container, root } = await renderLoadingScreen();

    expect(container.textContent).toContain(STUDIO_LOADING_MESSAGE);
    expect(container.textContent).not.toContain(ROBOT_LOADING_MESSAGE);

    await act(async () => {
      root.unmount();
    });
  });

  it("can still show robot loading for real URDF imports", async () => {
    const { container, root } = await renderLoadingScreen(ROBOT_LOADING_MESSAGE);

    expect(container.textContent).toContain(ROBOT_LOADING_MESSAGE);

    await act(async () => {
      root.unmount();
    });
  });
});
