import { useEffect, useMemo, useState } from "react";
import type { AssemblySecondaryModel } from "@/features/assembly/types";
import type { AssemblyPose } from "@/features/assembly/store/useAssemblyPlacementStore";
import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";
import {
  buildAssemblyInspectorData,
  type AssemblyInspectorModel,
} from "@/features/assembly/inspector/buildAssemblyInspectorData";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";
import { parseUrdfDocument } from "@/shared/lib/urdfCore";
import { getAssemblyReportBaseUrl } from "@/shared/config/support";

type UseAssemblyWorkspaceStateParams = {
  activeUrdfPath: string | null;
  assemblyContactPairs: string[];
  assemblyPoses: Record<string, AssemblyPose>;
  assemblySelectedRobots: AssemblyRobotInstance[];
  clearAssemblyPlacement: () => void;
  clearAssemblySelection: () => void;
  isAssemblyWorkspace: boolean;
  packageRoots?: PackageRootMap;
  urdfDocuments: Record<string, string>;
  vizUrdfContent: string;
};

export const useAssemblyWorkspaceState = ({
  activeUrdfPath,
  assemblyContactPairs,
  assemblyPoses,
  assemblySelectedRobots,
  clearAssemblyPlacement,
  clearAssemblySelection,
  isAssemblyWorkspace,
  packageRoots,
  urdfDocuments,
  vizUrdfContent,
}: UseAssemblyWorkspaceStateParams) => {
  const summarizeLinkOptions = (urdfContent: string): { links: string[]; rootLinks: string[] } => {
    const xmlDoc = parseUrdfDocument(urdfContent);
    const robot = xmlDoc?.querySelector("robot");
    if (!robot) {
      return { links: [], rootLinks: [] };
    }
    const links = Array.from(robot.querySelectorAll("link"))
      .map((link) => link.getAttribute("name") || "")
      .filter((name) => name.length > 0);
    const childLinks = new Set(
      Array.from(robot.querySelectorAll("joint > child"))
        .map((child) => child.getAttribute("link") || "")
        .filter((name) => name.length > 0)
    );
    const rootLinks = links.filter((linkName) => !childLinks.has(linkName));
    return { links, rootLinks };
  };

  const assemblyHasPhysicalContact = assemblyContactPairs.length > 0;
  const [assemblyProposalRequested, setAssemblyProposalRequested] = useState(false);
  const [assemblyProposalRevision, setAssemblyProposalRevision] = useState(0);

  const assemblySelectionSignature = useMemo(
    () => assemblySelectedRobots.map((robot) => robot.instanceId).join("|"),
    [assemblySelectedRobots]
  );

  const assemblySecondaryModels = useMemo<AssemblySecondaryModel[]>(() => {
    if (!isAssemblyWorkspace || assemblySelectedRobots.length <= 1) return [];

    const normalizedActivePath =
      activeUrdfPath && activeUrdfPath.length > 0
        ? normalizeMeshPathForMatch(activeUrdfPath) || activeUrdfPath
        : null;
    const primaryInstance =
      assemblySelectedRobots.find((robot) => robot.isPrimary) ?? assemblySelectedRobots[0];
    const models: AssemblySecondaryModel[] = [];

    assemblySelectedRobots
      .filter((robot) => robot.instanceId !== primaryInstance.instanceId)
      .forEach((robot) => {
        const normalizedPath = normalizeMeshPathForMatch(robot.urdfPath) || robot.urdfPath;
        const content =
          urdfDocuments[normalizedPath] ||
          (normalizedActivePath && normalizedPath === normalizedActivePath ? vizUrdfContent : "");
        if (!content?.trim()) return;
        models.push({
          id: robot.instanceId,
          sourcePath: normalizedPath,
          name: robot.name,
          urdfContent: content,
        });
      });

    return models;
  }, [activeUrdfPath, assemblySelectedRobots, isAssemblyWorkspace, urdfDocuments, vizUrdfContent]);

  const assemblyPrimaryModel = useMemo(() => {
    if (!isAssemblyWorkspace || assemblySelectedRobots.length === 0) return null;
    const primary = assemblySelectedRobots.find((robot) => robot.isPrimary) ?? assemblySelectedRobots[0];
    return {
      id: primary.instanceId,
      name: primary.name,
    };
  }, [assemblySelectedRobots, isAssemblyWorkspace]);

  const substitutionSession = useMemo(() => {
    if (!isAssemblyWorkspace) return null;
    const hostRobot = assemblySelectedRobots.find((robot) => robot.role === "host") ?? null;
    const replacementRobot =
      assemblySelectedRobots.find((robot) => robot.role === "replacement") ?? null;
    if (!hostRobot || !replacementRobot) return null;
    const normalizedActivePath =
      activeUrdfPath && activeUrdfPath.length > 0
        ? normalizeMeshPathForMatch(activeUrdfPath) || activeUrdfPath
        : null;
    const normalizedHostPath = normalizeMeshPathForMatch(hostRobot.urdfPath) || hostRobot.urdfPath;
    const normalizedReplacementPath =
      normalizeMeshPathForMatch(replacementRobot.urdfPath) || replacementRobot.urdfPath;
    const hostUrdfContent =
      urdfDocuments[normalizedHostPath] ||
      (normalizedActivePath && normalizedHostPath === normalizedActivePath ? vizUrdfContent : "");
    const replacementUrdfContent =
      urdfDocuments[normalizedReplacementPath] ||
      (normalizedActivePath && normalizedReplacementPath === normalizedActivePath ? vizUrdfContent : "");
    const hostLinkSummary = summarizeLinkOptions(hostUrdfContent);
    const replacementLinkSummary = summarizeLinkOptions(replacementUrdfContent);
    return {
      hostRobotId: hostRobot.instanceId,
      hostRobotName: hostRobot.name,
      hostUrdfPath: hostRobot.urdfPath,
      hostUrdfContent,
      hostLinkOptions: hostLinkSummary.links,
      replacementRobotId: replacementRobot.instanceId,
      replacementRobotName: replacementRobot.name,
      replacementUrdfPath: replacementRobot.urdfPath,
      replacementUrdfContent,
      replacementLinkOptions: replacementLinkSummary.links,
      replacementRootLinkOptions:
        replacementLinkSummary.rootLinks.length > 0
          ? replacementLinkSummary.rootLinks
          : replacementLinkSummary.links,
      packageRoots,
    };
  }, [
    activeUrdfPath,
    assemblySelectedRobots,
    isAssemblyWorkspace,
    packageRoots,
    urdfDocuments,
    vizUrdfContent,
  ]);

  const assemblyInspector = useMemo(
    () => {
      if (!isAssemblyWorkspace) {
        return null;
      }

      const normalizedActivePath =
        activeUrdfPath && activeUrdfPath.length > 0
          ? normalizeMeshPathForMatch(activeUrdfPath) || activeUrdfPath
          : null;
      const models: AssemblyInspectorModel[] = [];

      assemblySelectedRobots.forEach((robot) => {
        const normalizedPath = normalizeMeshPathForMatch(robot.urdfPath) || robot.urdfPath;
        const content =
          urdfDocuments[normalizedPath] ||
          (normalizedActivePath && normalizedPath === normalizedActivePath ? vizUrdfContent : "");
        if (!content?.trim()) return;
        models.push({
          id: robot.instanceId,
          name: robot.name,
          urdfContent: content,
          isPrimary: robot.isPrimary,
          role: robot.role,
        });
      });

      return buildAssemblyInspectorData(models, {
        allowUnion: assemblyHasPhysicalContact && assemblyProposalRequested,
        contactPairs: assemblyContactPairs,
        poses: assemblyPoses,
        primaryRobotId:
          assemblySelectedRobots.find((robot) => robot.isPrimary)?.instanceId ??
          assemblySelectedRobots[0]?.instanceId ??
          null,
        proposalRevision: assemblyProposalRevision,
      });
    },
    [
      activeUrdfPath,
      assemblyContactPairs,
      assemblyHasPhysicalContact,
      assemblyPoses,
      assemblyProposalRequested,
      assemblyProposalRevision,
      assemblySelectedRobots,
      isAssemblyWorkspace,
      urdfDocuments,
      vizUrdfContent,
    ]
  );

  const assemblyIssueReportUrl = useMemo(() => {
    if (!isAssemblyWorkspace || assemblySelectedRobots.length === 0) return null;
    const nowIso = new Date().toISOString();
    const lines = [
      "## Assembly Beta Report",
      "",
      `- Timestamp: ${nowIso}`,
      `- Mode: assembly`,
      substitutionSession ? `- Workflow: substitution` : `- Workflow: assembly`,
      `- physical_contacts: ${assemblyContactPairs.length}`,
      "",
      "### Robots in assembly",
      ...assemblySelectedRobots.map((robot, index) => {
        const sourceText =
          robot.source?.type === "github"
            ? `GitHub (${robot.source.owner}/${robot.source.repo}${robot.source.path ? `/${robot.source.path}` : ""})`
            : robot.source?.type === "local"
              ? `Local (${robot.source.folder || "folder"})`
              : "Unknown source";
        const sourceUrl = robot.source?.type === "github" ? robot.source.url || "" : "";
        return `${index + 1}. ${robot.name}\n   - urdf_path: ${robot.urdfPath}\n   - source: ${sourceText}${sourceUrl ? `\n   - source_url: ${sourceUrl}` : ""}`;
      }),
      "",
      "### Issue",
      "Describe the bug and repro steps here.",
    ];
    const params = new URLSearchParams({
      title: `Assembly mode issue: ${assemblySelectedRobots.length} robot${assemblySelectedRobots.length > 1 ? "s" : ""}`,
      labels: "assembly,beta",
      body: lines.join("\n"),
    });
    return `${getAssemblyReportBaseUrl()}?${params.toString()}`;
  }, [assemblyContactPairs.length, assemblySelectedRobots, isAssemblyWorkspace, substitutionSession]);

  useEffect(() => {
    if (isAssemblyWorkspace) return;
    clearAssemblySelection();
    clearAssemblyPlacement();
    setAssemblyProposalRequested(false);
    setAssemblyProposalRevision(0);
  }, [clearAssemblyPlacement, clearAssemblySelection, isAssemblyWorkspace]);

  useEffect(() => {
    if (!isAssemblyWorkspace) return;
    setAssemblyProposalRequested(false);
    setAssemblyProposalRevision(0);
  }, [assemblySelectionSignature, isAssemblyWorkspace]);

  return {
    assemblyHasPhysicalContact,
    assemblyInspector,
    assemblyIssueReportUrl,
    assemblyPrimaryModel,
    assemblyProposalRequested,
    assemblySecondaryModels,
    substitutionSession,
    requestAssemblyProposal: () => {
      setAssemblyProposalRequested(true);
      setAssemblyProposalRevision((value) => value + 1);
    },
  };
};
