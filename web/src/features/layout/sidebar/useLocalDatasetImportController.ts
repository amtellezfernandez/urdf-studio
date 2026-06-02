import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import {
  analyzeSingleDatasetTreatment,
  buildDatasetTreatmentAdditionalFields,
  buildEpisodeCollectionContentSignature,
  createEpisode,
  convertDatasetRowsToRecordedFrames,
  DEFAULT_INDEXED_REPRESENTATION_ID,
  DEFAULT_SEMANTIC_REPRESENTATION_ID,
  getSortedJointList,
  NAMING_STATUS_NAMED,
  NAMING_STATUS_UNNAMED,
  parseEpisodeTextAsync,
  RECORDING_INTERVAL_MS,
  resolveDatasetTreatmentContext,
  resolveDatasetSignalBaseMode,
  resolveDatasetSignalProfile,
  resolveJointChannelNames,
  type DatasetNumericRow,
  type Episode,
  type EpisodeJsonEpisode,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import {
  toHfDatasetNumericRows,
  toHfNumericValueArray,
} from "@/features/layout/sidebar/hfDatasetImportHelpers";
import {
  resolveHfSignalFeatureNames,
  resolveHfSignalValuesFromRow,
  resolvePreferredHfSignalField,
  type HfSignalField,
} from "@/features/layout/sidebar/hfSignalSelection";
import {
  appendDatasetSourceRecord,
  type DatasetSourceRecord,
} from "@/features/layout/sidebar/datasetSourceHelpers";
import {
  LOCAL_DATASET_DATA_ENTRY_PREFIX,
  LOCAL_DATASET_DEFAULT_SOURCE_NAME,
  LOCAL_DATASET_EPISODES_ENTRY_PREFIX,
  LOCAL_DATASET_TASKS_ENTRY_PATH,
} from "@/features/layout/sidebar/localDatasetImportParams";
import {
  buildImportedEpisodeId,
  getLocalDatasetRelativePath,
  groupLocalDatasetRowsByEpisodeIndex,
  hasLocalDatasetV3InfoFile,
  isLocalDatasetV3InfoPath,
  isLocalDatasetV3InfoPayload,
  listSortedLocalDatasetMotionFiles,
  mergeEpisodesByPersistedIndex,
  resolveLocalDatasetFolderBasePath,
  resolveLocalDatasetFolderSourceName,
  toLocalDatasetArchivePath,
  type LocalDatasetFileWithRelativePath,
} from "@/features/layout/sidebar/localDatasetImportHelpers";
import { isRecord } from "@/features/layout/sidebar/sidebarHelpers";
import { cloneRobotBasePose } from "@/shared/lib/robotBasePose";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";

type JSZipConstructor = typeof import("jszip");
type JSZipInstance = import("jszip");
type JSZipObject = import("jszip").JSZipObject;
type ReadParquetRows = typeof import("@/features/dataset/v3Parquet").readParquetRows;
type IsParquetBytes = typeof import("@/features/dataset/v3Parquet").isParquetBytes;

type LimitCorrectionReport = {
  totalViolations: number;
  totalClamped: number;
  [key: string]: unknown;
};

type ApplyLimitCorrections = (
  frames: RecordedFrame[],
  modeByJoint?: Record<string, JointLimitMode | undefined>,
  limitsOverride?: JointLimits
) => {
  frames: RecordedFrame[];
  report: LimitCorrectionReport | null;
};

type UseLocalDatasetImportControllerParams = {
  availableJoints: string[];
  robotBaseName: string;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  setDatasetSources: Dispatch<SetStateAction<DatasetSourceRecord[]>>;
  applyLimitCorrections: ApplyLimitCorrections;
  loadJSZip: () => Promise<JSZipConstructor>;
};

type LocalImportBatch = {
  episodes: Episode[];
  framesLoaded: number;
  totalLimitViolations: number;
  totalLimitClamped: number;
  infoMessages: string[];
};

type V3EpisodeSummary = {
  episode_index: number;
  tasks?: unknown[];
  source_key?: string;
} & Record<string, unknown>;

const createEmptyLocalImportBatch = (): LocalImportBatch => ({
  episodes: [],
  framesLoaded: 0,
  totalLimitViolations: 0,
  totalLimitClamped: 0,
  infoMessages: [],
});

const mergeLocalImportBatches = (
  left: LocalImportBatch,
  right: LocalImportBatch
): LocalImportBatch => ({
  episodes: [...left.episodes, ...right.episodes],
  framesLoaded: left.framesLoaded + right.framesLoaded,
  totalLimitViolations:
    left.totalLimitViolations + right.totalLimitViolations,
  totalLimitClamped: left.totalLimitClamped + right.totalLimitClamped,
  infoMessages: [...left.infoMessages, ...right.infoMessages],
});

let parquetReadersPromise: Promise<{
  isParquetBytes: IsParquetBytes;
  readParquetRows: ReadParquetRows;
}> | null = null;

const INVALID_PARQUET_ARCHIVE_ENTRY_MESSAGE_PREFIX =
  "Dataset archive entry must be a valid Parquet file";

const loadParquetReaders = async () => {
  if (!parquetReadersPromise) {
    parquetReadersPromise = import("@/features/dataset/v3Parquet").then(
      ({ isParquetBytes: loadedIsParquetBytes, readParquetRows: loadedReadParquetRows }) => ({
        isParquetBytes: loadedIsParquetBytes,
        readParquetRows: loadedReadParquetRows,
      })
    );
  }
  return parquetReadersPromise;
};

const readArchiveTableRows = async <Row extends Record<string, unknown>>(
  entry: JSZipObject
) => {
  const bytes = await entry.async("uint8array");
  const { isParquetBytes, readParquetRows } = await loadParquetReaders();
  if (!isParquetBytes(bytes)) {
    throw new Error(
      `${INVALID_PARQUET_ARCHIVE_ENTRY_MESSAGE_PREFIX}: ${entry.name}`
    );
  }
  return readParquetRows<Row>(bytes);
};

const warnLimitCorrections = (
  totalLimitViolations: number,
  totalLimitClamped: number
) => {
  if (totalLimitViolations <= 0) {
    return;
  }
  toast.warning(
    `Detected ${totalLimitViolations} joint limit violation${
      totalLimitViolations === 1 ? "" : "s"
    } while importing${
      totalLimitClamped > 0 ? ` (${totalLimitClamped} clamped)` : ""
    }`
  );
};

const resolveLocalNamingStatus = (
  namingStatus: EpisodeMetadata["naming_status"] | undefined,
  jointNames: string[]
) => {
  if (namingStatus === NAMING_STATUS_NAMED || namingStatus === NAMING_STATUS_UNNAMED) {
    return namingStatus;
  }
  return jointNames.length > 0 ? NAMING_STATUS_NAMED : NAMING_STATUS_UNNAMED;
};

export const useLocalDatasetImportController = ({
  availableJoints,
  robotBaseName,
  setEpisodes,
  setDatasetSources,
  applyLimitCorrections,
  loadJSZip,
}: UseLocalDatasetImportControllerParams) => {
  const analyzeLocalDatasetTreatment = useCallback(
    async ({
      datasetId,
      embodimentId,
      representationId,
      namingStatus,
      contentSignature,
    }: {
      datasetId: string;
      embodimentId?: string;
      representationId?: string;
      namingStatus: EpisodeMetadata["naming_status"];
      contentSignature?: ReturnType<typeof buildEpisodeCollectionContentSignature>;
    }) => {
      try {
        return await analyzeSingleDatasetTreatment({
          datasetId,
          embodimentId,
          representationId:
            representationId ?? DEFAULT_INDEXED_REPRESENTATION_ID,
          namingStatus: namingStatus ?? NAMING_STATUS_UNNAMED,
          requiredRepresentationId: DEFAULT_SEMANTIC_REPRESENTATION_ID,
          contentSignature,
        });
      } catch (error) {
        console.warn("Failed to fetch backend treatment analysis for local dataset:", error);
        return null;
      }
    },
    []
  );

  const importEpisodesFromDataFile = useCallback(
    async (
      file: File,
      sourceName: string
    ): Promise<LocalImportBatch> => {
      if (!file || file.size === 0) {
        throw new Error(`File ${file.name} is empty or invalid`);
      }

      const text = await file.text();
      if (!text || text.trim().length === 0) {
        throw new Error(`File ${file.name} appears to be empty`);
      }

      const allowedJoints =
        availableJoints.length > 0
          ? new Set(getSortedJointList(availableJoints))
          : undefined;
      const parseResult = await parseEpisodeTextAsync(text, { allowedJoints });
      if (parseResult.error) {
        throw new Error(parseResult.error);
      }

      const episodesToImport: EpisodeJsonEpisode[] = [];
      if (parseResult.episodes && parseResult.episodes.length > 0) {
        episodesToImport.push(...parseResult.episodes);
      } else if (parseResult.frames) {
        episodesToImport.push({
          frames: parseResult.frames,
          jointOrder:
            parseResult.jointOrder ??
            Array.from(
              new Set(
                parseResult.frames.flatMap((frame) => Object.keys(frame.joints))
              )
            ),
          metadata: parseResult.metadata,
        });
      }

      if (episodesToImport.length === 0) {
        throw new Error("No valid frames found in the data file");
      }

      const batch = createEmptyLocalImportBatch();

      const firstMetadata = episodesToImport[0]?.metadata;
      const initialJointNames =
        Array.isArray(firstMetadata?.joint_names) && firstMetadata.joint_names.length > 0
          ? (firstMetadata.joint_names as string[])
          : episodesToImport[0]?.jointOrder ?? [];
      const datasetTreatment = await analyzeLocalDatasetTreatment({
        datasetId: `local-upload:${sourceName || file.name}`,
        embodimentId: firstMetadata?.embodiment_ref?.embodiment_id,
        representationId: firstMetadata?.representation_id,
        namingStatus: resolveLocalNamingStatus(
          firstMetadata?.naming_status,
          initialJointNames
        ),
        contentSignature: buildEpisodeCollectionContentSignature(episodesToImport),
      });
      const {
        treatmentSource,
        treatmentAdditional,
        treatmentWarningMessages,
      } = resolveDatasetTreatmentContext(
        datasetTreatment,
        `local-upload:${sourceName || file.name}`
      );
      if (treatmentWarningMessages.length > 0) {
        batch.infoMessages.push(...treatmentWarningMessages);
      }
      episodesToImport.forEach((episode, importIndex) => {
        const featureNames =
          episode.jointOrder.length > 0
            ? episode.jointOrder
            : Array.from(
                new Set(
                  episode.frames.flatMap((frame) => Object.keys(frame.joints))
                )
              );
        const signalProfile = resolveDatasetSignalProfile({
          featureNames,
          robotTypeHint:
            typeof episode.metadata?.robot_type === "string"
              ? episode.metadata.robot_type
              : undefined,
          fallbackChannelCount: featureNames.length,
        });
        const numericRows: DatasetNumericRow[] = episode.frames.map((frame) => ({
          timestampMs: frame.timestamp,
          values: featureNames.map((name) => {
            const rawValue = frame.joints[name];
            return typeof rawValue === "number" && Number.isFinite(rawValue)
              ? rawValue
              : 0;
          }),
        }));
        const converted = convertDatasetRowsToRecordedFrames(numericRows, {
          signalProfile,
        });
        const frames: RecordedFrame[] = converted.frames.map((frame, frameIndex) => ({
          timestamp: frame.timestamp,
          jointPositions: frame.jointPositions,
          basePose:
            frame.basePose ??
            cloneRobotBasePose(episode.frames[frameIndex]?.base_pose),
        }));
        if (frames.length === 0) {
          return;
        }

        const { frames: correctedFrames, report } =
          applyLimitCorrections(frames);
        if (report) {
          batch.totalLimitViolations += report.totalViolations;
          batch.totalLimitClamped += report.totalClamped;
        }
        batch.framesLoaded += correctedFrames.length;

        const explicitEpisodeIndex = episode.metadata?.episode_index;
        const metadataNumber =
          typeof episode.metadata?.episodeNumber === "number"
            ? episode.metadata.episodeNumber
            : typeof explicitEpisodeIndex === "number"
              ? explicitEpisodeIndex + 1
              : importIndex + 1;

        const recordedAtRaw = episode.metadata?.recorded_at;
        const createdAt =
          episode.metadata?.createdAt ??
          (typeof recordedAtRaw === "string"
            ? (() => {
                const parsed = Date.parse(recordedAtRaw);
                return Number.isFinite(parsed) ? parsed : undefined;
              })()
            : undefined);

        const inferredJointNames = Object.keys(
          correctedFrames[0]?.jointPositions ?? {}
        );
        const jointNames =
          inferredJointNames.length > 0
            ? inferredJointNames
            : Array.isArray(episode.metadata?.joint_names) &&
                episode.metadata.joint_names.length > 0
              ? (episode.metadata.joint_names as string[])
              : episode.jointOrder;

        const episodeMetadata: EpisodeMetadata = {
          ...(episode.metadata ?? {}),
          episodeNumber: metadataNumber,
          episode_index:
            typeof explicitEpisodeIndex === "number"
              ? explicitEpisodeIndex
              : metadataNumber - 1,
          joint_names: jointNames,
          signal_profile_id:
            episode.metadata?.signal_profile_id ?? signalProfile.profileId,
          signal_profile_version:
            episode.metadata?.signal_profile_version ??
            signalProfile.profileVersion,
          signal_base_mode:
            episode.metadata?.signal_base_mode ??
            resolveDatasetSignalBaseMode(signalProfile),
          signal_mapping_report:
            episode.metadata?.signal_mapping_report ?? signalProfile.report,
          tasks:
            Array.isArray(episode.metadata?.tasks) &&
            episode.metadata.tasks.length > 0
              ? episode.metadata.tasks
              : [],
          createdAt,
          num_frames: correctedFrames.length,
          additional: buildDatasetTreatmentAdditionalFields({
            sourceType:
              typeof episode.metadata?.additional?.sourceType === "string"
                ? episode.metadata.additional.sourceType
                : "local",
            sourceName:
              typeof episode.metadata?.additional?.sourceName === "string"
                ? episode.metadata.additional.sourceName
                : sourceName || file.name,
            baseAdditional: episode.metadata?.additional,
            extraAdditional: report ? { limitCorrections: report } : undefined,
            treatmentAdditional,
            treatmentManifest: datasetTreatment?.treatment_manifest as
              | Record<string, unknown>
              | undefined,
          }),
          naming_status:
            treatmentSource?.naming_status ??
            resolveLocalNamingStatus(episode.metadata?.naming_status, jointNames),
        };

        batch.episodes.push(
          createEpisode(
            buildImportedEpisodeId("episode", importIndex),
            metadataNumber,
            correctedFrames,
            episodeMetadata
          )
        );
      });

      if (batch.episodes.length === 0 || batch.framesLoaded === 0) {
        throw new Error("No valid frames found in the data file");
      }

      return batch;
    },
    [availableJoints, analyzeLocalDatasetTreatment, applyLimitCorrections]
  );

  const importEpisodesFromV3Archive = useCallback(
    async (
      zip: JSZipInstance,
      sourceName: string
    ): Promise<LocalImportBatch> => {
      const infoJsonEntry = Object.values(zip.files).find(
        (entry) => !entry.dir && isLocalDatasetV3InfoPath(entry.name)
      );
      if (!infoJsonEntry) {
        throw new Error("Dataset folder is missing meta/info.json");
      }

      const infoContent = await infoJsonEntry.async("text");
      const infoJsonUnknown: unknown = JSON.parse(infoContent);
      if (!isLocalDatasetV3InfoPayload(infoJsonUnknown)) {
        throw new Error("Unsupported local dataset format");
      }
      const infoJson = infoJsonUnknown as Record<string, unknown>;
      const virtualDatasetId = `local-upload:${sourceName}`;
      const infoJsonEmbodimentId =
        isRecord(infoJson.embodiment_ref) &&
        typeof infoJson.embodiment_ref.embodiment_id === "string"
          ? infoJson.embodiment_ref.embodiment_id
          : undefined;
      const infoJsonRepresentationId =
        typeof infoJson.representation_id === "string"
          ? infoJson.representation_id
          : undefined;
      const infoJsonNamingStatus =
        infoJson.naming_status === "named" || infoJson.naming_status === "unnamed"
          ? infoJson.naming_status
          : undefined;
      const infoJsonTreatmentManifest =
        isRecord(infoJson.dataset_treatment_manifest)
          ? (infoJson.dataset_treatment_manifest as Record<string, unknown>)
          : undefined;
      const infoJsonTreatmentSources = Array.isArray(infoJson.dataset_treatment_sources)
        ? infoJson.dataset_treatment_sources.filter(isRecord)
        : [];
      const treatmentSourceByKey = new Map(
        infoJsonTreatmentSources
          .map((entry) => {
            const sourceKey = entry.source_key;
            return typeof sourceKey === "string" ? [sourceKey, entry] : null;
          })
          .filter(
            (entry): entry is [string, Record<string, unknown>] => entry !== null
          )
      );

      const dataEntries = Object.values(zip.files)
        .filter(
          (entry) =>
            !entry.dir &&
            entry.name.includes(LOCAL_DATASET_DATA_ENTRY_PREFIX) &&
            entry.name.endsWith(".parquet")
        )
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { numeric: true })
        );
      if (dataEntries.length === 0) {
        throw new Error("Dataset folder does not contain any episode data");
      }

      const episodeSummariesMap = new Map<number, V3EpisodeSummary>();
      const episodeEntries = Object.values(zip.files)
        .filter(
          (entry) =>
            !entry.dir &&
            entry.name.includes(LOCAL_DATASET_EPISODES_ENTRY_PREFIX) &&
            entry.name.endsWith(".parquet")
        )
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { numeric: true })
        );
      for (const episodeEntry of episodeEntries) {
        const episodeRows = await readArchiveTableRows<V3EpisodeSummary>(episodeEntry);
        episodeRows.forEach((summary) => {
          if (
            typeof summary.episode_index === "number" &&
            Number.isFinite(summary.episode_index)
          ) {
            episodeSummariesMap.set(summary.episode_index, summary);
          }
        });
      }

      const taskIndexToName = new Map<number, string>();
      const tasksEntry = Object.values(zip.files).find(
        (entry) => !entry.dir && entry.name.includes(LOCAL_DATASET_TASKS_ENTRY_PATH)
      );
      if (tasksEntry) {
        const taskRows = await readArchiveTableRows(tasksEntry);
        taskRows.forEach((task) => {
          if (
            typeof task.task_index === "number" &&
            Number.isFinite(task.task_index) &&
            typeof task.task === "string" &&
            task.task.trim().length > 0
          ) {
            taskIndexToName.set(task.task_index, task.task);
          }
        });
      }
      const taskNameToIndex = new Map(
        Array.from(taskIndexToName.entries()).map(([taskIndex, taskName]) => [
          taskName,
          taskIndex,
        ])
      );

      const batch = createEmptyLocalImportBatch();
      let selectedSignalField: HfSignalField | null = null;
      let datasetJointNames: string[] = [];
      let signalProfileState:
        | ReturnType<typeof resolveDatasetSignalProfile>
        | null = null;
      let datasetTreatment = null;
      let treatmentSource = null;
      let treatmentAdditional = undefined;
      let treatmentWarningMessages: string[] = [];

      for (const dataEntry of dataEntries) {
        const rows = await readArchiveTableRows(dataEntry);
        if (rows.length === 0) {
          continue;
        }

        if (!signalProfileState) {
          const sampleRow = rows[0] ?? {};
          selectedSignalField = resolveHfSignalValuesFromRow(sampleRow).field;
          if (isRecord(infoJson.features)) {
            selectedSignalField =
              resolvePreferredHfSignalField({
                sampleRow,
                features: infoJson.features,
                availableJointNames: availableJoints,
                robotTypeHint:
                  typeof infoJson.robot_type === "string"
                    ? infoJson.robot_type
                    : null,
                fallbackDatasetId: robotBaseName,
              }) ?? selectedSignalField;
          }
          const featureNames = resolveHfSignalFeatureNames(
            infoJson.features,
            selectedSignalField
          );
          const sampleValues = toHfNumericValueArray(
            sampleRow,
            selectedSignalField
          );
          signalProfileState = resolveDatasetSignalProfile({
            featureNames,
            robotTypeHint:
              typeof infoJson.robot_type === "string"
                ? infoJson.robot_type
                : undefined,
            fallbackChannelCount: sampleValues.length,
          });
          datasetJointNames = resolveJointChannelNames(signalProfileState);
          const nonJointChannelCount =
            signalProfileState.channels.length -
            signalProfileState.jointChannels.length;
          if (nonJointChannelCount > 0) {
            batch.infoMessages.push(
              `Detected ${nonJointChannelCount} non-joint channel${
                nonJointChannelCount === 1 ? "" : "s"
              } in local dataset; only joint-position channels are mapped to URDF joints.`
            );
          }
          datasetTreatment = await analyzeLocalDatasetTreatment({
            datasetId: virtualDatasetId,
            embodimentId: infoJsonEmbodimentId,
            representationId: infoJsonRepresentationId,
            namingStatus: resolveLocalNamingStatus(
              infoJsonNamingStatus,
              datasetJointNames
            ),
          });
          ({
            treatmentSource,
            treatmentAdditional,
            treatmentWarningMessages,
          } = resolveDatasetTreatmentContext(
            datasetTreatment,
            virtualDatasetId
          ));
          if (treatmentWarningMessages.length > 0) {
            batch.infoMessages.push(...treatmentWarningMessages);
          }
        }

        const episodesMap = groupLocalDatasetRowsByEpisodeIndex(rows);
        for (const [episodeIndex, episodeRows] of episodesMap.entries()) {
          episodeRows.sort((left, right) => {
            const leftIndex =
              typeof left.frame_index === "number" && Number.isFinite(left.frame_index)
                ? left.frame_index
                : 0;
            const rightIndex =
              typeof right.frame_index === "number" && Number.isFinite(right.frame_index)
                ? right.frame_index
                : 0;
            return leftIndex - rightIndex;
          });

          const converted = convertDatasetRowsToRecordedFrames(
            toHfDatasetNumericRows(
              episodeRows as Array<Record<string, unknown>>,
              selectedSignalField
            ),
            { signalProfile: signalProfileState }
          );
          if (converted.frames.length === 0) {
            continue;
          }

          const { frames: correctedFrames, report } =
            applyLimitCorrections(converted.frames);
          if (report) {
            batch.totalLimitViolations += report.totalViolations;
            batch.totalLimitClamped += report.totalClamped;
          }
          batch.framesLoaded += correctedFrames.length;

          const summary = episodeSummariesMap.get(episodeIndex);
          const sourceLineage =
            typeof summary?.source_key === "string"
              ? treatmentSourceByKey.get(summary.source_key)
              : undefined;
          const summaryTasks = Array.isArray(summary?.tasks) ? summary.tasks : [];
          const taskNames = summaryTasks
            .map((taskEntry) => {
              if (typeof taskEntry === "string" && taskEntry.trim().length > 0) {
                return taskEntry.trim();
              }
              if (typeof taskEntry === "number" && Number.isFinite(taskEntry)) {
                return taskIndexToName.get(taskEntry);
              }
              return undefined;
            })
            .filter((taskName): taskName is string => typeof taskName === "string");
          const primaryTaskName = taskNames[0];
          const primaryTaskIndex =
            primaryTaskName !== undefined
              ? (taskNameToIndex.get(primaryTaskName) ?? 0)
              : 0;
          const actualJointNamesForMetadata =
            Object.keys(correctedFrames[0]?.jointPositions ?? {}).length > 0
              ? Object.keys(correctedFrames[0]?.jointPositions ?? {})
              : datasetJointNames;
          const fps =
            typeof infoJson.fps === "number" && Number.isFinite(infoJson.fps)
              ? infoJson.fps
              : 1000 / RECORDING_INTERVAL_MS;
          const embodimentRef =
            isRecord(infoJson.embodiment_ref) &&
            typeof infoJson.embodiment_ref.embodiment_id === "string"
              ? (infoJson.embodiment_ref as unknown as EpisodeMetadata["embodiment_ref"])
              : typeof treatmentSource?.embodiment_id === "string" &&
                  treatmentSource.embodiment_id.length > 0
                ? {
                    embodiment_id: treatmentSource.embodiment_id,
                    robot_type:
                      typeof infoJson.robot_type === "string"
                        ? infoJson.robot_type
                        : robotBaseName,
                  }
              : undefined;

          const episodeMetadata: EpisodeMetadata = {
            episodeNumber: episodeIndex + 1,
            episode_index: episodeIndex,
            task_index: primaryTaskIndex,
            tasks: taskNames,
            robot_type:
              typeof infoJson.robot_type === "string"
                ? infoJson.robot_type
                : robotBaseName,
            embodiment_ref: embodimentRef,
            representation_id:
              typeof infoJson.representation_id === "string"
                ? infoJson.representation_id
                : DEFAULT_INDEXED_REPRESENTATION_ID,
            naming_status:
              treatmentSource?.naming_status ??
              resolveLocalNamingStatus(infoJsonNamingStatus, actualJointNamesForMetadata),
            signal_profile_id: signalProfileState.profileId,
            signal_profile_version: signalProfileState.profileVersion,
            signal_base_mode: resolveDatasetSignalBaseMode(signalProfileState),
            signal_mapping_report: signalProfileState.report,
            fps,
            joint_names: actualJointNamesForMetadata,
            codebase_version:
              typeof infoJson.codebase_version === "string"
                ? infoJson.codebase_version
                : "v3-compatible",
            num_frames: correctedFrames.length,
            additional: buildDatasetTreatmentAdditionalFields({
              sourceType:
                typeof sourceLineage?.source_type === "string"
                  ? sourceLineage.source_type
                  : "local",
              sourceName:
                typeof sourceLineage?.source_name === "string"
                  ? sourceLineage.source_name
                  : sourceName,
              hfDatasetRepo:
                typeof sourceLineage?.hf_dataset_repo === "string"
                  ? sourceLineage.hf_dataset_repo
                  : undefined,
              canonicalSource:
                typeof sourceLineage?.canonical_source === "string"
                  ? sourceLineage.canonical_source
                  : undefined,
              sourceId:
                typeof sourceLineage?.source_id === "string"
                  ? sourceLineage.source_id
                  : undefined,
              sourceKind:
                typeof sourceLineage?.source_kind === "string"
                  ? sourceLineage.source_kind
                  : undefined,
              extraAdditional: report ? { limitCorrections: report } : undefined,
              treatmentAdditional: isRecord(sourceLineage?.dataset_treatment)
                ? sourceLineage.dataset_treatment
                : treatmentAdditional,
              treatmentManifest: isRecord(sourceLineage?.dataset_treatment_manifest)
                ? sourceLineage.dataset_treatment_manifest
                : datasetTreatment
                  ? (datasetTreatment.treatment_manifest as Record<string, unknown>)
                  : infoJsonTreatmentManifest,
            }),
          };

          batch.episodes.push(
            createEpisode(
              buildImportedEpisodeId("episode", episodeIndex),
              episodeIndex + 1,
              correctedFrames,
              episodeMetadata
            )
          );
        }
      }

      if (batch.episodes.length === 0 || batch.framesLoaded === 0) {
        throw new Error("No valid episodes found in dataset folder");
      }

      return batch;
    },
    [availableJoints, analyzeLocalDatasetTreatment, applyLimitCorrections, robotBaseName]
  );

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      const fileArray = Array.from(files) as LocalDatasetFileWithRelativePath[];
      if (hasLocalDatasetV3InfoFile(fileArray)) {
        try {
          const JSZip = await loadJSZip();
          const zip = new JSZip();
          const infoJsonFile = fileArray.find((file) =>
            isLocalDatasetV3InfoPath(getLocalDatasetRelativePath(file))
          );
          if (!infoJsonFile) {
            throw new Error("Dataset folder is missing meta/info.json");
          }

          const basePath = resolveLocalDatasetFolderBasePath(
            getLocalDatasetRelativePath(infoJsonFile)
          );
          for (const file of fileArray) {
            const archivePath = toLocalDatasetArchivePath(
              getLocalDatasetRelativePath(file),
              basePath
            );
            if (!archivePath || archivePath.endsWith("/")) {
              continue;
            }
            zip.file(archivePath, await file.arrayBuffer());
          }

          const sourceName = resolveLocalDatasetFolderSourceName(fileArray);
          const batch = await importEpisodesFromV3Archive(zip, sourceName);
          setEpisodes((prev) => mergeEpisodesByPersistedIndex(prev, batch.episodes));
          setDatasetSources((prev) =>
            appendDatasetSourceRecord(prev, "local", sourceName)
          );
          batch.infoMessages.forEach((message) => toast.info(message));
          toast.success(
            `Loaded v3 dataset: ${batch.episodes.length} episode${
              batch.episodes.length === 1 ? "" : "s"
            } (${batch.framesLoaded} frame${
              batch.framesLoaded === 1 ? "" : "s"
            })`
          );
          warnLimitCorrections(
            batch.totalLimitViolations,
            batch.totalLimitClamped
          );
        } catch (error) {
          console.error("Failed to load local dataset folder:", error);
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Failed to load local dataset folder";
          toast.error(message);
        }
        return;
      }

      const motionDataFiles = listSortedLocalDatasetMotionFiles(fileArray);
      if (motionDataFiles.length === 0) {
        return;
      }

      let aggregateBatch = createEmptyLocalImportBatch();
      let successfulFileCount = 0;
      const failedFiles: string[] = [];
      for (const file of motionDataFiles) {
        try {
          const sourceName = file.name || LOCAL_DATASET_DEFAULT_SOURCE_NAME;
          const batch = await importEpisodesFromDataFile(file, sourceName);
          aggregateBatch = mergeLocalImportBatches(aggregateBatch, batch);
          successfulFileCount += 1;
        } catch (error) {
          console.error(`Failed to load ${file.name}:`, error);
          failedFiles.push(file.name);
          if (motionDataFiles.length === 1) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : `Failed to read ${file.name}`;
            toast.error(message);
          }
        }
      }

      if (aggregateBatch.episodes.length === 0) {
        if (failedFiles.length > 1) {
          toast.error(
            `Failed to load ${failedFiles.length} data file${
              failedFiles.length === 1 ? "" : "s"
            }`
          );
        }
        return;
      }

      setEpisodes((prev) =>
        mergeEpisodesByPersistedIndex(prev, aggregateBatch.episodes)
      );
      const sourceName =
        motionDataFiles.length === 1
          ? motionDataFiles[0]?.name ?? LOCAL_DATASET_DEFAULT_SOURCE_NAME
          : `${motionDataFiles.length} files`;
      setDatasetSources((prev) =>
        appendDatasetSourceRecord(prev, "local", sourceName)
      );

      if (motionDataFiles.length === 1) {
        toast.success(
          `Loaded ${aggregateBatch.episodes.length} episode${
            aggregateBatch.episodes.length === 1 ? "" : "s"
          } (${aggregateBatch.framesLoaded} frame${
            aggregateBatch.framesLoaded === 1 ? "" : "s"
          }) from ${motionDataFiles[0].name}`
        );
      } else {
        toast.success(
          `Loaded ${successfulFileCount} file${
            successfulFileCount === 1 ? "" : "s"
          } (${aggregateBatch.episodes.length} episode${
            aggregateBatch.episodes.length === 1 ? "" : "s"
          }, ${aggregateBatch.framesLoaded} frame${
            aggregateBatch.framesLoaded === 1 ? "" : "s"
          })${failedFiles.length > 0 ? `, ${failedFiles.length} failed` : ""}`
        );
      }

      warnLimitCorrections(
        aggregateBatch.totalLimitViolations,
        aggregateBatch.totalLimitClamped
      );
    },
    [
      importEpisodesFromDataFile,
      importEpisodesFromV3Archive,
      loadJSZip,
      setDatasetSources,
      setEpisodes,
    ]
  );

  return {
    handleFileUpload,
  };
};
