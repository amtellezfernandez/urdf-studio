/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import {
  resolveCurrentUrdfExportContent,
  resolveUrdfExportFileName,
  useUrdfExportActions,
} from "@/app/pages/index/useUrdfExportActions";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

type UrdfExportActions = ReturnType<typeof useUrdfExportActions>;

const URDF_EXPORT_FIXTURES = {
  baseUrdf: "<robot name=\"base\" />",
  canonicalDraft: "<robot name=\"canonical\" />",
  inertialDraft: "<robot name=\"inertial\" />",
} as const;

const renderUrdfExportActions = async (
  overrides: Partial<Parameters<typeof useUrdfExportActions>[0]> = {}
) => {
  let latestActions: UrdfExportActions | null = null;
  const downloadDocument = vi.fn();

  const Probe = () => {
    latestActions = useUrdfExportActions({
      canonicalDraftContent: null,
      downloadDocument,
      getBaseExportContent: () => URDF_EXPORT_FIXTURES.baseUrdf,
      inertialDraftContent: null,
      resolvedRobotName: "resolved robot",
      robotName: null,
      ...overrides,
    });
    return null;
  };

  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });

  if (!latestActions) {
    throw new Error("URDF export actions did not render.");
  }

  return {
    actions: latestActions,
    downloadDocument,
    root,
  };
};

describe("useUrdfExportActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("prefers inertial drafts, then canonical drafts, then the base export content", () => {
    expect(
      resolveCurrentUrdfExportContent({
        canonicalDraftContent: URDF_EXPORT_FIXTURES.canonicalDraft,
        getBaseExportContent: () => URDF_EXPORT_FIXTURES.baseUrdf,
        inertialDraftContent: URDF_EXPORT_FIXTURES.inertialDraft,
      })
    ).toBe(URDF_EXPORT_FIXTURES.inertialDraft);
    expect(
      resolveCurrentUrdfExportContent({
        canonicalDraftContent: URDF_EXPORT_FIXTURES.canonicalDraft,
        getBaseExportContent: () => URDF_EXPORT_FIXTURES.baseUrdf,
        inertialDraftContent: null,
      })
    ).toBe(URDF_EXPORT_FIXTURES.canonicalDraft);
    expect(
      resolveCurrentUrdfExportContent({
        canonicalDraftContent: null,
        getBaseExportContent: () => URDF_EXPORT_FIXTURES.baseUrdf,
        inertialDraftContent: null,
      })
    ).toBe(URDF_EXPORT_FIXTURES.baseUrdf);
  });

  it("builds safe URDF export filenames", () => {
    expect(
      resolveUrdfExportFileName({
        resolvedRobotName: "fallback",
        robotName: " Robot / Name ",
      })
    ).toBe("Robot_Name.urdf");
    expect(
      resolveUrdfExportFileName({
        resolvedRobotName: " fallback.name ",
        robotName: "",
      })
    ).toBe("fallback.name.urdf");
    expect(resolveUrdfExportFileName({})).toBe("robot.urdf");
  });

  it("exports the resolved URDF content", async () => {
    const { actions, downloadDocument, root } = await renderUrdfExportActions({
      canonicalDraftContent: URDF_EXPORT_FIXTURES.canonicalDraft,
      robotName: "arm v1",
    });

    await act(async () => {
      actions.handleExportCurrentUrdf();
    });

    expect(downloadDocument).toHaveBeenCalledWith(
      URDF_EXPORT_FIXTURES.canonicalDraft,
      "arm_v1.urdf",
      "application/xml"
    );
    expect(toast.success).toHaveBeenCalledWith("Exported URDF");

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks export when no content is available", async () => {
    const { actions, downloadDocument, root } = await renderUrdfExportActions({
      getBaseExportContent: () => "",
    });

    await act(async () => {
      actions.handleExportCurrentUrdf();
    });

    expect(downloadDocument).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("No URDF content to export");

    await act(async () => {
      root.unmount();
    });
  });
});
