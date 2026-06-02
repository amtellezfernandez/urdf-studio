import { describe, expect, it } from "vitest";

import {
  appendDatasetSourceRecord,
  createDatasetSourceRecord,
} from "@/features/layout/sidebar/datasetSourceHelpers";

const FIXED_TIMESTAMP = 1_700_000_000_000;

describe("datasetSourceHelpers", () => {
  it("creates dataset source records with an explicit timestamp", () => {
    expect(createDatasetSourceRecord("hf", "openai/demo", FIXED_TIMESTAMP)).toEqual({
      type: "hf",
      name: "openai/demo",
      timestamp: FIXED_TIMESTAMP,
    });
  });

  it("appends a new source record without mutating the existing list", () => {
    const existingSources = [
      createDatasetSourceRecord("recorded", "Recording 1", FIXED_TIMESTAMP),
    ];

    expect(
      appendDatasetSourceRecord(
        existingSources,
        "local",
        "dataset-folder",
        FIXED_TIMESTAMP + 1
      )
    ).toEqual([
      { type: "recorded", name: "Recording 1", timestamp: FIXED_TIMESTAMP },
      { type: "local", name: "dataset-folder", timestamp: FIXED_TIMESTAMP + 1 },
    ]);
    expect(existingSources).toEqual([
      { type: "recorded", name: "Recording 1", timestamp: FIXED_TIMESTAMP },
    ]);
  });
});
