import { useMemo } from "react";
import { toast } from "sonner";
import * as THREE from "three";
import { computeOwnedLinkLocalVisualBoundsCenter } from "@/features/camera/cameraAutoBounds";
import { readCollaborationShareSessionFromUrl } from "@/features/collaboration/collaborationTransport";
import type { CollaborationShareSession } from "@/features/collaboration/collaborationTypes";
import type { CollaborationInviteAction } from "@/features/layout/page/top-nav/types";
import type {
  InertialAuditSummary,
  InertialRepairMode,
  InertialSynthesisResult,
} from "@/features/urdf/inertia/inertialSynthesis";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import type {
  CanonicalSynthesisResult,
  FramePreflightResult,
  GeneratePhysicsPreflightResult,
} from "@/features/urdf/inertia/robotMasteringApi";
import { getAssemblyReportBaseUrl } from "@/shared/config/support";
import type { URDFRobot } from "urdf-loader";

export type RepeatedInertiaGroupOutcome = {
  tone: "resolved" | "warning" | "success";
  message: string;
};

export const formatSignedAxisLabel = (axis: "x" | "y" | "z", sign: 1 | -1): string =>
  `${sign > 0 ? "" : "-"}${axis.toUpperCase()}-up`;

export const buildMeshFilesCacheKey = (meshFiles: Record<string, Blob>): string =>
  Object.entries(meshFiles)
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .map(([path, blob]) => `${path}:${blob.size}:${blob.type}`)
    .join("|");

export const buildPackageRootsCacheKey = (packageRoots?: Record<string, string[]>): string =>
  Object.entries(packageRoots ?? {})
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([packageName, roots]) => `${packageName}:${[...roots].sort().join(",")}`)
    .join("|");

export type CanonicalSynthesisPreviewSession = {
  sourceContent: string;
  synthesisSourceContent: string;
  preview: CanonicalSynthesisResult["preview"];
  draftContent: string;
};

export type InertialSynthesisSession = {
  jobId?: string | null;
  sourceContent: string;
  baseContent: string;
  audit: InertialAuditSummary | null;
  synthesis: InertialSynthesisResult;
  draftContent: string;
};

export type PhysicsPreflightSession = GeneratePhysicsPreflightResult & {
  sourceContent: string;
  urdfBasePath?: string;
  meshFilesCacheKey: string;
  packageRootsCacheKey: string;
};

export type FramePreflightSession = FramePreflightResult & {
  sourceContent: string;
};

export type PhysicsActionRequest =
  | {
      key: "repair-missing-invalid" | "replace-all";
      densityPresetId: InertialDensityPresetId;
      repairMode: InertialRepairMode;
    }
  | {
      key: "voxel-recovery" | "psd-regularize";
      densityPresetId: InertialDensityPresetId;
    };

export type RepeatedInertiaGroupActionState = {
  groupKey: string;
};

export type RepeatedInertiaSymmetryOutcome = {
  completedProgress?: {
    appliedStepCount: number;
    totalStepCount: number;
  } | null;
  tone: "success" | "warning";
  message: string;
};

export const collectSynthesizedPhysicsLinkNames = (
  synthesisResult: InertialSynthesisResult,
): string[] => {
  const synthesizedNames = synthesisResult.results
    .filter((entry) => entry.status === "synthesized")
    .map((entry) => entry.linkName);
  if (synthesizedNames.length > 0) {
    return synthesizedNames;
  }
  const warningMessage =
    synthesisResult.results[0]?.warnings[0]?.message ??
    "No usable collision or visual geometry was available.";
  throw new Error(warningMessage);
};

export const useInitialCollaborationSession = (): CollaborationShareSession | null =>
  useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : readCollaborationShareSessionFromUrl(window.location.href),
    [],
  );

export const useStudioIssueReportUrl = ({
  enabled,
  urdfFileName,
  workspaceMode,
}: {
  enabled: boolean;
  urdfFileName?: string | null;
  workspaceMode: string;
}): string | null =>
  useMemo(() => {
    if (!enabled) return null;
    const nowIso = new Date().toISOString();
    const lines = [
      "## Studio Report",
      "",
      `- Timestamp: ${nowIso}`,
      `- Mode: ${workspaceMode}`,
      `- active_urdf: ${urdfFileName ?? "none"}`,
      "",
      "### Issue",
      "Describe the bug and repro steps here.",
    ];
    const params = new URLSearchParams({
      title: "Studio mode issue",
      labels: "studio",
      body: lines.join("\n"),
    });
    return `${getAssemblyReportBaseUrl()}?${params.toString()}`;
  }, [enabled, workspaceMode, urdfFileName]);

export const useRepeatedInertiaSymmetryLinkCentersLocal = (
  robot: URDFRobot | null,
): Map<string, THREE.Vector3> =>
  useMemo(
    () =>
      new Map(
        Object.entries(robot?.links ?? {})
          .map(([linkName, linkObject]) => {
            const localVisualBoundsCenter = computeOwnedLinkLocalVisualBoundsCenter(
              linkObject as THREE.Object3D,
            );
            return localVisualBoundsCenter
              ? ([linkName, localVisualBoundsCenter.clone()] as const)
              : null;
          })
          .filter(
            (
              entry,
            ): entry is readonly [string, THREE.Vector3] => entry !== null,
          ),
      ),
    [robot],
  );

export type CollaborationToastId = ReturnType<typeof toast.loading>;

export type PrepareCollaborationInviteLinkParams = {
  action: CollaborationInviteAction;
  buildLink: () => Promise<string>;
  onShareUrl: (
    shareUrl: string,
    toastId: CollaborationToastId,
  ) => Promise<boolean>;
  loadingMessage: string;
  successMessage: string;
  errorMessage: string;
};
