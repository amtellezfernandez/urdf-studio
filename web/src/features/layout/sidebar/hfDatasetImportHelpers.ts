import type {
  DatasetNumericRow,
  DatasetSignalProfileResolution,
} from "@/features/dataset";
import type { MappingDiagnosticExcludedChannel } from "@/features/dataset/jointMappingDiagnostics";
import {
  resolveHfSignalValuesFromRow,
  type HfSignalField,
} from "@/features/layout/sidebar/hfSignalSelection";
import { toFiniteNumber } from "@/features/layout/sidebar/sidebarHelpers";

export type HfDatasetTarget = {
  owner: string;
  name: string;
  repoId: string;
};

export type HfDatasetPartitionOption = {
  id: string;
  config: string;
  split: string;
  numExamples: number;
};

export type HfMappingDialogData = {
  datasetJoints: string[];
  jointRanges: Record<string, { min: number; max: number }>;
  source: string;
  datasetPath: string;
  signalField: HfSignalField | null;
  signalProfileId: string;
  excludedChannels: MappingDiagnosticExcludedChannel[];
  loadingToastId?: string | number;
};

export const DEFAULT_HF_DATASET_REPO = "lerobot/svla_so101_pickplace";

const HF_DATASET_URL_PREFIX_REGEX = /^https?:\/\/huggingface\.co\/datasets\//i;
const HF_DATASET_SHORTHAND_PREFIX_REGEX = /^datasets\//i;

export const parseHfDatasetTargetInput = (
  input: string,
  defaultOwner?: string
): HfDatasetTarget | null => {
  const normalized = input
    .trim()
    .replace(HF_DATASET_URL_PREFIX_REGEX, "")
    .replace(HF_DATASET_SHORTHAND_PREFIX_REGEX, "")
    .split(/[?#]/, 1)[0]
    .replace(/^\/+|\/+$/g, "");

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const [owner, name] = parts;
    return { owner, name, repoId: `${owner}/${name}` };
  }
  if (parts.length === 1 && defaultOwner) {
    const owner = defaultOwner;
    const [name] = parts;
    return { owner, name, repoId: `${owner}/${name}` };
  }
  return null;
};

export const toHfNumericValueArray = (
  row: Record<string, unknown>,
  preferredField?: HfSignalField | null
) => {
  const { values: dataArray } = resolveHfSignalValuesFromRow(row, preferredField);
  return dataArray.map((value) =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number.isFinite(Number(value))
        ? Number(value)
        : 0
  );
};

export const toHfDatasetNumericRows = (
  rows: Array<Record<string, unknown>>,
  preferredField?: HfSignalField | null
): DatasetNumericRow[] =>
  rows.map((row) => ({
    timestampMs: toFiniteNumber(row.timestamp, 0) * 1000,
    values: toHfNumericValueArray(row, preferredField),
  }));

export const computeHfJointRanges = (
  rows: Array<Record<string, unknown>>,
  signalProfile: DatasetSignalProfileResolution,
  preferredField?: HfSignalField | null
) => {
  const ranges: Record<string, { min: number; max: number }> = {};
  signalProfile.jointChannels.forEach((channel) => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    rows.forEach((row) => {
      const values = toHfNumericValueArray(row, preferredField);
      const value = values[channel.index];
      if (typeof value === "number" && Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
    if (Number.isFinite(min) && Number.isFinite(max)) {
      ranges[channel.normalizedName] = { min, max };
    }
  });
  return ranges;
};

const resolveHfExcludedSignalChannels = (
  signalProfile: DatasetSignalProfileResolution
): MappingDiagnosticExcludedChannel[] =>
  signalProfile.channels
    .filter((channel) => channel.semantic !== "joint_position")
    .map((channel) => ({
      name: channel.sourceName,
      semantic: channel.semantic,
    }));

export const buildHfMappingDialogData = ({
  datasetJoints,
  jointRanges,
  source,
  datasetPath,
  signalField,
  signalProfile,
  loadingToastId,
}: {
  datasetJoints: string[];
  jointRanges: Record<string, { min: number; max: number }>;
  source: string;
  datasetPath: string;
  signalField: HfSignalField | null;
  signalProfile: DatasetSignalProfileResolution;
  loadingToastId?: string | number;
}): HfMappingDialogData => ({
  datasetJoints,
  jointRanges,
  source,
  datasetPath,
  signalField,
  signalProfileId: signalProfile.profileId,
  excludedChannels: resolveHfExcludedSignalChannels(signalProfile),
  loadingToastId,
});
