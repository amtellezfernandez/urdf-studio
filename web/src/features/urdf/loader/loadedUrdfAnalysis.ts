import { findAutoEndEffectorLinksFromAnalysis } from "@/features/layout/page/utils";
import { analyzeUrdfDocument, type UrdfAnalysis } from "@/shared/lib/urdfCore";
import { parseURDF } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";
import {
  summarizeUrdfLoadIssues,
  type UrdfLoadIssueSummary,
} from "@/features/urdf/loader/urdfLoadIssues";

type AnalyzeLoadedUrdfContentParams = {
  meshFiles: MeshFiles;
  packageRoots: Record<string, string[]>;
  parsedContent: string;
  urdfBasePath: string;
};

export type LoadedUrdfContentAnalysis = {
  analysis: UrdfAnalysis;
  autoEndEffector: string | null;
  issueSummary: UrdfLoadIssueSummary;
  validationError: string | null;
};

export const analyzeLoadedUrdfContent = ({
  meshFiles,
  packageRoots,
  parsedContent,
  urdfBasePath,
}: AnalyzeLoadedUrdfContentParams): LoadedUrdfContentAnalysis => {
  const parsedUrdf = parseURDF(parsedContent);
  const analysis = analyzeUrdfDocument(parsedUrdf.document);
  const autoEndEffectorCandidates = parsedUrdf.isValid
    ? findAutoEndEffectorLinksFromAnalysis(analysis)
    : [];
  const issueSummary = summarizeUrdfLoadIssues({
    analysis,
    meshFiles,
    packageRoots,
    parsedIsValid: parsedUrdf.isValid,
    urdfBasePath,
  });

  return {
    analysis,
    autoEndEffector:
      autoEndEffectorCandidates.length === 1 ? autoEndEffectorCandidates[0] : null,
    issueSummary,
    validationError: parsedUrdf.isValid ? null : parsedUrdf.error ?? "Invalid URDF",
  };
};
