import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_DEMO_QUERY_PARAM,
  RUNTIME_DEMO_QUERY_VALUE,
  isRuntimeDemoEnabled,
} from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";

describe("runtimeRobotPreviewParams", () => {
  it("enables runtime demo mode from the query string", () => {
    expect(
      isRuntimeDemoEnabled(`?${RUNTIME_DEMO_QUERY_PARAM}=${RUNTIME_DEMO_QUERY_VALUE}`)
    ).toBe(true);
  });

  it("enables runtime demo mode from the Vite environment flag", () => {
    vi.stubEnv("VITE_RUNTIME_DEMO", RUNTIME_DEMO_QUERY_VALUE);

    expect(isRuntimeDemoEnabled("")).toBe(true);

    vi.unstubAllEnvs();
  });

  it("keeps runtime demo mode disabled by default", () => {
    expect(isRuntimeDemoEnabled("")).toBe(false);
  });
});
