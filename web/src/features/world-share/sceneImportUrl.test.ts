import { describe, expect, it } from "vitest";

import { normalizeWorldLayoutImportUrl } from "@/features/world-share/sceneImportUrl";

const GITHUB_BLOB_URL =
  "https://github.com/acme/worlds/blob/main/world-layouts/factory.world-layout.json";
const GITHUB_RAW_URL =
  "https://raw.githubusercontent.com/acme/worlds/main/world-layouts/factory.world-layout.json";

describe("normalizeWorldLayoutImportUrl", () => {
  it("converts GitHub blob URLs into raw content URLs", () => {
    expect(normalizeWorldLayoutImportUrl(GITHUB_BLOB_URL)).toBe(GITHUB_RAW_URL);
  });

  it("keeps non-blob URLs untouched", () => {
    expect(normalizeWorldLayoutImportUrl("https://example.com/world-layout.json")).toBe(
      "https://example.com/world-layout.json"
    );
  });

  it("trims whitespace around valid URLs", () => {
    expect(normalizeWorldLayoutImportUrl(`  ${GITHUB_BLOB_URL}  `)).toBe(GITHUB_RAW_URL);
  });
});
