import { describe, expect, it } from "vitest";

import {
  hasExplicitWorldImportRequest,
  shouldAutoImportDefaultWorldLayout,
} from "@/features/world-share/defaultSceneAutoLoadPolicy";

const DEFAULT_WORLD_LAYOUT_URL = "https://example.com/default.world-layout.json";

describe("hasExplicitWorldImportRequest", () => {
  it("returns true when import URL is present", () => {
    expect(hasExplicitWorldImportRequest(" https://example.com/world.json ", "", "")).toBe(
      true
    );
  });

  it("returns true when package id and version are both present", () => {
    expect(hasExplicitWorldImportRequest("", "pkg", "1.0.0")).toBe(true);
  });

  it("returns false when neither URL nor package+version are complete", () => {
    expect(hasExplicitWorldImportRequest("", "pkg", "")).toBe(false);
  });
});

describe("shouldAutoImportDefaultWorldLayout", () => {
  it("loads default world layout in demo autoplay mode", () => {
    expect(
      shouldAutoImportDefaultWorldLayout({
        alreadyApplied: false,
        hasLoadedFiles: true,
        defaultWorldLayoutUrl: DEFAULT_WORLD_LAYOUT_URL,
        demoMode: true,
        demoAutoload: true,
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
      })
    ).toBe(true);
  });

  it("loads default world layout once in normal mode without explicit imports", () => {
    expect(
      shouldAutoImportDefaultWorldLayout({
        alreadyApplied: false,
        hasLoadedFiles: true,
        defaultWorldLayoutUrl: DEFAULT_WORLD_LAYOUT_URL,
        demoMode: false,
        demoAutoload: false,
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
      })
    ).toBe(true);
  });

  it("skips default world layout when explicit world layout import exists", () => {
    expect(
      shouldAutoImportDefaultWorldLayout({
        alreadyApplied: false,
        hasLoadedFiles: true,
        defaultWorldLayoutUrl: DEFAULT_WORLD_LAYOUT_URL,
        demoMode: false,
        demoAutoload: false,
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: true,
      })
    ).toBe(false);
  });

  it("skips default world layout when explicit world import exists", () => {
    expect(
      shouldAutoImportDefaultWorldLayout({
        alreadyApplied: false,
        hasLoadedFiles: true,
        defaultWorldLayoutUrl: DEFAULT_WORLD_LAYOUT_URL,
        demoMode: false,
        demoAutoload: false,
        hasExplicitWorldImport: true,
        hasExplicitWorldLayoutImport: false,
      })
    ).toBe(false);
  });

  it("skips default world layout when auto import is suppressed", () => {
    expect(
      shouldAutoImportDefaultWorldLayout({
        alreadyApplied: false,
        hasLoadedFiles: true,
        defaultWorldLayoutUrl: DEFAULT_WORLD_LAYOUT_URL,
        demoMode: false,
        demoAutoload: false,
        hasExplicitWorldImport: false,
        hasExplicitWorldLayoutImport: false,
        suppressAutoImport: true,
      })
    ).toBe(false);
  });
});
