import type { Episode } from "@/features/dataset/episodes";
import type { EpisodeMetadata, NamingStatus } from "@/features/dataset/io/episodeTypes";
import {
  DATASET_TREATMENT_ACTION_REQUIRES_MAPPING,
  DATASET_TREATMENT_ACTION_REQUIRES_NAMING_REVIEW,
  DATASET_TREATMENT_CODE_ALIGNMENT_ERROR,
  NAMING_STATUS_NAMED,
  NAMING_STATUS_UNNAMED,
} from "@/features/dataset/datasetAlignmentParams";

const PLACEHOLDER_JOINT_PATTERNS = [/^joint_\d+$/i, /^j\d+$/i, /^motor_\d+$/i] as const;

export interface ExportAlignmentIssue {
  episodeId: string;
  episodeNumber: number;
  reason: string;
}

export interface ExportAlignmentValidation {
  valid: boolean;
  issues: ExportAlignmentIssue[];
}

const isPlaceholderJointName = (jointName: string): boolean =>
  PLACEHOLDER_JOINT_PATTERNS.some((pattern) => pattern.test(jointName.trim()));

export const deriveNamingStatus = (metadata: EpisodeMetadata | undefined): NamingStatus => {
  if (metadata?.naming_status === NAMING_STATUS_NAMED) {
    return NAMING_STATUS_NAMED;
  }
  if (metadata?.naming_status === NAMING_STATUS_UNNAMED) {
    return NAMING_STATUS_UNNAMED;
  }

  const jointNames = Array.isArray(metadata?.joint_names) ? (metadata?.joint_names as string[]) : [];
  if (jointNames.length === 0) {
    return NAMING_STATUS_UNNAMED;
  }
  const hasNamedJoint = jointNames.some((name) => !isPlaceholderJointName(name));
  return hasNamedJoint ? NAMING_STATUS_NAMED : NAMING_STATUS_UNNAMED;
};

const hasEmbodimentBinding = (metadata: EpisodeMetadata | undefined): boolean => {
  const embodimentId = metadata?.embodiment_ref?.embodiment_id;
  return typeof embodimentId === "string" && embodimentId.trim().length > 0;
};

type DatasetTreatmentAdditional = {
  normalization_actions?: string[];
  warning_codes?: string[];
  error_codes?: string[];
};

const getDatasetTreatmentAdditional = (
  metadata: EpisodeMetadata | undefined
): DatasetTreatmentAdditional | null => {
  const additional = metadata?.additional;
  if (!additional || typeof additional !== "object") {
    return null;
  }
  const treatment = (additional as Record<string, unknown>).datasetTreatment;
  if (!treatment || typeof treatment !== "object") {
    return null;
  }
  return treatment as DatasetTreatmentAdditional;
};

const validateEpisodeAgainstBackendTreatment = (
  episode: Episode
): ExportAlignmentIssue[] => {
  const metadata = episode.metadata;
  const treatment = getDatasetTreatmentAdditional(metadata);
  if (!treatment) {
    return [];
  }

  const issues: ExportAlignmentIssue[] = [];
  const normalizationActions = Array.isArray(treatment.normalization_actions)
    ? treatment.normalization_actions
    : [];
  const errorCodes = Array.isArray(treatment.error_codes) ? treatment.error_codes : [];

  if (!hasEmbodimentBinding(metadata)) {
    issues.push({
      episodeId: episode.id,
      episodeNumber: episode.number,
      reason: "missing embodiment binding",
    });
  }

  if (
    errorCodes.includes(DATASET_TREATMENT_CODE_ALIGNMENT_ERROR) ||
    normalizationActions.includes(DATASET_TREATMENT_ACTION_REQUIRES_MAPPING)
  ) {
    issues.push({
      episodeId: episode.id,
      episodeNumber: episode.number,
      reason: "backend treatment requires explicit mapping",
    });
  }

  if (normalizationActions.includes(DATASET_TREATMENT_ACTION_REQUIRES_NAMING_REVIEW)) {
    issues.push({
      episodeId: episode.id,
      episodeNumber: episode.number,
      reason: "backend treatment requires naming review",
    });
  }

  return issues;
};

export const validateEpisodesForStandardizedExport = (
  episodes: Episode[]
): ExportAlignmentValidation => {
  const issues: ExportAlignmentIssue[] = [];

  episodes.forEach((episode) => {
    const metadata = episode.metadata;
    const backendIssues = validateEpisodeAgainstBackendTreatment(episode);
    if (backendIssues.length > 0) {
      issues.push(...backendIssues);
      return;
    }

    if (!hasEmbodimentBinding(metadata)) {
      issues.push({
        episodeId: episode.id,
        episodeNumber: episode.number,
        reason: "missing embodiment binding",
      });
    }

    if (deriveNamingStatus(metadata) === NAMING_STATUS_UNNAMED) {
      issues.push({
        episodeId: episode.id,
        episodeNumber: episode.number,
        reason: "unnamed joints require explicit mapping",
      });
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
};
