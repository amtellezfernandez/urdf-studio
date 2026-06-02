import { describe, expect, it } from "vitest";
import {
  createDefaultDatasetConstraintSettings,
  DEFAULT_DATASET_CONSTRAINT_BOX_MAX,
  DEFAULT_DATASET_CONSTRAINT_BOX_MIN,
  DEFAULT_DATASET_CONSTRAINT_HEIGHT_LIMIT,
  DEFAULT_DATASET_CONSTRAINT_WALL_POSITION,
} from "@/features/dataset/episode-viewer/constraintSettings";

describe("createDefaultDatasetConstraintSettings", () => {
  it("returns expected defaults", () => {
    expect(createDefaultDatasetConstraintSettings()).toEqual({
      mode: "none",
      heightAxis: "z",
      heightLimit: DEFAULT_DATASET_CONSTRAINT_HEIGHT_LIMIT,
      boxMin: DEFAULT_DATASET_CONSTRAINT_BOX_MIN,
      boxMax: DEFAULT_DATASET_CONSTRAINT_BOX_MAX,
      wallAxis: "y",
      wallSide: "negative",
      wallPosition: DEFAULT_DATASET_CONSTRAINT_WALL_POSITION,
    });
  });

  it("returns fresh nested objects", () => {
    const first = createDefaultDatasetConstraintSettings();
    const second = createDefaultDatasetConstraintSettings();

    first.boxMin.x = -99;
    first.boxMax.x = 99;

    expect(second.boxMin.x).toBe(DEFAULT_DATASET_CONSTRAINT_BOX_MIN.x);
    expect(second.boxMax.x).toBe(DEFAULT_DATASET_CONSTRAINT_BOX_MAX.x);
  });
});
