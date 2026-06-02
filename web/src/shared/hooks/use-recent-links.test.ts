import { describe, expect, it } from "vitest";

import { toRecentLinkLabel } from "@/shared/hooks/use-recent-links";

describe("toRecentLinkLabel", () => {
  it("extracts compact host + tail path labels for URLs", () => {
    expect(
      toRecentLinkLabel(
        "https://raw.githubusercontent.com/acme/worlds/main/world-layouts/default.world-layout.json"
      )
    ).toBe("raw.githubusercontent.com/world-layouts/default.world-layout.json");
  });

  it("returns trimmed input for invalid URLs", () => {
    expect(toRecentLinkLabel("  owner/repo/path  ")).toBe("owner/repo/path");
  });
});
