import { describe, expect, it } from "vitest";

import {
  ASSEMBLY_ENTRY_WORKFLOW_CONFIGS,
  FOLDER_UPLOAD_ENTRY_MODE_CONFIGS,
  VISIBLE_FOLDER_UPLOAD_ENTRY_MODE_CONFIGS,
  getAssemblyEntryWorkflowConfig,
  getFolderUploadEntryModeConfig,
  syncEntryOptionWithWorkspaceMode,
  toWorkspaceMode,
} from "@/features/dataset/folderUploadEntryModes";

describe("folderUploadEntryModes", () => {
  it("keeps gallery while collapsing substitution into assembly", () => {
    const ids = FOLDER_UPLOAD_ENTRY_MODE_CONFIGS.map((config) => config.id);
    expect(ids).not.toContain("substitution");
    expect(ids).toContain("gallery");
    expect(ids).toContain("assembly");
  });

  it("maps gallery back to studio and assembly to assembly semantics", () => {
    expect(toWorkspaceMode("assembly")).toBe("assembly");
    expect(toWorkspaceMode("gallery")).toBe("studio");
  });

  it("centralizes runtime and assembly entry behavior", () => {
    expect(getFolderUploadEntryModeConfig("assembly")).toMatchObject({
      workspaceMode: "assembly",
      isAssembly: true,
      showLoaders: true,
      robotLoaderTitle: "Sources",
    });
    expect(getFolderUploadEntryModeConfig("runtime")).toMatchObject({
      workspaceMode: "runtime",
      isCompact: true,
      isRuntime: true,
      showLoaders: false,
    });
  });

  it("keeps only public entry modes visible before load", () => {
    const visibleEntryModeIds = VISIBLE_FOLDER_UPLOAD_ENTRY_MODE_CONFIGS.map((config) => config.id);

    expect(visibleEntryModeIds).toEqual(["studio", "training"]);
    expect(visibleEntryModeIds).toContain("training");
    expect(visibleEntryModeIds).not.toContain("gallery");
    expect(visibleEntryModeIds).not.toContain("assembly");
    expect(visibleEntryModeIds).not.toContain("runtime");
    expect(getFolderUploadEntryModeConfig("training")).toMatchObject({
      label: "Training",
      showLoaders: false,
    });
  });

  it("exposes assembly workflows inside the unified assembly entry", () => {
    expect(ASSEMBLY_ENTRY_WORKFLOW_CONFIGS.map((config) => config.id)).toEqual([
      "multi_robot",
      "substitution",
    ]);
    expect(getAssemblyEntryWorkflowConfig("multi_robot")).toMatchObject({
      label: "Multi-Robot",
      launchLabel: "Open Assembly",
    });
    expect(getAssemblyEntryWorkflowConfig("substitution")).toMatchObject({
      label: "Substitution",
      launchLabel: "Open Substitution",
    });
  });

  it("preserves local entry variants when the workspace mode still matches", () => {
    expect(syncEntryOptionWithWorkspaceMode("gallery", "studio")).toBe("gallery");
    expect(syncEntryOptionWithWorkspaceMode("assembly", "assembly")).toBe("assembly");
    expect(syncEntryOptionWithWorkspaceMode("assembly", "studio")).toBe("studio");
  });
});
