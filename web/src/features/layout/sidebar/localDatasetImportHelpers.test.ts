import { afterEach, describe, expect, it, vi } from "vitest";

import { createEpisode, type Episode } from "@/features/dataset";
import {
  getLocalDatasetRelativePath,
  groupLocalDatasetRowsByEpisodeIndex,
  hasLocalDatasetV3InfoFile,
  isLocalDatasetV3InfoPayload,
  listSortedLocalDatasetMotionFiles,
  mergeEpisodesByPersistedIndex,
  parseLocalDatasetJsonLines,
  resolveLocalDatasetFolderBasePath,
  resolveLocalDatasetFolderSourceName,
  toLocalDatasetArchivePath,
  type LocalDatasetFileWithRelativePath,
} from "@/features/layout/sidebar/localDatasetImportHelpers";

const createRelativeFile = (name: string, relativePath: string) => {
  const file = new File(["test"], name) as LocalDatasetFileWithRelativePath;
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
};

const createTestEpisode = (
  id: string,
  number: number,
  episodeIndex: number
): Episode =>
  createEpisode(id, number, [], {
    episode_index: episodeIndex,
    episodeNumber: number,
  });

describe("localDatasetImportHelpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects v3 folder roots and strips the folder prefix for archive paths", () => {
    const files = [
      createRelativeFile("info.json", "robot-run/meta/info.json"),
      createRelativeFile(
        "file-000.parquet",
        "robot-run/data/chunk-000/file-000.parquet"
      ),
    ];

    expect(hasLocalDatasetV3InfoFile(files)).toBe(true);
    expect(resolveLocalDatasetFolderSourceName(files)).toBe("robot-run");
    expect(resolveLocalDatasetFolderBasePath(getLocalDatasetRelativePath(files[0]))).toBe(
      "robot-run"
    );
    expect(
      toLocalDatasetArchivePath(getLocalDatasetRelativePath(files[1]), "robot-run")
    ).toBe("data/chunk-000/file-000.parquet");
  });

  it("filters and sorts supported local dataset motion files by relative path", () => {
    const files = [
      createRelativeFile("notes.txt", "demo/notes.txt"),
      createRelativeFile("episode-02.csv", "demo/episode-02.csv"),
      createRelativeFile("episode-10.json", "demo/episode-10.json"),
      createRelativeFile("episode-01.pos", "demo/nested/episode-01.pos"),
    ];

    expect(listSortedLocalDatasetMotionFiles(files).map(getLocalDatasetRelativePath)).toEqual([
      "demo/episode-02.csv",
      "demo/episode-10.json",
      "demo/nested/episode-01.pos",
    ]);
  });

  it("recognizes supported v3 metadata payloads", () => {
    expect(
      isLocalDatasetV3InfoPayload({
        codebase_version: "v3.0",
      })
    ).toBe(true);
    expect(
      isLocalDatasetV3InfoPayload({
        dataset_format_version: "lerobot_dataset_v3",
      })
    ).toBe(true);
    expect(isLocalDatasetV3InfoPayload({ codebase_version: "v2.0" })).toBe(false);
  });

  it("parses JSONL rows and groups valid rows by episode index", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = parseLocalDatasetJsonLines(
      [
        JSON.stringify({ episode_index: 2, frame_index: 1 }),
        "not-json",
        JSON.stringify({ episode_index: 2, frame_index: 2 }),
        JSON.stringify({ episode_index: 3, frame_index: 1 }),
        JSON.stringify({ episode_index: "bad", frame_index: 0 }),
      ].join("\n")
    );

    const grouped = groupLocalDatasetRowsByEpisodeIndex(rows);

    expect(Array.from(grouped.keys())).toEqual([2, 3]);
    expect(grouped.get(2)).toHaveLength(2);
    expect(grouped.get(3)).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("merges imported episodes using persisted episode indices before renumbering", () => {
    const currentEpisodes = [
      createTestEpisode("existing-1", 1, 0),
      createTestEpisode("existing-2", 2, 4),
    ];
    const importedEpisodes = [
      createTestEpisode("imported-2", 1, 3),
      createTestEpisode("imported-1", 1, 1),
    ];

    expect(
      mergeEpisodesByPersistedIndex(currentEpisodes, importedEpisodes).map(
        (episode) => `${episode.id}:${episode.number}:${episode.metadata?.episode_index}`
      )
    ).toEqual([
      "existing-1:1:0",
      "imported-1:2:1",
      "imported-2:3:3",
      "existing-2:4:4",
    ]);
  });
});
