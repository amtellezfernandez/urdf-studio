import { describe, expect, it, vi } from "vitest";

import { openLocalDatasetFilePicker } from "@/features/layout/sidebar/datasetActionHelpers";

describe("openLocalDatasetFilePicker", () => {
  it("clicks the configured local dataset input when it exists", () => {
    const clickSpy = vi.fn();
    const targetDocument = {
      getElementById: (id: string) =>
        id === "motion-upload-episodes" ? { click: clickSpy } : null,
    };

    expect(openLocalDatasetFilePicker(targetDocument)).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("returns false when the file input is missing", () => {
    expect(
      openLocalDatasetFilePicker(
        {
          getElementById: () => null,
        },
        "missing-input"
      )
    ).toBe(false);
  });
});
