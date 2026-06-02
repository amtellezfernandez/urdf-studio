import { describe, expect, it } from "vitest";

import {
  VIEWER_SCENE_FLOOR_PARAMS,
  VIEWER_SCENE_GRID_PARAMS,
} from "@/features/viewer/viewerSceneChromeParams";

describe("ViewerSceneChrome", () => {
  it("keeps high quality grid squares at one meter", () => {
    expect(
      VIEWER_SCENE_GRID_PARAMS.highSpanMeters /
        VIEWER_SCENE_GRID_PARAMS.highDivisions,
    ).toBe(VIEWER_SCENE_GRID_PARAMS.snapStepMeters);
  });

  it("keeps low quality grid squares at the same one-meter scale", () => {
    expect(
      VIEWER_SCENE_GRID_PARAMS.lowSpanMeters /
        VIEWER_SCENE_GRID_PARAMS.lowDivisions,
    ).toBe(VIEWER_SCENE_GRID_PARAMS.snapStepMeters);
  });

  it("renders the grid and floor on the same world z plane in every camera view", () => {
    expect(VIEWER_SCENE_GRID_PARAMS.planeZMeters).toBe(
      VIEWER_SCENE_FLOOR_PARAMS.position[2],
    );
  });
});
