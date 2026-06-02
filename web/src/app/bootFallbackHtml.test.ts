import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BOOT_FALLBACK_HTML_TEST_FIXTURE = {
  cacheRecoveryText: "will keep retrying",
  entryMarker: "data-urdf-studio-entry",
  entryRetryParam: "urdfStudioEntryRetry",
  fallbackTitle: "Loading URDF Studio",
  noScriptText: "JavaScript is required to run URDF Studio.",
  pageRetryParam: "urdfStudioBootRetry",
  retryScriptMarker: "dataset.urdfStudioEntryRetry",
};

const readIndexHtml = () =>
  readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("index boot fallback", () => {
  it("renders a visible fallback with repeating entry-bundle recovery", () => {
    const html = readIndexHtml();

    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.fallbackTitle);
    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.cacheRecoveryText);
    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.noScriptText);
    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.entryMarker);
    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.entryRetryParam);
    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.pageRetryParam);
    expect(html).toContain("window.location.replace");
    expect(html).toContain(BOOT_FALLBACK_HTML_TEST_FIXTURE.retryScriptMarker);
    expect(html).not.toContain("clear this site cache");
  });
});
