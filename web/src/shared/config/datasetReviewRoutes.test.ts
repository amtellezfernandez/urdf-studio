/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import {
  DATASET_REVIEW_ROUTE,
  DATASET_REVIEW_SESSION_STORAGE_KEY,
  buildDatasetReviewUrl,
  readLatestDatasetReviewSessionId,
  writeLatestDatasetReviewSessionId,
} from "./datasetReviewRoutes";

describe("dataset review route contract", () => {
  it("builds the standalone review route without session context", () => {
    expect(buildDatasetReviewUrl()).toBe(DATASET_REVIEW_ROUTE);
  });

  it("builds encoded review links for backend session ids", () => {
    expect(buildDatasetReviewUrl({ sessionId: "session/with spaces" })).toBe(
      "/dataset-review?session=session%2Fwith+spaces"
    );
  });

  it("persists the latest review session id for cross-tab review links", () => {
    writeLatestDatasetReviewSessionId(" review-session ");

    expect(window.localStorage.getItem(DATASET_REVIEW_SESSION_STORAGE_KEY)).toBe(
      "review-session"
    );
    expect(readLatestDatasetReviewSessionId()).toBe("review-session");

    writeLatestDatasetReviewSessionId(null);

    expect(readLatestDatasetReviewSessionId()).toBeNull();
  });
});
