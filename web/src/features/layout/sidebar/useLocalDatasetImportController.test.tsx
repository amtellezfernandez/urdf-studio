/** @vitest-environment jsdom */
import JSZip from "jszip";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeSingleDatasetTreatmentMock, toast } = vi.hoisted(() => ({
  analyzeSingleDatasetTreatmentMock: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/features/dataset/datasetTreatments", async () => {
  const actual = await vi.importActual<typeof import("@/features/dataset/datasetTreatments")>(
    "@/features/dataset/datasetTreatments"
  );
  return {
    ...actual,
    analyzeSingleDatasetTreatment: analyzeSingleDatasetTreatmentMock,
  };
});

import { buildDatasetArchiveArtifact } from "@/features/layout/sidebar/datasetArchiveExport";
import {
  useLocalDatasetImportController,
} from "@/features/layout/sidebar/useLocalDatasetImportController";
import { createEpisode } from "@/features/dataset/episodes";
import type { Episode } from "@/features/dataset/episodes";
import type { DatasetSourceRecord } from "@/features/layout/sidebar/datasetSourceHelpers";

type HookOptions = Parameters<typeof useLocalDatasetImportController>[0];

const DATASET_NAME = "roundtrip_demo_v3";
const REPRESENTATION_ID = "rep:joint_pos_abs:indexed:v1";
const EMBODIMENT_ID = "demo:robot:v1";
const JOINT_NAMES = ["joint_a", "joint_b"];
const PARQUET_FLOAT_ASSERT_PRECISION = 4;
const V3_DATA_ENTRY_RELATIVE_PATH = "data/chunk-000/file-000.parquet";
const INVALID_PARQUET_ARCHIVE_ENTRY_ERROR =
  `Dataset archive entry must be a valid Parquet file: ${V3_DATA_ENTRY_RELATIVE_PATH}`;
const MULTI_CHUNK_EPISODE_COUNT = 1001;
const MULTI_CHUNK_MIDDLE_EPISODE_INDEX = Math.floor(MULTI_CHUNK_EPISODE_COUNT / 2);
const MULTI_CHUNK_LAST_EPISODE_INDEX = MULTI_CHUNK_EPISODE_COUNT - 1;

const roundNumericRecord = (
  value: Record<string, number> | undefined
): Record<string, number> | undefined =>
  value
    ? Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          Number(entry.toFixed(PARQUET_FLOAT_ASSERT_PRECISION)),
        ])
      )
    : value;

const createArchiveFileList = async (blob: Blob) => {
  const zip = await JSZip.loadAsync(blob);
  const files = await Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      )
      .map(async (entry) => {
        const fileName = entry.name.split("/").pop() ?? entry.name;
        const bytes = Uint8Array.from(await entry.async("uint8array"));
        const normalizedBytes = new Uint8Array([...bytes]);
        const file = new File([normalizedBytes.buffer], fileName);
        Object.defineProperty(file, "webkitRelativePath", {
          value: entry.name,
          configurable: true,
        });
        return file;
      })
  );
  return files as unknown as FileList;
};

const replaceArchiveFileListEntry = (
  files: FileList,
  entryPath: string,
  content: string
) =>
  Array.from(files).map((file) => {
    const relativePath =
      (file as typeof file & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    if (relativePath !== entryPath) {
      return file;
    }
    const replacement = new File([content], file.name);
    Object.defineProperty(replacement, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
    return replacement;
  }) as unknown as FileList;

const createRoundTripEpisodes = (): Episode[] => [
  createEpisode(
    "episode-1",
    1,
    [
      {
        timestamp: 0,
        jointPositions: { joint_a: 0.1, joint_b: -0.2 },
      },
      {
        timestamp: 20,
        jointPositions: { joint_a: 0.2, joint_b: -0.1 },
      },
    ],
    {
      robot_type: "demo-bot",
      embodiment_ref: {
        embodiment_id: EMBODIMENT_ID,
        robot_type: "demo-bot",
      },
      representation_id: REPRESENTATION_ID,
      naming_status: "named",
      joint_names: JOINT_NAMES,
      tasks: ["pick", "place"],
      additional: {
        sourceType: "recorded",
        sourceName: "session-a",
        datasetTreatmentManifest: {
          manifest_version: "v1",
        },
      },
    }
  ),
  createEpisode(
    "episode-2",
    2,
    [
      {
        timestamp: 0,
        jointPositions: { joint_a: 1.1, joint_b: 1.2 },
      },
      {
        timestamp: 20,
        jointPositions: { joint_a: 1.3, joint_b: 1.4 },
      },
    ],
    {
      robot_type: "demo-bot",
      embodiment_ref: {
        embodiment_id: EMBODIMENT_ID,
        robot_type: "demo-bot",
      },
      representation_id: REPRESENTATION_ID,
      naming_status: "named",
      joint_names: JOINT_NAMES,
      tasks: ["stow"],
      additional: {
        sourceType: "recorded",
        sourceName: "session-b",
        datasetTreatmentManifest: {
          manifest_version: "v1",
        },
      },
    }
  ),
];

const createMultiChunkRoundTripEpisodes = (): Episode[] =>
  Array.from({ length: MULTI_CHUNK_EPISODE_COUNT }, (_, episodeIndex) =>
    createEpisode(
      `bulk-episode-${episodeIndex + 1}`,
      episodeIndex + 1,
      [
        {
          timestamp: 0,
          jointPositions: {
            joint_a: episodeIndex + 0.1,
            joint_b: -(episodeIndex + 0.2),
          },
        },
      ],
      {
        robot_type: "demo-bot",
        embodiment_ref: {
          embodiment_id: EMBODIMENT_ID,
          robot_type: "demo-bot",
        },
        representation_id: REPRESENTATION_ID,
        naming_status: "named",
        joint_names: JOINT_NAMES,
        tasks: ["bulk"],
        additional: {
          sourceType: "recorded",
          sourceName: "bulk-session",
          datasetTreatmentManifest: {
            manifest_version: "v1",
          },
        },
      }
    )
  );

const buildTreatmentResponse = (datasetId: string) => ({
  success: true,
  warnings: [],
  alignment: {
    valid: true,
    errors: [],
    warnings: [],
  },
  treatment_manifest: {
    manifest_version: "v1",
    required_representation_id: "rep:joint_pos_abs:semantic:v1",
    sources: [
      {
        source_id: "virtual:0",
        dataset_id: datasetId,
        source_kind: "virtual",
        source_value: datasetId,
        canonical_source: datasetId,
        representation_id: REPRESENTATION_ID,
        naming_status: "named",
        embodiment_id: EMBODIMENT_ID,
        profile_id: "indexed-aligned",
        profile_version: "v1",
        normalization_actions: [],
        duplicate_group_size: 1,
      },
    ],
    normalization_actions: [],
    warnings: [],
    errors: [],
    stats: {
      total_sources: 1,
      repo_source_count: 0,
      local_source_count: 0,
      unique_canonical_sources: 1,
      duplicate_group_count: 0,
      exact_duplicate_group_count: 0,
      normalized_duplicate_group_count: 0,
      alignment_error_count: 0,
      alignment_warning_count: 0,
      unnamed_source_count: 0,
      representation_ids: [REPRESENTATION_ID],
      embodiment_ids: [EMBODIMENT_ID],
    },
  },
});

describe("useLocalDatasetImportController round-trip", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    analyzeSingleDatasetTreatmentMock.mockReset();
    analyzeSingleDatasetTreatmentMock.mockImplementation(async ({ datasetId }) =>
      buildTreatmentResponse(datasetId)
    );
    toast.success.mockReset();
    toast.error.mockReset();
    toast.info.mockReset();
    toast.warning.mockReset();
  });

  it("round-trips exported archives through local import without losing frames, tasks, or metadata", async () => {
    const originalEpisodes = createRoundTripEpisodes();
    const artifact = await buildDatasetArchiveArtifact({
      episodes: originalEpisodes,
      robotBaseName: "demo-bot",
      robotName: "demo-bot",
      availableJoints: JOINT_NAMES,
      exportLimitMode: "report",
      jointLimits: {},
      loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      metricsEnabled: false,
      datasetName: DATASET_NAME,
    });
    const archiveFiles = await createArchiveFileList(artifact.blob);

    let importedEpisodes: Episode[] = [];
    let datasetSources: DatasetSourceRecord[] = [];
    let latestResult: ReturnType<typeof useLocalDatasetImportController> | null = null;

    const setEpisodes: HookOptions["setEpisodes"] = (update) => {
      importedEpisodes =
        typeof update === "function" ? update(importedEpisodes) : update;
    };
    const setDatasetSources: HookOptions["setDatasetSources"] = (update) => {
      datasetSources =
        typeof update === "function" ? update(datasetSources) : update;
    };

    const optionsRef: { current: HookOptions } = {
      current: {
        availableJoints: JOINT_NAMES,
        robotBaseName: "demo-bot",
        setEpisodes,
        setDatasetSources,
        applyLimitCorrections: (frames) => ({ frames, report: null }),
        loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      },
    };

    const Harness = () => {
      latestResult = useLocalDatasetImportController(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await latestResult?.handleFileUpload(archiveFiles);
    });

    expect(analyzeSingleDatasetTreatmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: `local-upload:${DATASET_NAME}`,
        namingStatus: "named",
      })
    );
    expect(datasetSources).toEqual([
      expect.objectContaining({
        type: "local",
        name: DATASET_NAME,
      }),
    ]);
    expect(importedEpisodes).toHaveLength(2);

    expect(importedEpisodes.map((episode) => episode.metadata?.episode_index)).toEqual([0, 1]);
    expect(importedEpisodes.map((episode) => episode.number)).toEqual([1, 2]);
    expect(importedEpisodes.map((episode) => episode.frames.length)).toEqual([2, 2]);
    expect(importedEpisodes.map((episode) => episode.metadata?.tasks)).toEqual([
      ["pick", "place"],
      ["stow"],
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.joint_names)).toEqual([
      JOINT_NAMES,
      JOINT_NAMES,
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.representation_id)).toEqual([
      REPRESENTATION_ID,
      REPRESENTATION_ID,
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.naming_status)).toEqual([
      "named",
      "named",
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.embodiment_ref?.embodiment_id)).toEqual([
      EMBODIMENT_ID,
      EMBODIMENT_ID,
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.additional?.sourceType)).toEqual([
      "local",
      "local",
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.additional?.sourceName)).toEqual([
      DATASET_NAME,
      DATASET_NAME,
    ]);
    expect(importedEpisodes.map((episode) => episode.metadata?.additional?.datasetTreatmentManifest)).toEqual([
      buildTreatmentResponse(`local-upload:${DATASET_NAME}`).treatment_manifest,
      buildTreatmentResponse(`local-upload:${DATASET_NAME}`).treatment_manifest,
    ]);
    expect(
      importedEpisodes.map((episode) => roundNumericRecord(episode.frames[0]?.jointPositions))
    ).toEqual([
      { joint_a: 0.1, joint_b: -0.2 },
      { joint_a: 1.1, joint_b: 1.2 },
    ]);
    expect(
      importedEpisodes.map((episode) => roundNumericRecord(episode.frames[1]?.jointPositions))
    ).toEqual([
      { joint_a: 0.2, joint_b: -0.1 },
      { joint_a: 1.3, joint_b: 1.4 },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Loaded v3 dataset: 2 episodes (4 frames)");
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("rejects v3 archives whose parquet entries contain text payloads", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalEpisodes = createRoundTripEpisodes();
    const artifact = await buildDatasetArchiveArtifact({
      episodes: originalEpisodes,
      robotBaseName: "demo-bot",
      robotName: "demo-bot",
      availableJoints: JOINT_NAMES,
      exportLimitMode: "report",
      jointLimits: {},
      loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      metricsEnabled: false,
      datasetName: DATASET_NAME,
    });
    const archiveFiles = replaceArchiveFileListEntry(
      await createArchiveFileList(artifact.blob),
      `${DATASET_NAME}/${V3_DATA_ENTRY_RELATIVE_PATH}`,
      `${JSON.stringify({ episode_index: 0, frame_index: 0 })}\n`
    );

    let importedEpisodes: Episode[] = [];
    let datasetSources: DatasetSourceRecord[] = [];
    let latestResult: ReturnType<typeof useLocalDatasetImportController> | null = null;

    const setEpisodes: HookOptions["setEpisodes"] = (update) => {
      importedEpisodes =
        typeof update === "function" ? update(importedEpisodes) : update;
    };
    const setDatasetSources: HookOptions["setDatasetSources"] = (update) => {
      datasetSources =
        typeof update === "function" ? update(datasetSources) : update;
    };

    const optionsRef: { current: HookOptions } = {
      current: {
        availableJoints: JOINT_NAMES,
        robotBaseName: "demo-bot",
        setEpisodes,
        setDatasetSources,
        applyLimitCorrections: (frames) => ({ frames, report: null }),
        loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      },
    };

    const Harness = () => {
      latestResult = useLocalDatasetImportController(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await latestResult?.handleFileUpload(archiveFiles);
    });

    expect(importedEpisodes).toEqual([]);
    expect(datasetSources).toEqual([]);
    expect(analyzeSingleDatasetTreatmentMock).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(INVALID_PARQUET_ARCHIVE_ENTRY_ERROR);
    expect(consoleErrorSpy).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("round-trips multi-chunk archives through local import", async () => {
    const originalEpisodes = createMultiChunkRoundTripEpisodes();
    const artifact = await buildDatasetArchiveArtifact({
      episodes: originalEpisodes,
      robotBaseName: "demo-bot",
      robotName: "demo-bot",
      availableJoints: JOINT_NAMES,
      exportLimitMode: "report",
      jointLimits: {},
      loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      metricsEnabled: false,
      datasetName: DATASET_NAME,
    });
    const zip = await JSZip.loadAsync(artifact.blob);
    const archiveEntryNames = Object.keys(zip.files).sort();
    expect(archiveEntryNames).toContain(
      `${DATASET_NAME}/meta/episodes/chunk-001/file-000.parquet`
    );
    expect(archiveEntryNames).toContain(
      `${DATASET_NAME}/data/chunk-001/file-000.parquet`
    );
    const archiveFiles = await createArchiveFileList(artifact.blob);

    let importedEpisodes: Episode[] = [];
    let datasetSources: DatasetSourceRecord[] = [];
    let latestResult: ReturnType<typeof useLocalDatasetImportController> | null = null;

    const setEpisodes: HookOptions["setEpisodes"] = (update) => {
      importedEpisodes =
        typeof update === "function" ? update(importedEpisodes) : update;
    };
    const setDatasetSources: HookOptions["setDatasetSources"] = (update) => {
      datasetSources =
        typeof update === "function" ? update(datasetSources) : update;
    };

    const optionsRef: { current: HookOptions } = {
      current: {
        availableJoints: JOINT_NAMES,
        robotBaseName: "demo-bot",
        setEpisodes,
        setDatasetSources,
        applyLimitCorrections: (frames) => ({ frames, report: null }),
        loadJSZip: async () => JSZip as unknown as typeof import("jszip"),
      },
    };

    const Harness = () => {
      latestResult = useLocalDatasetImportController(optionsRef.current);
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
    });

    await act(async () => {
      await latestResult?.handleFileUpload(archiveFiles);
    });

    expect(analyzeSingleDatasetTreatmentMock).toHaveBeenCalledTimes(1);
    expect(importedEpisodes).toHaveLength(MULTI_CHUNK_EPISODE_COUNT);
    expect(importedEpisodes[0]?.number).toBe(1);
    expect(importedEpisodes[MULTI_CHUNK_LAST_EPISODE_INDEX]?.number).toBe(
      MULTI_CHUNK_EPISODE_COUNT
    );
    expect(importedEpisodes[0]?.metadata?.episode_index).toBe(0);
    expect(
      importedEpisodes[MULTI_CHUNK_LAST_EPISODE_INDEX]?.metadata?.episode_index
    ).toBe(MULTI_CHUNK_LAST_EPISODE_INDEX);
    expect(roundNumericRecord(importedEpisodes[0]?.frames[0]?.jointPositions)).toEqual({
      joint_a: 0.1,
      joint_b: -0.2,
    });
    expect(
      roundNumericRecord(
        importedEpisodes[MULTI_CHUNK_MIDDLE_EPISODE_INDEX]?.frames[0]?.jointPositions
      )
    ).toEqual({
      joint_a: MULTI_CHUNK_MIDDLE_EPISODE_INDEX + 0.1,
      joint_b: -(MULTI_CHUNK_MIDDLE_EPISODE_INDEX + 0.2),
    });
    expect(
      roundNumericRecord(
        importedEpisodes[MULTI_CHUNK_LAST_EPISODE_INDEX]?.frames[0]?.jointPositions
      )
    ).toEqual({
      joint_a: MULTI_CHUNK_LAST_EPISODE_INDEX + 0.1,
      joint_b: -(MULTI_CHUNK_LAST_EPISODE_INDEX + 0.2),
    });
    expect(datasetSources).toEqual([
      expect.objectContaining({
        type: "local",
        name: DATASET_NAME,
      }),
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      `Loaded v3 dataset: ${MULTI_CHUNK_EPISODE_COUNT} episodes (${MULTI_CHUNK_EPISODE_COUNT} frames)`
    );
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
