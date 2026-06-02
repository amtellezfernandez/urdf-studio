import { describe, expect, it, vi, afterEach } from "vitest";

import {
  analyzeDatasetTreatment,
  analyzeHfDatasetTreatment,
  buildDatasetTreatmentAdditionalFields,
} from "@/features/dataset/datasetTreatments";
import { API_BASE_URL } from "@/shared/config/runtime";

describe("datasetTreatments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts treatment analysis requests to the backend endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            warnings: [],
            treatment_manifest: {
              manifest_version: "v1",
              required_representation_id: "rep:joint_pos_abs:semantic:v1",
              sources: [],
              normalization_actions: [],
              warnings: [],
              errors: [],
              stats: {
                total_sources: 0,
                repo_source_count: 0,
                local_source_count: 0,
                unique_canonical_sources: 0,
                duplicate_group_count: 0,
                alignment_error_count: 0,
                alignment_warning_count: 0,
                unnamed_source_count: 0,
                representation_ids: [],
                embodiment_ids: [],
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

    const request = {
      repo_ids: ["lerobot/demo"],
      alignment: {
        datasets: [
          {
            dataset_id: "hf:lerobot/demo:train",
            embodiment_id: "demo:robot",
            representation_id: "rep:joint_pos_abs:indexed:v1",
            naming_status: "named" as const,
          },
        ],
        required_representation_id: "rep:joint_pos_abs:semantic:v1",
      },
    };
    const result = await analyzeDatasetTreatment(request);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/datasets/treatments/analyze`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    expect(result.success).toBe(true);
  });

  it("builds HF treatment requests with indexed source representation defaults", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            warnings: [],
            treatment_manifest: {
              manifest_version: "v1",
              required_representation_id: "rep:joint_pos_abs:semantic:v1",
              sources: [],
              normalization_actions: [],
              warnings: [],
              errors: [],
              stats: {
                total_sources: 1,
                repo_source_count: 1,
                local_source_count: 0,
                unique_canonical_sources: 1,
                duplicate_group_count: 0,
                alignment_error_count: 0,
                alignment_warning_count: 0,
                unnamed_source_count: 0,
                representation_ids: ["rep:joint_pos_abs:indexed:v1"],
                embodiment_ids: ["demo:robot"],
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

    await analyzeHfDatasetTreatment({
      repoId: "lerobot/demo",
      datasetId: "hf:lerobot/demo:train",
      embodimentId: "demo:robot",
      contentSignature: {
        kind: "episode-series-v1",
        episodes: [
          {
            episode_index: 0,
            frames: [{ timestamp: 0, joints: { shoulder: 0.1 } }],
          },
        ],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body =
      typeof init === "object" && init && "body" in init
        ? JSON.parse(String(init.body))
        : null;
    expect(body).toEqual({
      repo_ids: ["lerobot/demo"],
      alignment: {
        datasets: [
          {
            dataset_id: "hf:lerobot/demo:train",
            embodiment_id: "demo:robot",
            representation_id: "rep:joint_pos_abs:indexed:v1",
            naming_status: "named",
            content_signature: {
              kind: "episode-series-v1",
              episodes: [
                {
                  episode_index: 0,
                  frames: [{ timestamp: 0, joints: { shoulder: 0.1 } }],
                },
              ],
            },
          },
        ],
        required_representation_id: "rep:joint_pos_abs:semantic:v1",
      },
    });
  });

  it("builds unified additional fields for source and treatment metadata", () => {
    expect(
      buildDatasetTreatmentAdditionalFields({
        sourceType: "hf",
        sourceName: "openai/demo [train]",
        hfDatasetRepo: "openai/demo",
        canonicalSource: "openai/demo",
        sourceId: "repo:0",
        sourceKind: "repo",
        extraAdditional: { hfSplit: "train" },
        treatmentAdditional: { canonicalFingerprint: "abcdef1234567890" },
        treatmentManifest: { manifest_version: "v1" },
      })
    ).toEqual({
      sourceType: "hf",
      sourceName: "openai/demo [train]",
      hfDatasetRepo: "openai/demo",
      canonicalSource: "openai/demo",
      sourceId: "repo:0",
      sourceKind: "repo",
      hfSplit: "train",
      datasetTreatment: { canonicalFingerprint: "abcdef1234567890" },
      datasetTreatmentManifest: { manifest_version: "v1" },
    });
  });
});
