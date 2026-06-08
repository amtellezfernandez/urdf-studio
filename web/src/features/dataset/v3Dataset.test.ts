import { describe, expect, it } from "vitest";

import { buildEpisodeDataForV3 } from "@/features/dataset/v3Dataset";
import type { Episode } from "@/features/dataset/episodes";

const buildEpisode = (
  id: string,
  number: number,
  sourceType: string,
  sourceName: string
): Episode => ({
  id,
  number,
  createdAt: number,
  frames: [
    {
      timestamp: 0,
      jointPositions: { "arm.shoulder_pan": 0.1 },
    },
  ],
  metadata: {
    robot_type: "franka",
    embodiment_ref: {
      embodiment_id: "franka:panda:v1",
    },
    representation_id: "rep:joint_pos_abs:semantic:v1",
    naming_status: "named",
    joint_names: ["arm.shoulder_pan"],
    additional: {
      sourceType,
      sourceName,
      datasetTreatment: {
        source_kind: sourceType,
      },
      datasetTreatmentManifest: {
        manifest_version: "v1",
        required_representation_id: "rep:joint_pos_abs:semantic:v1",
      },
    },
  },
});

describe("buildEpisodeDataForV3", () => {
  it("builds exact v3 episode summaries while retaining source lineage metadata", () => {
    const episodeData = buildEpisodeDataForV3(
      [
        buildEpisode("episode-1", 1, "hf", "hf:repo-a:train"),
        buildEpisode("episode-2", 2, "local", "local-folder"),
      ],
      "franka"
    );

    expect(episodeData.tasksList).toEqual(["task-0", "task-1"]);
    expect(episodeData.episodeSummaries).toEqual([
      expect.objectContaining({
        episode_index: 0,
        tasks: ["task-0"],
        dataset_from_index: 0,
        dataset_to_index: 1,
        "data/chunk_index": 0,
        "data/file_index": 0,
        "meta/episodes/chunk_index": 0,
        "meta/episodes/file_index": 0,
      }),
      expect.objectContaining({
        episode_index: 1,
        tasks: ["task-1"],
        dataset_from_index: 1,
        dataset_to_index: 2,
      }),
    ]);
    expect(episodeData.episodeIndexToSourceKey.get(0)).toBe("hf:hf:repo-a:train");
    expect(episodeData.episodeIndexToSourceKey.get(1)).toBe("local:local-folder");
    expect(episodeData.sourceLineageRecords).toEqual([
      expect.objectContaining({
        source_key: "hf:hf:repo-a:train",
        source_type: "hf",
        source_name: "hf:repo-a:train",
        dataset_treatment_manifest: expect.objectContaining({
          manifest_version: "v1",
        }),
      }),
      expect.objectContaining({
        source_key: "local:local-folder",
        source_type: "local",
        source_name: "local-folder",
      }),
    ]);
  });

  it("filters known non-motor fixed joints from v3 motor state dimensions", () => {
    const episodeData = buildEpisodeDataForV3(
      [
        {
          id: "episode-so101",
          number: 1,
          createdAt: 1,
          frames: [
            {
              timestamp: 0,
              jointPositions: {
                shoulder: 0.1,
                gripper_frame_joint: 9,
                elbow: -0.2,
              },
            },
          ],
          metadata: {
            robot_type: "so101",
            embodiment_ref: {
              embodiment_id: "lerobot:so101:v1",
            },
            representation_id: "rep:joint_pos_abs:indexed:v1",
            naming_status: "named",
            joint_names: ["shoulder", "gripper_frame_joint", "elbow"],
          },
        },
      ],
      "so101",
      "so101",
      ["gripper_frame_joint", "shoulder", "elbow"]
    );

    expect(episodeData.globalJointOrder).toEqual(["shoulder", "elbow"]);
    expect(episodeData.flattenedRows).toEqual([
      expect.objectContaining({
        action: [0.1, -0.2],
        "observation.state": [0.1, -0.2],
      }),
    ]);
  });
});
