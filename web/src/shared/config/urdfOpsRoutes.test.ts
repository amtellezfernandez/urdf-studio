import { describe, expect, it } from "vitest";

import {
  URDF_OPS_DEFAULT_TAB,
  URDF_OPS_QUERY_PARAMS,
  URDF_OPS_TABS,
  buildUrdfOpsBrowserUrl,
  buildUrdfOpsTabSearchParams,
  buildUrdfOpsUrl,
  resolveUrdfOpsTab,
} from "./urdfOpsRoutes";

describe("UrdfOps route contract", () => {
  it("falls back to the default tab for missing or unknown query values", () => {
    expect(resolveUrdfOpsTab(null)).toBe(URDF_OPS_DEFAULT_TAB);
    expect(resolveUrdfOpsTab("unknown")).toBe(URDF_OPS_DEFAULT_TAB);
  });

  it("builds dataset deep links with encoded source metadata", () => {
    expect(
      buildUrdfOpsUrl({
        tab: URDF_OPS_TABS.datasets,
        datasetId: "owner/robotics dataset",
        datasetSource: "huggingface",
      }),
    ).toBe("/urdfops?tab=datasets&dataset=owner%2Frobotics+dataset&source=huggingface");
  });

  it("builds review deep links with the active session id", () => {
    expect(
      buildUrdfOpsUrl({
        tab: URDF_OPS_TABS.review,
        reviewSessionId: "session/a",
      }),
    ).toBe("/urdfops?tab=review&session=session%2Fa");
  });

  it("builds browser hrefs under the configured app base path", () => {
    expect(
      buildUrdfOpsBrowserUrl(
        {
          tab: URDF_OPS_TABS.review,
          reviewSessionId: "session/a",
        },
        "/studio/",
      ),
    ).toBe("/studio/urdfops?tab=review&session=session%2Fa");

    expect(
      buildUrdfOpsBrowserUrl(
        {
          tab: URDF_OPS_TABS.review,
        },
        "/",
      ),
    ).toBe("/urdfops?tab=review");
  });

  it("preserves existing context when changing tabs", () => {
    const currentParams = new URLSearchParams({
      [URDF_OPS_QUERY_PARAMS.tab]: URDF_OPS_TABS.datasets,
      [URDF_OPS_QUERY_PARAMS.dataset]: "owner/robotics dataset",
      [URDF_OPS_QUERY_PARAMS.source]: "huggingface",
    });

    const nextParams = buildUrdfOpsTabSearchParams(
      currentParams,
      URDF_OPS_TABS.experiments,
    );

    expect(nextParams.get(URDF_OPS_QUERY_PARAMS.tab)).toBe(URDF_OPS_TABS.experiments);
    expect(nextParams.get(URDF_OPS_QUERY_PARAMS.dataset)).toBe(
      "owner/robotics dataset",
    );
    expect(nextParams.get(URDF_OPS_QUERY_PARAMS.source)).toBe("huggingface");
  });
});
