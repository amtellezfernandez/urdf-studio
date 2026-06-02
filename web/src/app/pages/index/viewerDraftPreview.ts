import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { analyzeUrdfDocument } from "@/shared/lib/urdfCore";
import { parseURDF } from "@/shared/lib/urdfBrowser";
import { DEFAULT_URDF_FILENAME } from "@/features/layout/page/constants";

export type ViewerDraftPreviewSource = "bake" | "canonical" | "physics" | null;

export type ViewerDraftPreview = {
  urdfFile: File | null;
  urdfAnalysis: UrdfAnalysis | null;
  vizUrdfContent: string;
  source: ViewerDraftPreviewSource;
};

type ViewerDraftPreviewInput = {
  baseUrdfFile: File | null;
  baseUrdfAnalysis: UrdfAnalysis | null;
  baseVizUrdfContent: string;
  bakeDraftContent?: string | null;
  canonicalDraftContent?: string | null;
  inertialDraftContent?: string | null;
  createUrdfFile: (content: string, filename?: string, timestamp?: number) => File;
};

type CandidatePreview = {
  content: string;
  source: Exclude<ViewerDraftPreviewSource, null>;
};

const normalizePreviewContent = (content?: string | null): string | null => {
  if (typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? content : null;
};

const resolveViewerDraftPreviewFilename = (baseUrdfFile: File | null): string =>
  baseUrdfFile?.name.replace(/^viz-/, "") || DEFAULT_URDF_FILENAME;

const buildPreviewAnalysis = (content: string): UrdfAnalysis => {
  const parsed = parseURDF(content);
  return analyzeUrdfDocument(parsed.document);
};

export const resolveViewerDraftPreview = ({
  baseUrdfFile,
  baseUrdfAnalysis,
  baseVizUrdfContent,
  bakeDraftContent,
  canonicalDraftContent,
  inertialDraftContent,
  createUrdfFile,
}: ViewerDraftPreviewInput): ViewerDraftPreview => {
  const normalizedPhysicsDraft = normalizePreviewContent(inertialDraftContent);
  const normalizedCanonicalDraft = normalizePreviewContent(canonicalDraftContent);
  const normalizedBakeDraft = normalizePreviewContent(bakeDraftContent);
  const previewCandidate: CandidatePreview | null = normalizedPhysicsDraft
    ? {
        content: normalizedPhysicsDraft,
        source: "physics",
      }
    : normalizedCanonicalDraft
      ? {
          content: normalizedCanonicalDraft,
          source: "canonical",
        }
      : normalizedBakeDraft
        ? {
            content: normalizedBakeDraft,
            source: "bake",
          }
        : null;

  if (!previewCandidate) {
    return {
      urdfFile: baseUrdfFile,
      urdfAnalysis: baseUrdfAnalysis,
      vizUrdfContent: baseVizUrdfContent,
      source: null,
    };
  }

  return {
    urdfFile: createUrdfFile(
      previewCandidate.content,
      resolveViewerDraftPreviewFilename(baseUrdfFile)
    ),
    urdfAnalysis: buildPreviewAnalysis(previewCandidate.content),
    vizUrdfContent: previewCandidate.content,
    source: previewCandidate.source,
  };
};
