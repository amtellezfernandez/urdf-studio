import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { generateV3DatasetArchive } from "@/features/dataset/v3Dataset";
import {
  V3_DATASET_DEFAULT_SPLIT_NAME,
  V3_DATASET_JOINT_FEATURE_GROUP,
  V3_DATASET_NO_VIDEO_PATH,
} from "@/features/dataset/v3DatasetParams";
import {
  isParquetBytes,
  readParquetRows,
  writeParquetFile,
} from "@/features/dataset/v3Parquet";
import type { Episode } from "@/features/dataset/episodes";

const roundParquetValue = (value: unknown): unknown => {
  if (typeof value === "number") {
    return Number(value.toFixed(6));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => roundParquetValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, roundParquetValue(entry)])
    );
  }
  return value;
};

describe("v3Parquet", () => {
  it("round-trips nested parquet rows", async () => {
    const parquetBytes = await writeParquetFile([
      {
        name: "episode_index",
        type: "int64",
        values: [0, 1],
      },
      {
        name: "tasks",
        type: "list<int64>",
        values: [[0, 1], [2]],
      },
      {
        name: "action",
        type: "list<float32>",
        values: [[0.1, 0.2], [0.3, 0.4]],
      },
      {
        name: "label",
        type: "utf8",
        values: ["first", "second"],
      },
    ]);

    expect(isParquetBytes(parquetBytes)).toBe(true);
    const rows = await readParquetRows(parquetBytes);
    expect(rows.map((row) => roundParquetValue(row))).toEqual([
      {
        episode_index: 0,
        tasks: [0, 1],
        action: [0.1, 0.2],
        label: "first",
      },
      {
        episode_index: 1,
        tasks: [2],
        action: [0.3, 0.4],
        label: "second",
      },
    ]);
  });

  it("writes v3 archives with real parquet payloads", async () => {
    const zip = new JSZip();
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
              gripper_frame_joint: 9,
              elbow: -0.2,
            },
          },
          {
            timestamp: 50,
            jointPositions: {
              shoulder: 0.2,
              gripper_frame_joint: 10,
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
          joint_names: ["shoulder", "gripper_frame_joint", "elbow"],
          tasks: ["pick"],
        },
      },
    ];

    await generateV3DatasetArchive(
      episodes,
      "demo-bot",
      zip,
      "demo-dataset",
      "demo-bot",
      ["shoulder", "gripper_frame_joint", "elbow"]
    );

    const tasksEntry = zip.file("demo-dataset/meta/tasks.parquet");
    const infoEntry = zip.file("demo-dataset/meta/info.json");
    const episodesEntry = zip.file(
      "demo-dataset/meta/episodes/chunk-000/file-000.parquet"
    );
    const dataEntry = zip.file("demo-dataset/data/chunk-000/file-000.parquet");
    const statsEntry = zip.file("demo-dataset/meta/stats.json");

    expect(infoEntry).toBeTruthy();
    expect(tasksEntry).toBeTruthy();
    expect(episodesEntry).toBeTruthy();
    expect(dataEntry).toBeTruthy();
    expect(statsEntry).toBeTruthy();

    const [infoText, tasksBytes, episodeBytes, dataBytes, statsText] = await Promise.all([
      infoEntry!.async("text"),
      tasksEntry!.async("uint8array"),
      episodesEntry!.async("uint8array"),
      dataEntry!.async("uint8array"),
      statsEntry!.async("text"),
    ]);
    const infoJson = JSON.parse(infoText) as Record<string, unknown>;
    const statsJson = JSON.parse(statsText) as Record<string, unknown>;

    expect(isParquetBytes(tasksBytes)).toBe(true);
    expect(isParquetBytes(episodeBytes)).toBe(true);
    expect(isParquetBytes(dataBytes)).toBe(true);

    expect((await readParquetRows(tasksBytes)).map((row) => roundParquetValue(row))).toEqual([
      { task: "pick", task_index: 0 },
    ]);
    expect((await readParquetRows(episodeBytes)).map((row) => roundParquetValue(row))).toEqual([
      {
        episode_index: 0,
        "data/chunk_index": 0,
        "data/file_index": 0,
        dataset_from_index: 0,
        dataset_to_index: 2,
        tasks: ["pick"],
        length: 2,
        "stats/observation.state/min": [0.1, -0.2],
        "stats/observation.state/max": [0.2, -0.1],
        "stats/observation.state/mean": [0.15, -0.15],
        "stats/observation.state/std": [0.05, 0.05],
        "stats/observation.state/count": [2, 2],
        "stats/action/min": [0.1, -0.2],
        "stats/action/max": [0.2, -0.1],
        "stats/action/mean": [0.15, -0.15],
        "stats/action/std": [0.05, 0.05],
        "stats/action/count": [2, 2],
        "stats/episode_index/min": [0],
        "stats/episode_index/max": [0],
        "stats/episode_index/mean": [0],
        "stats/episode_index/std": [0],
        "stats/episode_index/count": [2],
        "stats/frame_index/min": [0],
        "stats/frame_index/max": [1],
        "stats/frame_index/mean": [0.5],
        "stats/frame_index/std": [0.5],
        "stats/frame_index/count": [2],
        "stats/timestamp/min": [0],
        "stats/timestamp/max": [0.05],
        "stats/timestamp/mean": [0.025],
        "stats/timestamp/std": [0.025],
        "stats/timestamp/count": [2],
        "stats/index/min": [0],
        "stats/index/max": [1],
        "stats/index/mean": [0.5],
        "stats/index/std": [0.5],
        "stats/index/count": [2],
        "stats/task_index/min": [0],
        "stats/task_index/max": [0],
        "stats/task_index/mean": [0],
        "stats/task_index/std": [0],
        "stats/task_index/count": [2],
        "meta/episodes/chunk_index": 0,
        "meta/episodes/file_index": 0,
      },
    ]);
    expect((await readParquetRows(dataBytes)).map((row) => roundParquetValue(row))).toEqual([
      {
        "observation.state": [0.1, -0.2],
        action: [0.1, -0.2],
        episode_index: 0,
        frame_index: 0,
        timestamp: 0,
        index: 0,
        task_index: 0,
      },
      {
        "observation.state": [0.2, -0.1],
        action: [0.2, -0.1],
        episode_index: 0,
        frame_index: 1,
        timestamp: 0.05,
        index: 1,
        task_index: 0,
      },
    ]);

    expect(roundParquetValue(infoJson)).toEqual({
      codebase_version: "v3.0",
      robot_type: "demo-bot",
      total_episodes: 1,
      total_frames: 2,
      total_tasks: 1,
      chunks_size: 1000,
      files_size_in_mb: 0,
      fps: 20,
      splits: {
        [V3_DATASET_DEFAULT_SPLIT_NAME]: "0:1",
      },
      data_path: "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
      video_path: V3_DATASET_NO_VIDEO_PATH,
      features: {
        "observation.state": {
          dtype: "float32",
          shape: [2],
          names: {
            [V3_DATASET_JOINT_FEATURE_GROUP]: ["shoulder.pos", "elbow.pos"],
          },
          fps: 20,
        },
        action: {
          dtype: "float32",
          shape: [2],
          names: {
            [V3_DATASET_JOINT_FEATURE_GROUP]: ["shoulder.pos", "elbow.pos"],
          },
          fps: 20,
        },
        episode_index: {
          dtype: "int64",
          shape: [1],
          names: null,
          fps: 20,
        },
        frame_index: {
          dtype: "int64",
          shape: [1],
          names: null,
          fps: 20,
        },
        timestamp: {
          dtype: "float32",
          shape: [1],
          names: null,
          fps: 20,
        },
        index: {
          dtype: "int64",
          shape: [1],
          names: null,
          fps: 20,
        },
        task_index: {
          dtype: "int64",
          shape: [1],
          names: null,
          fps: 20,
        },
      },
    });

    expect(roundParquetValue(statsJson)).toEqual({
      frame_index: {
        min: [0],
        max: [1],
        mean: [0.5],
        std: [0.5],
        count: [2],
      },
      timestamp: {
        min: [0],
        max: [0.05],
        mean: [0.025],
        std: [0.025],
        count: [2],
      },
      task_index: {
        min: [0],
        max: [0],
        mean: [0],
        std: [0],
        count: [2],
      },
      index: {
        min: [0],
        max: [1],
        mean: [0.5],
        std: [0.5],
        count: [2],
      },
      episode_index: {
        min: [0],
        max: [0],
        mean: [0],
        std: [0],
        count: [2],
      },
      "observation.state": {
        min: [0.1, -0.2],
        max: [0.2, -0.1],
        mean: [0.15, -0.15],
        std: [0.05, 0.05],
        count: [2, 2],
      },
      action: {
        min: [0.1, -0.2],
        max: [0.2, -0.1],
        mean: [0.15, -0.15],
        std: [0.05, 0.05],
        count: [2, 2],
      },
    });
  });
});
