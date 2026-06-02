import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildDatasetArchiveArtifact } from "@/features/layout/sidebar/datasetArchiveExport";
import type { Episode } from "@/features/dataset/episodes";

describe("buildDatasetArchiveArtifact", () => {
  it("reports total frames without rebuilding the full v3 row set", async () => {
    const episodes: Episode[] = [
      {
        id: "episode-1",
        number: 1,
        createdAt: 1,
        frames: [
          {
            timestamp: 0,
            jointPositions: {
              shoulder: 0.1,
              elbow: -0.2,
            },
          },
          {
            timestamp: 50,
            jointPositions: {
              shoulder: 0.2,
              elbow: -0.1,
            },
          },
        ],
        metadata: {
          robot_type: "demo-bot",
          embodiment_ref: {
            embodiment_id: "demo:robot",
          },
          representation_id: "rep:joint_pos_abs:indexed:v1",
          naming_status: "named",
          joint_names: ["shoulder", "elbow"],
          tasks: ["pick"],
        },
      },
      {
        id: "episode-2",
        number: 2,
        createdAt: 2,
        frames: [
          {
            timestamp: 0,
            jointPositions: {
              shoulder: 1.1,
              elbow: 1.2,
            },
          },
        ],
        metadata: {
          robot_type: "demo-bot",
          embodiment_ref: {
            embodiment_id: "demo:robot",
          },
          representation_id: "rep:joint_pos_abs:indexed:v1",
          naming_status: "named",
          joint_names: ["shoulder", "elbow"],
          tasks: ["place"],
        },
      },
    ];

    const artifact = await buildDatasetArchiveArtifact({
      episodes,
      robotBaseName: "demo-bot",
      robotName: "demo-bot",
      availableJoints: ["shoulder", "elbow"],
      exportLimitMode: "report",
      jointLimits: {},
      loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      metricsEnabled: false,
      datasetName: "demo-dataset",
    });

    expect(artifact.datasetName).toBe("demo-dataset");
    expect(artifact.totalFrames).toBe(3);
    expect(artifact.blob.size).toBeGreaterThan(0);
    expect(artifact.packDurationMs).toBe(0);
  });
});
