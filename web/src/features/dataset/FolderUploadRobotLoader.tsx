import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import type {
  IluGalleryEntry,
  IluGalleryPublishedRepo,
  IluGalleryPublishedRobot,
} from "@/features/dataset/iluGalleryApi";
import { STUDIO_CANDIDATE_GALLERY_PREVIEW_EAGER_IMAGE_LIMIT } from "@/features/dataset/iluGalleryParams";
import { meshExtensionsDisplay } from "@/shared/lib/urdfCore";
import type { URDFCandidate } from "@/features/urdf/github/githubRepo";
import type { FolderUploadEntryModeConfig } from "@/features/dataset/folderUploadEntryModes";
import type {
  SubstitutionAssignments,
  SubstitutionTarget,
} from "@/features/dataset/substitutionAssignments";
import {
  AlertTriangle,
  Bot,
  Clock,
  Folder,
  FolderOpen,
  Github,
  Info,
  Loader2,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

type RecentRepo = {
  owner: string;
  repo: string;
  path?: string;
  displayName: string;
  url: string;
};

type AssemblyQueuedSelectionPreview = {
  id: string;
  name: string;
  sourceKey: string;
  sourceLabel: string;
  source:
    | {
        type: "github";
        owner: string;
        repo: string;
      }
    | {
        type: "local";
      };
};

type AssemblySourcePreview = {
  sourceKey: string;
  sourceLabel: string;
  candidateCount: number;
  selectedCount: number;
};

type CandidateGalleryMetadataRow = {
  label: string;
  value: string;
  tone?: "warning";
};

type CandidateGalleryRobotDetails = {
  family: string | null;
  mappingName: string | null;
  statsLine: string | null;
  kinematicsLine: string | null;
  urdfName: string | null;
};

const formatCandidateGalleryMetadataText = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const formatCandidateGalleryMetadataList = (values: string[] | null | undefined): string | null => {
  const filteredValues = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  return filteredValues.length > 0 ? filteredValues.join(", ") : null;
};

const formatCandidateGalleryTitleCase = (value: string | null | undefined): string | null => {
  const normalizedValue = value?.replace(/[-_]+/g, " ").trim();
  if (!normalizedValue) {
    return null;
  }
  return normalizedValue
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
};

const formatCandidateGalleryMetric = (label: string, value: number | null | undefined): string | null =>
  value == null ? null : `${label} ${value}`;

const formatCandidateGalleryMetricLine = (
  metrics: Array<{ label: string; value: number | null | undefined }>
): string | null => {
  const formattedMetrics = metrics
    .map(({ label, value }) => formatCandidateGalleryMetric(label, value))
    .filter((metric): metric is string => Boolean(metric));
  return formattedMetrics.length > 0 ? formattedMetrics.join(" · ") : null;
};

const getUrdfNameFromPath = (path: string | null | undefined): string | null => {
  const normalizedPath = path?.trim();
  if (!normalizedPath) {
    return null;
  }
  return normalizedPath.split("/").filter(Boolean).at(-1) ?? null;
};

const normalizeCandidateGalleryPath = (value: string | null | undefined): string | null => {
  const normalizedPath = value?.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return normalizedPath ? normalizedPath : null;
};

const stripCandidateGallerySourceExtension = (value: string | null | undefined): string | null => {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return null;
  }
  return normalizedValue.replace(/(?:\.urdf(?:\.xacro)?|\.xacro)$/i, "");
};

const normalizeCandidateGalleryIdentifier = (value: string | null | undefined): string | null => {
  const normalizedValue = value?.trim().toLowerCase();
  return normalizedValue ? normalizedValue : null;
};

const buildPublishedRobotLabel = (robot: IluGalleryPublishedRobot): string | null => {
  const name = formatCandidateGalleryMetadataText(robot.name);
  const file = formatCandidateGalleryMetadataText(robot.file);
  const fileBase = formatCandidateGalleryMetadataText(robot.fileBase);
  if (!name && !file && !fileBase) {
    return null;
  }
  const primaryLabel = name || file || fileBase;
  if (!fileBase || primaryLabel === fileBase) {
    return primaryLabel;
  }
  return `${primaryLabel} (gallery mapping ${fileBase})`;
};

const addCandidateGalleryIdentifier = (identifiers: Set<string>, value: string | null | undefined): void => {
  const normalizedPath = normalizeCandidateGalleryPath(value);
  const normalizedIdentifier = normalizeCandidateGalleryIdentifier(normalizedPath);
  if (!normalizedIdentifier) {
    return;
  }
  identifiers.add(normalizedIdentifier);

  const basename = getUrdfNameFromPath(normalizedPath);
  const basenameIdentifier = normalizeCandidateGalleryIdentifier(basename);
  if (basenameIdentifier) {
    identifiers.add(basenameIdentifier);
  }

  const stemIdentifier = normalizeCandidateGalleryIdentifier(
    stripCandidateGallerySourceExtension(basename ?? normalizedPath)
  );
  if (stemIdentifier) {
    identifiers.add(stemIdentifier);
  }
};

const buildPublishedRobotMatchIdentifiers = (robot: IluGalleryPublishedRobot): string[] => {
  const identifiers = new Set<string>();
  [robot.file, robot.fileBase, robot.name].forEach((value) => {
    addCandidateGalleryIdentifier(identifiers, value);
  });
  return Array.from(identifiers);
};

const collectGalleryPreviewIdentifiers = (galleryPreview: IluGalleryEntry): Set<string> => {
  const identifiers = new Set<string>();
  [
    galleryPreview.urdfPath,
    galleryPreview.id,
    galleryPreview.sourceFile,
    galleryPreview.galleryFileBase,
    getUrdfNameFromPath(galleryPreview.urdfPath),
  ].forEach((value) => addCandidateGalleryIdentifier(identifiers, value));
  return identifiers;
};

const collectCandidateGalleryIdentifiers = (candidate: URDFCandidate): Set<string> => {
  const identifiers = new Set<string>();
  [
    candidate.path,
    candidate.name,
    candidate.displayName,
    candidate.sourceFile,
    candidate.fileBase,
    getUrdfNameFromPath(candidate.path),
  ].forEach((value) => addCandidateGalleryIdentifier(identifiers, value));
  return identifiers;
};

const buildCandidateGalleryPreviewIndex = (
  galleryPreviewByPath: Record<string, IluGalleryEntry>
): Map<string, IluGalleryEntry> => {
  const index = new Map<string, IluGalleryEntry>();
  Object.entries(galleryPreviewByPath).forEach(([key, galleryPreview]) => {
    const identifiers = collectGalleryPreviewIdentifiers(galleryPreview);
    addCandidateGalleryIdentifier(identifiers, key);
    identifiers.forEach((identifier) => {
      if (!index.has(identifier)) {
        index.set(identifier, galleryPreview);
      }
    });
  });
  return index;
};

const resolveCandidateGalleryPreview = (
  candidate: URDFCandidate,
  galleryPreviewIndex: Map<string, IluGalleryEntry>
): IluGalleryEntry | null => {
  for (const identifier of collectCandidateGalleryIdentifiers(candidate)) {
    const galleryPreview = galleryPreviewIndex.get(identifier);
    if (galleryPreview) {
      return galleryPreview;
    }
  }
  return null;
};

const buildMatchedGalleryRobotIdentifiers = (
  galleryPreviewByPath: Record<string, IluGalleryEntry>
): Set<string> => {
  const identifiers = new Set<string>();
  Object.values(galleryPreviewByPath).forEach((galleryPreview) => {
    collectGalleryPreviewIdentifiers(galleryPreview).forEach((identifier) => identifiers.add(identifier));
  });
  return identifiers;
};

const buildUnmatchedPublishedRobotLabels = (
  robots: IluGalleryPublishedRobot[],
  matchedGalleryRobotIdentifiers: Set<string>
): string[] =>
  robots
    .filter((robot) => {
      const robotIdentifiers = buildPublishedRobotMatchIdentifiers(robot);
      return (
        robotIdentifiers.length > 0 &&
        !robotIdentifiers.some((identifier) => matchedGalleryRobotIdentifiers.has(identifier))
      );
    })
    .map(buildPublishedRobotLabel)
    .filter((label): label is string => Boolean(label));

const buildCandidateGalleryRobotDetails = (galleryPreview: IluGalleryEntry | null): CandidateGalleryRobotDetails | null => {
  if (!galleryPreview) {
    return null;
  }

  const traits = galleryPreview.robotTraits;
  const family = formatCandidateGalleryTitleCase(
    traits?.primaryFamily || galleryPreview.macroTags?.find((tag) => Boolean(tag.trim())) || null
  );
  const statsLine = formatCandidateGalleryMetricLine([
    { label: "Meshes", value: galleryPreview.meshCount },
    { label: "Links", value: galleryPreview.linkCount ?? traits?.linkCount },
    { label: "Joints", value: galleryPreview.jointCount ?? traits?.jointCount },
  ]);
  const kinematicsLine = formatCandidateGalleryMetricLine([
    { label: "Arms", value: galleryPreview.armCount ?? traits?.armCount },
    { label: "Legs", value: galleryPreview.legCount ?? traits?.legCount },
    { label: "Wheels", value: galleryPreview.wheelCount ?? traits?.wheelCount },
  ]);
  const mappingName = formatCandidateGalleryMetadataText(galleryPreview.galleryFileBase || galleryPreview.id);
  const urdfName = formatCandidateGalleryMetadataText(
    galleryPreview.sourceFile || getUrdfNameFromPath(galleryPreview.urdfPath)
  );

  if (!family && !statsLine && !kinematicsLine && !mappingName && !urdfName) {
    return null;
  }

  return {
    family,
    mappingName,
    statsLine,
    kinematicsLine,
    urdfName,
  };
};

const buildCandidateGalleryMetadataRows = (
  publishedRepo: IluGalleryPublishedRepo | null,
  galleryPreviewByPath: Record<string, IluGalleryEntry>,
  galleryPreviewIndex: Map<string, IluGalleryEntry>,
  candidates: URDFCandidate[]
): CandidateGalleryMetadataRow[] => {
  if (!publishedRepo) {
    return [];
  }

  const unmatchedPublishedRobotLabels = buildUnmatchedPublishedRobotLabels(
    publishedRepo.robots,
    buildMatchedGalleryRobotIdentifiers(galleryPreviewByPath)
  );
  const robotMappingRows = candidates
    .map((candidate) => {
      const details = buildCandidateGalleryRobotDetails(resolveCandidateGalleryPreview(candidate, galleryPreviewIndex));
      if (!details) {
        return null;
      }
      const mappingParts = [
        details.mappingName ? `Gallery mapping ${details.mappingName}` : null,
        details.urdfName ? `Gallery source ${details.urdfName}` : null,
        details.family,
        details.statsLine,
        details.kinematicsLine,
      ].filter((part): part is string => Boolean(part));
      return mappingParts.length > 0 ? `${candidate.name}: ${mappingParts.join(" · ")}` : null;
    })
    .filter((row): row is string => Boolean(row));

  const metadataRows: CandidateGalleryMetadataRow[] = [
    { label: "Repository", value: publishedRepo.repo },
    { label: "Name", value: formatCandidateGalleryMetadataText(publishedRepo.name) },
    { label: "Org", value: formatCandidateGalleryMetadataText(publishedRepo.org) },
    { label: "Summary", value: formatCandidateGalleryMetadataText(publishedRepo.summary) },
    { label: "License", value: formatCandidateGalleryMetadataText(publishedRepo.license) },
    { label: "Tags", value: formatCandidateGalleryMetadataList(publishedRepo.tags) },
    { label: "Matched gallery robots", value: formatCandidateGalleryMetadataList(robotMappingRows) },
    {
      label: "Unmatched published gallery robots",
      value: formatCandidateGalleryMetadataList(unmatchedPublishedRobotLabels),
      tone: "warning",
    },
    { label: "Demo", value: formatCandidateGalleryMetadataText(publishedRepo.demo) },
    { label: "Website", value: formatCandidateGalleryMetadataText(publishedRepo.authorWebsite) },
    { label: "GitHub", value: formatCandidateGalleryMetadataText(publishedRepo.authorGithub) },
    { label: "Contact", value: formatCandidateGalleryMetadataText(publishedRepo.contact) },
    { label: "HF Datasets", value: formatCandidateGalleryMetadataList(publishedRepo.hfDatasets) },
    { label: "Stars", value: publishedRepo.stars == null ? null : String(publishedRepo.stars) },
    {
      label: "Updated",
      value: formatCandidateGalleryMetadataText(publishedRepo.updatedAt || publishedRepo.repoUpdatedAt),
    },
  ];

  return metadataRows.filter((row) => Boolean(row.value));
};

interface FolderUploadRobotLoaderProps {
  title: string;
  entryMode: FolderUploadEntryModeConfig;
  isLoadingGithub: boolean;
  isLoadInteractionLocked: boolean;
  isPreparingLocalSource: boolean;
  isRobotSourceDropActive: boolean;
  githubUrl: string;
  githubLoadButtonDisabled: boolean;
  githubLoadButtonLabel: string;
  loadedRobotName: string | null;
  stagedSetupRobotName: string | null;
  recentRepos: RecentRepo[];
  lastLocalFolder: string | null;
  assemblySources: AssemblySourcePreview[];
  activeAssemblySourceLabel: string | null;
  assemblyQueuedSelections: AssemblyQueuedSelectionPreview[];
  assemblyQueuedSelectionCount: number;
  maxAssemblyRobots: number;
  substitutionAssignments: SubstitutionAssignments;
  showUrdfDialog: boolean;
  candidateDialogTitle: string | null;
  candidateDialogDescription: string | null;
  urdfCandidates: URDFCandidate[];
  candidateGalleryPreviewByPath: Record<string, IluGalleryEntry>;
  candidateGalleryPublishedRepo: IluGalleryPublishedRepo | null;
  isLoadingCandidateGalleryPreviews: boolean;
  selectedCandidatePaths: string[];
  localSelectionFilesPresent: boolean;
  xacroGateUnavailableSuffix: string;
  xacroGateUnavailableMessage: string;
  hasSelectedPrimaryCandidate: boolean;
  onGithubUrlChange: (value: string) => void;
  onGithubLoad: () => void | Promise<unknown>;
  onBrowseFolder: () => void;
  onBrowseFiles?: () => void;
  onRobotSourceDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  onRobotSourceDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onRobotSourceDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onRobotSourceDrop: (event: React.DragEvent<HTMLDivElement>) => void | Promise<unknown>;
  onLoadRecentRepo: (repo: RecentRepo) => void | Promise<unknown>;
  onRemoveRecentRepo: (event: React.MouseEvent, repo: { owner: string; repo: string; path?: string }) => void;
  onClearLastLocalFolder: () => void;
  onClearLoadedRobotSelection: () => void;
  onClearStagedSetupRobot: () => void;
  onClearAssemblyQueue: () => void;
  onOpenAssemblySource: (sourceKey: string) => void;
  onRemoveAssemblySource: (sourceKey: string) => void;
  onRemoveAssemblyQueuedSelection: (id: string) => void;
  onAssignSubstitutionTarget: (target: SubstitutionTarget, selectionId: string) => void;
  onClearSubstitutionTarget: (target: SubstitutionTarget) => void;
  onCloseUrdfDialog: () => void;
  onSelectAllAssemblyCandidates: (visiblePaths?: string[]) => void;
  onClearAssemblyCandidates: () => void;
  onToggleAssemblyCandidate: (path: string) => void;
  onSelectSingleCandidate: (path: string) => void;
  onAssemblyLoadSelected: () => void | Promise<unknown>;
  onLoadRobotOnlyFromDialog: () => void | Promise<unknown>;
  onSelectRobotForSetup: () => void;
  onEditCandidateGalleryCards: () => void | Promise<unknown>;
}

const getRobotLoaderModeUi = (entryMode: FolderUploadEntryModeConfig) => {
  if (entryMode.isAssembly) {
    return {
      candidateSummary: (selectedCount: number, maxRobots: number) =>
        `${selectedCount}/${maxRobots} selected`,
      filterPlaceholder: "Filter robots",
      sourceDescription: "Add sources, then select robots.",
      intakeLabel: "Loaded Robot",
      dialogTitle: (sourceLabel: string | null) =>
        `Choose Robots${sourceLabel ? ` · ${sourceLabel}` : ""}`,
      dialogDescription: null,
    };
  }

  return {
    candidateSummary: () => null,
    filterPlaceholder: "Search robots",
    sourceDescription: "Load one robot source.",
    intakeLabel: "Loaded Robot",
    dialogTitle: () => "Choose Robot",
    dialogDescription: null,
  };
};

export function FolderUploadRobotLoader({
  title,
  entryMode,
  isLoadingGithub,
  isLoadInteractionLocked,
  isPreparingLocalSource,
  isRobotSourceDropActive,
  githubUrl,
  githubLoadButtonDisabled,
  githubLoadButtonLabel,
  loadedRobotName,
  stagedSetupRobotName,
  recentRepos,
  lastLocalFolder,
  assemblySources,
  activeAssemblySourceLabel,
  assemblyQueuedSelections,
  assemblyQueuedSelectionCount,
  maxAssemblyRobots,
  substitutionAssignments,
  showUrdfDialog,
  candidateDialogTitle,
  candidateDialogDescription,
  urdfCandidates,
  candidateGalleryPreviewByPath,
  candidateGalleryPublishedRepo,
  isLoadingCandidateGalleryPreviews,
  selectedCandidatePaths,
  localSelectionFilesPresent,
  xacroGateUnavailableSuffix,
  xacroGateUnavailableMessage,
  hasSelectedPrimaryCandidate,
  onGithubUrlChange,
  onGithubLoad,
  onBrowseFolder,
  onBrowseFiles,
  onRobotSourceDragEnter,
  onRobotSourceDragOver,
  onRobotSourceDragLeave,
  onRobotSourceDrop,
  onLoadRecentRepo,
  onRemoveRecentRepo,
  onClearLastLocalFolder,
  onClearLoadedRobotSelection,
  onClearStagedSetupRobot,
  onClearAssemblyQueue,
  onOpenAssemblySource,
  onRemoveAssemblySource,
  onRemoveAssemblyQueuedSelection,
  onAssignSubstitutionTarget,
  onClearSubstitutionTarget,
  onCloseUrdfDialog,
  onSelectAllAssemblyCandidates,
  onClearAssemblyCandidates,
  onToggleAssemblyCandidate,
  onSelectSingleCandidate,
  onAssemblyLoadSelected,
  onLoadRobotOnlyFromDialog,
  onSelectRobotForSetup,
  onEditCandidateGalleryCards,
}: FolderUploadRobotLoaderProps) {
  const [candidateFilter, setCandidateFilter] = useState("");
  const [hoveredCandidatePath, setHoveredCandidatePath] = useState<string | null>(null);
  const [showCandidateGalleryMetadata, setShowCandidateGalleryMetadata] = useState(false);
  const [loadedGalleryPreviewImageUrls, setLoadedGalleryPreviewImageUrls] = useState<Set<string>>(new Set());
  const [failedGalleryPreviewImageUrls, setFailedGalleryPreviewImageUrls] = useState<Set<string>>(new Set());
  const modeUi = getRobotLoaderModeUi(entryMode);
  const hasCandidateGalleryPreviews = Object.keys(candidateGalleryPreviewByPath).length > 0;
  const candidateGalleryPreviewIndex = useMemo(
    () => buildCandidateGalleryPreviewIndex(candidateGalleryPreviewByPath),
    [candidateGalleryPreviewByPath]
  );
  const candidateGalleryMetadataRows = useMemo(
    () =>
      buildCandidateGalleryMetadataRows(
        candidateGalleryPublishedRepo,
        candidateGalleryPreviewByPath,
        candidateGalleryPreviewIndex,
        urdfCandidates
      ),
    [
      candidateGalleryPreviewByPath,
      candidateGalleryPreviewIndex,
      candidateGalleryPublishedRepo,
      urdfCandidates,
    ]
  );
  const hasCandidateGalleryMetadata = candidateGalleryMetadataRows.length > 0;
  const hasUnmatchedCandidateGalleryMetadata = candidateGalleryMetadataRows.some((row) => row.tone === "warning");
  const shouldShowCandidateGalleryPreview =
    !entryMode.isAssembly &&
    (isLoadingCandidateGalleryPreviews || hasCandidateGalleryPreviews);
  const shouldShowCandidateGalleryInfo =
    !entryMode.isAssembly &&
    (isLoadingCandidateGalleryPreviews || hasCandidateGalleryPreviews || hasCandidateGalleryMetadata);
  const groupedAssemblySelections = assemblyQueuedSelections.reduce<
    Array<{ sourceKey: string; sourceLabel: string; items: AssemblyQueuedSelectionPreview[] }>
  >((groups, selection) => {
    const current = groups.find((group) => group.sourceKey === selection.sourceKey);
    if (current) {
      current.items.push(selection);
      return groups;
    }
    groups.push({
      sourceKey: selection.sourceKey,
      sourceLabel: selection.sourceLabel,
      items: [selection],
    });
    return groups;
  }, []);

  useEffect(() => {
    setCandidateFilter("");
  }, [activeAssemblySourceLabel, showUrdfDialog]);
  useEffect(() => {
    setHoveredCandidatePath(null);
  }, [showUrdfDialog]);
  useEffect(() => {
    setShowCandidateGalleryMetadata(false);
  }, [candidateGalleryPublishedRepo, showUrdfDialog]);
  useEffect(() => {
    setLoadedGalleryPreviewImageUrls(new Set());
    setFailedGalleryPreviewImageUrls(new Set());
  }, [candidateGalleryPreviewByPath]);

  const filteredCandidates = useMemo(() => {
    const query = candidateFilter.trim().toLowerCase();
    if (!query) {
      return urdfCandidates;
    }
    return urdfCandidates.filter((candidate) => {
      const name = candidate.name.toLowerCase();
      const path = candidate.path.toLowerCase();
      return name.includes(query) || path.includes(query);
    });
  }, [candidateFilter, urdfCandidates]);
  const getCandidateUnavailableMessage = (
    candidate: URDFCandidate,
    options: {
      isUnsupported: boolean;
      isAssemblyLocalXacroBlocked: boolean;
      isXacroBlocked: boolean;
      formats: string;
    }
  ): string | null => {
    if (options.isUnsupported) {
      return `This URDF uses unsupported mesh formats (${options.formats}). Only ${meshExtensionsDisplay()} files are supported.`;
    }
    if (options.isAssemblyLocalXacroBlocked) {
      return "Local-folder Assembly currently supports .urdf files only. GitHub xacro is supported.";
    }
    if (options.isXacroBlocked) {
      return xacroGateUnavailableMessage;
    }
    if (candidate.isXacro && Boolean(xacroGateUnavailableSuffix)) {
      return xacroGateUnavailableMessage;
    }
    return null;
  };
  const handleCandidateSelect = (
    candidate: URDFCandidate,
    options: {
      isUnsupported: boolean;
      isAssemblyLocalXacroBlocked: boolean;
      isXacroBlocked: boolean;
      formats: string;
    }
  ) => {
    const unavailableMessage = getCandidateUnavailableMessage(candidate, options);
    if (unavailableMessage) {
      toast.error(unavailableMessage, options.isUnsupported ? { duration: 6000 } : undefined);
      return;
    }
    if (entryMode.isAssembly) {
      onToggleAssemblyCandidate(candidate.path);
      return;
    }
    onSelectSingleCandidate(candidate.path);
  };

  const renderCandidateList = () => (
    <>
      <div className="space-y-2 pb-2">
        {modeUi.candidateSummary(assemblyQueuedSelectionCount, maxAssemblyRobots) ? (
          <div className="text-xs text-[#9d9d9d]">
            {modeUi.candidateSummary(assemblyQueuedSelectionCount, maxAssemblyRobots)}
          </div>
        ) : null}
        {shouldShowCandidateGalleryInfo ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9d9d9d]">
            <span>
              {isLoadingCandidateGalleryPreviews
                ? "Checking published gallery metadata..."
                : hasUnmatchedCandidateGalleryMetadata
                  ? (
                    <span className="inline-flex items-center gap-1 text-[#fca5a5]">
                      <AlertTriangle className="h-3 w-3" />
                      GitHub is the source of truth; some published gallery robots are unmatched.
                    </span>
                  )
                : hasCandidateGalleryPreviews
                  ? "Published gallery matches appear when robot paths or gallery identifiers line up."
                  : "Published gallery repo metadata is available; no exact robot matches yet."}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {hasCandidateGalleryMetadata ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCandidateGalleryMetadata((current) => !current)}
                  className={`h-7 px-2 text-[11px] hover:bg-[#2a2a2a] ${
                    hasUnmatchedCandidateGalleryMetadata ? "text-[#fca5a5]" : "text-[#c7c7c7]"
                  }`}
                >
                  <Info className="mr-1 h-3 w-3" />
                  View metadata
                </Button>
              ) : null}
              {hasCandidateGalleryPreviews || hasCandidateGalleryMetadata ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onEditCandidateGalleryCards();
                  }}
                  className="h-7 px-2 text-[11px] text-[#c7c7c7] hover:bg-[#2a2a2a]"
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit gallery info
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {showCandidateGalleryMetadata && hasCandidateGalleryMetadata ? (
          <div className="rounded-md border border-[#3d3d3d] bg-[#202020] px-3 py-2 text-[11px] text-[#c7c7c7]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[#d4d4d4]">
                {candidateGalleryPublishedRepo?.name || candidateGalleryPublishedRepo?.repo || "Gallery metadata"}
              </span>
              <span className="text-[#8a8a8a]">Published gallery snapshot</span>
            </div>
            <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {candidateGalleryMetadataRows.map((row) => (
                <div key={row.label} className={row.label === "Summary" ? "sm:col-span-2" : undefined}>
                  <span className={row.tone === "warning" ? "text-[#f87171]" : "text-[#8a8a8a]"}>
                    {row.label}:{" "}
                  </span>
                  <span className={row.tone === "warning" ? "break-words text-[#fca5a5]" : "break-words"}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7a7a7a]" />
            <Input
              type="text"
              value={candidateFilter}
              onChange={(event) => setCandidateFilter(event.target.value)}
              placeholder={modeUi.filterPlaceholder}
              className="h-8 w-full bg-[#1e1e1e] pl-8 text-[#d4d4d4] border-[#3d3d3d]"
            />
          </div>
          {entryMode.isAssembly && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleSelectAllFilteredCandidates}
                className="h-7 px-2 text-xs"
              >
                Select All
              </Button>
              <Button type="button" variant="ghost" onClick={onClearAssemblyCandidates} className="h-7 px-2 text-xs">
                Clear
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {filteredCandidates.length === 0 && (
          <div className="rounded-md border border-[#3d3d3d] bg-[#1e1e1e] px-3 py-4 text-xs text-[#9d9d9d]">
            No robots match the current filter.
          </div>
        )}
        {filteredCandidates.map((candidate, candidateIndex) => {
          const galleryPreview = resolveCandidateGalleryPreview(candidate, candidateGalleryPreviewIndex);
          const galleryRobotDetails = buildCandidateGalleryRobotDetails(galleryPreview);
          const galleryPreviewVideoUrl = galleryPreview?.videoUrl || null;
          const galleryPreviewHoverImageUrl =
            hoveredCandidatePath === candidate.path && !galleryPreviewVideoUrl
              ? galleryPreview?.previewUrl || null
              : null;
          const galleryPreviewImageUrl =
            galleryPreviewHoverImageUrl || galleryPreview?.thumbnailUrl || galleryPreview?.previewUrl || null;
          const galleryPreviewImageLoaded = galleryPreviewImageUrl
            ? loadedGalleryPreviewImageUrls.has(galleryPreviewImageUrl)
            : false;
          const galleryPreviewImageFailed = galleryPreviewImageUrl
            ? failedGalleryPreviewImageUrls.has(galleryPreviewImageUrl)
            : false;
          const shouldEagerLoadGalleryPreviewImage =
            candidateIndex < STUDIO_CANDIDATE_GALLERY_PREVIEW_EAGER_IMAGE_LIMIT;
          const shouldShowGalleryPreviewVideo =
            hoveredCandidatePath === candidate.path && Boolean(galleryPreviewVideoUrl);
          const isUnsupported = candidate.hasUnsupportedFormats === true && !candidate.isXacro;
          const isAssemblyLocalXacroBlocked =
            entryMode.isAssembly && candidate.isXacro && localSelectionFilesPresent;
          const isXacroBlocked = candidate.isXacro && Boolean(xacroGateUnavailableSuffix);
          const isUnavailable = isUnsupported || isAssemblyLocalXacroBlocked || isXacroBlocked;
          const hasUnmatched = (candidate.unmatchedMeshReferences?.length ?? 0) > 0;
          const formats = candidate.unsupportedFormats?.join(", ") || "";
          const unmatchedRefs = candidate.unmatchedMeshReferences || [];
          const isSelected = selectedCandidatePaths.includes(candidate.path);

          return (
            <div key={candidate.path} className="space-y-2">
              <Button
                variant="secondary"
                className={`w-full justify-start text-left h-auto py-3 border ${
                  isUnavailable
                    ? "opacity-50 cursor-not-allowed bg-[#1e1e1e] text-[#6d6d6d] border-[#3d3d3d] focus-visible:ring-[#3d3d3d]"
                    : isSelected
                      ? "bg-[#313131] text-[#d4d4d4] hover:bg-[#3b3b3b] border-[#6a6a6a] focus-visible:ring-[#6a6a6a] focus-visible:ring-offset-0"
                      : "bg-[#1e1e1e] text-[#d4d4d4] hover:bg-[#2a2a2a] border-[#3d3d3d] focus-visible:ring-[#3d3d3d] focus-visible:ring-offset-0"
                }`}
                onClick={() => {
                  handleCandidateSelect(candidate, {
                    isUnsupported,
                    isAssemblyLocalXacroBlocked,
                    isXacroBlocked,
                    formats,
                  });
                }}
                onMouseEnter={() => {
                  setHoveredCandidatePath(candidate.path);
                }}
                onMouseLeave={() => {
                  setHoveredCandidatePath((current) => (current === candidate.path ? null : current));
                }}
                disabled={isUnavailable}
              >
                <div className="flex w-full items-start gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 w-full">
                      {entryMode.isAssembly && (
                        <Checkbox
                          checked={isSelected}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() => onToggleAssemblyCandidate(candidate.path)}
                          className="h-3.5 w-3.5 border-[#5a5a5a] data-[state=checked]:bg-[#b8b8b8] data-[state=checked]:text-[#1e1e1e]"
                          aria-label={`Select ${candidate.name}`}
                        />
                      )}
                      <span className={`font-medium ${isUnavailable ? "text-muted-foreground" : ""}`}>
                        {candidate.name}
                      </span>
                      {candidate.isXacro && !isUnavailable && (
                        <span className="text-xs bg-[#3a3a3a] text-[#b8b8b8] px-2 py-0.5 rounded">
                          Xacro
                        </span>
                      )}
                      {!isUnavailable && candidate.hasMeshesFolder && (
                        <span className="text-xs bg-[#4a4a4a] text-[#b8b8b8] px-2 py-0.5 rounded">
                          Has Meshes
                        </span>
                      )}
                      {isUnsupported && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Unsupported Formats
                        </span>
                      )}
                      {isXacroBlocked && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {xacroGateUnavailableSuffix}
                        </span>
                      )}
                      {isAssemblyLocalXacroBlocked && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Local assembly requires .urdf
                        </span>
                      )}
                      {!isUnavailable && hasUnmatched && (
                        <span className="text-xs bg-[#5a4a2a] text-[#d4a85a] px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Missing Meshes
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{candidate.path}</span>
                    {galleryRobotDetails ? (
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-2">
                          {galleryRobotDetails.family ? (
                            <span className="font-medium text-[#c7c7c7]">{galleryRobotDetails.family}</span>
                          ) : null}
                        </div>
                        {galleryRobotDetails.statsLine ? <div>{galleryRobotDetails.statsLine}</div> : null}
                        {galleryRobotDetails.kinematicsLine ? <div>{galleryRobotDetails.kinematicsLine}</div> : null}
                      </div>
                    ) : null}
                    {isUnsupported && (
                      <span className="text-xs text-muted-foreground font-medium mt-1">
                        Uses unsupported formats: {formats}. Only {meshExtensionsDisplay()} files are supported.
                      </span>
                    )}
                    {isXacroBlocked && (
                      <span className="text-xs text-muted-foreground font-medium mt-1">
                        Xacro expansion disabled: {xacroGateUnavailableSuffix}.
                      </span>
                    )}
                    {isAssemblyLocalXacroBlocked && (
                      <span className="text-xs text-muted-foreground font-medium mt-1">
                        Local-folder Assembly currently supports .urdf files only.
                      </span>
                    )}
                  </div>
                  {shouldShowCandidateGalleryPreview ? (
                    <div className="w-28 shrink-0">
                      {shouldShowGalleryPreviewVideo && galleryPreviewVideoUrl ? (
                        <video
                          src={galleryPreviewVideoUrl}
                          poster={galleryPreview.thumbnailUrl || galleryPreview.previewUrl || undefined}
                          className="h-20 w-28 rounded-md border border-[#3d3d3d] object-cover"
                          autoPlay
                          loop
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : galleryPreviewImageUrl ? (
                        <div className="relative h-20 w-28 overflow-hidden rounded-md border border-[#3d3d3d] bg-[#202020]">
                          {!galleryPreviewImageLoaded || galleryPreviewImageFailed ? (
                            <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10px] text-[#8a8a8a]">
                              {galleryPreviewImageFailed
                                ? galleryPreviewHoverImageUrl
                                  ? "Preview unavailable"
                                  : "Thumbnail unavailable"
                                : galleryPreviewHoverImageUrl
                                  ? "Loading preview..."
                                  : "Loading thumbnail..."}
                            </div>
                          ) : null}
                          <img
                            src={galleryPreviewImageUrl}
                            alt={`${candidate.name} gallery ${galleryPreviewHoverImageUrl ? "preview" : "thumbnail"}`}
                            loading={shouldEagerLoadGalleryPreviewImage ? "eager" : "lazy"}
                            decoding="async"
                            {...({
                              fetchpriority: shouldEagerLoadGalleryPreviewImage ? "high" : "auto",
                            } as { fetchpriority: "high" | "auto" })}
                            onLoad={() => {
                              setLoadedGalleryPreviewImageUrls((current) => {
                                if (current.has(galleryPreviewImageUrl)) {
                                  return current;
                                }
                                const next = new Set(current);
                                next.add(galleryPreviewImageUrl);
                                return next;
                              });
                            }}
                            onError={() => {
                              setFailedGalleryPreviewImageUrls((current) => {
                                if (current.has(galleryPreviewImageUrl)) {
                                  return current;
                                }
                                const next = new Set(current);
                                next.add(galleryPreviewImageUrl);
                                return next;
                              });
                            }}
                            className={`h-full w-full object-cover transition-opacity duration-150 ${
                              galleryPreviewImageLoaded && !galleryPreviewImageFailed ? "opacity-100" : "opacity-0"
                            }`}
                          />
                        </div>
                      ) : (
                        <div className="flex h-20 w-28 items-center justify-center rounded-md border border-dashed border-[#3d3d3d] bg-[#202020] px-2 text-center text-[10px] text-[#7a7a7a]">
                          No gallery thumbnail
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </Button>
              {!isUnavailable && hasUnmatched && (
                <div className="ml-4 p-2 bg-[#2a2518] border border-[#4a3d2a] rounded-md">
                  <div className="text-xs font-medium text-[#d4a85a] mb-1">
                    Unmatched URDF References
                  </div>
                  <div className="text-xs text-[#b89a6a] mb-1">
                    These mesh files are referenced in the URDF but were not found:
                  </div>
                  <ul className="text-xs text-[#b89a6a] list-disc list-inside space-y-0.5">
                    {unmatchedRefs.map((ref, idx) => (
                      <li key={idx}>{ref}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
  const handleRemoveRecentRepoClick = (
    event: React.MouseEvent,
    repo: { owner: string; repo: string; path?: string }
  ) => {
    onRemoveRecentRepo(event, repo);
  };
  const handleLoadRecentRepoClick = (repo: RecentRepo) => {
    onLoadRecentRepo(repo);
  };
  const handleClearLastLocalFolderClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onClearLastLocalFolder();
    toast.success("Cleared last folder");
  };
  const handleSelectAllFilteredCandidates = () => {
    onSelectAllAssemblyCandidates(filteredCandidates.map((candidate) => candidate.path));
  };
  const handleOpenAssemblySourceClick = (sourceKey: string) => {
    onOpenAssemblySource(sourceKey);
  };
  const handleRemoveAssemblySourceClick = (sourceKey: string) => {
    onRemoveAssemblySource(sourceKey);
  };
  const handleRemoveAssemblyQueuedSelectionClick = (id: string) => {
    onRemoveAssemblyQueuedSelection(id);
  };
  const renderAssignmentButton = ({
    label,
    isActive,
    onClick,
  }: {
    label: string;
    isActive: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        isActive
          ? "bg-[#ff63d5]/15 text-foreground"
          : "bg-background/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
  const renderRemovableBadge = ({
    label,
    onRemove,
    ariaLabel,
    title,
  }: {
    label: string;
    onRemove: () => void;
    ariaLabel: string;
    title?: string;
  }) => (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
      title={title}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
        aria-label={ariaLabel}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
  const renderSourceChip = ({
    key,
    icon,
    label,
    onClick,
    onRemove,
    removeAriaLabel,
    title,
    disabled = false,
  }: {
    key: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    onRemove: (event: React.MouseEvent) => void;
    removeAriaLabel: string;
    title?: string;
    disabled?: boolean;
  }) => (
    <div
      key={key}
      className={`group relative flex w-fit max-w-full items-center gap-0.5 rounded-md border border-border/30 bg-background/14 px-1 py-0.5 transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:border-border/45 hover:bg-background/22"
      }`}
      onClick={() => {
        if (!disabled) {
          onClick();
        }
      }}
      title={title}
    >
      <span className="text-muted-foreground/80">{icon}</span>
      <span className="max-w-[132px] truncate whitespace-nowrap text-[11px] font-medium text-muted-foreground">{label}</span>
      <button
        onClick={(event) => {
          if (!disabled) {
            onRemove(event);
          }
        }}
        disabled={disabled}
        className="opacity-0 group-hover:opacity-100 flex-shrink-0 rounded p-0.5 transition-opacity hover:bg-destructive/20"
        aria-label={removeAriaLabel}
      >
        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
  const renderAssemblyPanel = ({
    title,
    headerMeta,
    children,
  }: {
    title: string;
    headerMeta?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div className="space-y-2 rounded-md border border-dashed border-border/70 bg-background/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{title}</div>
        {headerMeta}
      </div>
      {children}
    </div>
  );

  return (
    <>
      <div className="space-y-4">
        <div
          className={`space-y-4 rounded-lg border p-4 transition-colors ${
            isRobotSourceDropActive
              ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05]"
              : "border-border bg-background/40"
          }`}
          onDragEnter={onRobotSourceDragEnter}
          onDragOver={onRobotSourceDragOver}
          onDragLeave={onRobotSourceDragLeave}
          onDrop={(event) => {
            void onRobotSourceDrop(event);
          }}
        >
          <div>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{title}</p>
            </div>
          </div>
          <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
              <p>
                Load a
                <code className="text-[11px] bg-muted px-1 py-0.5 rounded"> .urdf </code>
                or
                <code className="text-[11px] bg-muted px-1 py-0.5 rounded"> .xacro </code>
                plus meshes (<code className="text-[11px] bg-muted px-1 py-0.5 rounded">{meshExtensionsDisplay()}</code>).
              </p>
            </div>
            <a
              href="https://www.urdfstudio.com/robots"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-block text-xs text-[#ff63d5]/60 underline-offset-2 hover:text-[#ff63d5]/80 hover:underline"
            >
              Explore Gallery →
            </a>
          </div>
          <div className="space-y-3">
            <div className="flex w-full flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
              <div
                className={`flex w-full items-center gap-1.5 rounded-md border border-dashed px-3 py-2.5 transition-colors sm:w-auto sm:shrink-0 ${
                  isRobotSourceDropActive
                    ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.06] text-foreground"
                    : "border-border/70 bg-background/55 text-muted-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isPreparingLocalSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                  <span>Drag folder/files/zip</span>
                  <button
                    type="button"
                    onClick={onBrowseFiles ?? onBrowseFolder}
                    disabled={isLoadInteractionLocked}
                    className="text-[11px] font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Browse Locally
                  </button>
                </div>
              </div>
              <div className="flex w-full min-w-0 items-center gap-1.5 sm:flex-1">
                <Input
                  type="text"
                  placeholder="owner/repo or https://github.com/owner/repo"
                  value={githubUrl}
                  onChange={(e) => onGithubUrlChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isLoadingGithub && !isLoadInteractionLocked) {
                      onGithubLoad();
                    }
                  }}
                  disabled={isLoadingGithub || isLoadInteractionLocked}
                  className="min-w-0 flex-1 bg-background/80"
                />
                <Button
                  onClick={onGithubLoad}
                  disabled={githubLoadButtonDisabled || isLoadInteractionLocked}
                  size="sm"
                  className="h-6 w-[72px] shrink-0 justify-center border border-border bg-muted px-2 text-[10px] text-foreground hover:bg-muted/80"
                >
                  {isLoadingGithub ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Github className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {githubLoadButtonLabel}
                </Button>
              </div>
            </div>
          </div>
          {loadedRobotName || stagedSetupRobotName ? (
            <div className="space-y-2 rounded-md border border-border/55 bg-background/28 p-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                <span>{modeUi.intakeLabel}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {loadedRobotName
                  ? renderRemovableBadge({
                      label: loadedRobotName,
                      onRemove: onClearLoadedRobotSelection,
                      ariaLabel: "Clear loaded robot",
                    })
                  : null}
                {stagedSetupRobotName
                  ? renderRemovableBadge({
                      label: `Setup · ${stagedSetupRobotName}`,
                      onRemove: onClearStagedSetupRobot,
                      ariaLabel: "Clear staged setup robot",
                    })
                  : null}
              </div>
            </div>
          ) : null}
          {!entryMode.isAssembly && !loadedRobotName && !stagedSetupRobotName ? (
            <div className="space-y-1">
              {recentRepos.length === 0 && !lastLocalFolder ? (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>recent robots:</span>
                  <span className="text-xs">No recent robot sources yet.</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>recent robots:</span>
                  </div>
                  {recentRepos.map((repo) =>
                    renderSourceChip({
                      key: `${repo.owner}/${repo.repo}${repo.path ? `/${repo.path}` : ""}`,
                      icon: <Github className="w-3 h-3 flex-shrink-0" />,
                      label: repo.displayName,
                      onClick: () => {
                        if (!isLoadInteractionLocked) {
                          handleLoadRecentRepoClick(repo);
                        }
                      },
                      onRemove: (event) => handleRemoveRecentRepoClick(event, repo),
                      disabled: isLoadInteractionLocked,
                      removeAriaLabel: "Remove from recent",
                    })
                  )}
                  {lastLocalFolder && (
                    renderSourceChip({
                      key: `local:${lastLocalFolder}`,
                      icon: <Folder className="w-3 h-3 flex-shrink-0" />,
                      label: `local · ${lastLocalFolder}`,
                      onClick: () => {
                        if (!isLoadInteractionLocked) {
                          onBrowseFolder();
                        }
                      },
                      onRemove: handleClearLastLocalFolderClick,
                      disabled: isLoadInteractionLocked,
                      removeAriaLabel: "Clear last folder",
                      title: `Click to browse and select "${lastLocalFolder}" again`,
                    })
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
        {entryMode.isAssembly && assemblySources.length > 0 &&
          renderAssemblyPanel({
            title: "Sources",
            headerMeta: (
              <div className="text-[11px] text-muted-foreground">
                {assemblySources.length} source{assemblySources.length === 1 ? "" : "s"}
              </div>
            ),
            children: (
              <div className="space-y-2">
                {assemblySources.map((source) => (
                  <div
                    key={source.sourceKey}
                    className={`rounded-md border p-2 ${
                      activeAssemblySourceLabel === source.sourceLabel
                        ? "border-[#6a6a6a] bg-background/50"
                        : "border-border/60 bg-background/35"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">
                          {source.sourceLabel}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {source.candidateCount} robot{source.candidateCount === 1 ? "" : "s"} found
                          {source.selectedCount > 0
                            ? ` · ${source.selectedCount} selected`
                            : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleOpenAssemblySourceClick(source.sourceKey)}
                          className="h-6 px-2 text-[11px] text-[#ff63d5]/85 hover:text-[#ff63d5]"
                        >
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleRemoveAssemblySourceClick(source.sourceKey)}
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ),
          })}
        {entryMode.isAssembly &&
          renderAssemblyPanel({
            title: "Queue",
            headerMeta: (
              <div className="flex items-center gap-1">
                <div className="text-[11px] text-muted-foreground">
                  {assemblyQueuedSelections.length} robot{assemblyQueuedSelections.length === 1 ? "" : "s"}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClearAssemblyQueue}
                  disabled={assemblyQueuedSelections.length === 0}
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:text-muted-foreground/50"
                >
                  Clear
                </Button>
              </div>
            ),
            children: assemblyQueuedSelections.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  Assign `Host` and `Element` from this queue when you want to open substitution.
                </div>
                {groupedAssemblySelections.map((group) => (
                  <div key={group.sourceKey} className="rounded-md border border-border/60 bg-background/40 p-2">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {group.sourceLabel}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.items.map((queued) => {
                        const isHost = substitutionAssignments.host === queued.id;
                        const isElement = substitutionAssignments.element === queued.id;
                        return (
                          <div
                            key={queued.id}
                            className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/25 px-2 py-1"
                            title={`${queued.name} · ${group.sourceLabel}`}
                          >
                            <span className="max-w-[180px] truncate text-xs text-foreground">
                              {queued.name}
                            </span>
                            {renderAssignmentButton({
                              label: "Host",
                              isActive: isHost,
                              onClick: () =>
                                (isHost
                                  ? onClearSubstitutionTarget("host")
                                  : onAssignSubstitutionTarget("host", queued.id)),
                            })}
                            {renderAssignmentButton({
                              label: "Element",
                              isActive: isElement,
                              onClick: () =>
                                (isElement
                                  ? onClearSubstitutionTarget("element")
                                  : onAssignSubstitutionTarget("element", queued.id)),
                            })}
                            <button
                              type="button"
                              onClick={() => handleRemoveAssemblyQueuedSelectionClick(queued.id)}
                              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                              aria-label={`Remove ${queued.name} from assembly queue`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No robots selected yet. Up to {maxAssemblyRobots} robots.
              </div>
            ),
          })}
        {entryMode.isAssembly && showUrdfDialog && (
          <div className="space-y-3 rounded-md border border-border/70 bg-[#282828] p-3 text-[#d4d4d4]">
            <div className="text-sm font-medium text-[#d4d4d4]">
              {modeUi.dialogTitle(activeAssemblySourceLabel)}
            </div>
            {renderCandidateList()}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={onCloseUrdfDialog}
                className="text-[#9d9d9d] hover:text-[#d4d4d4]"
              >
                Done
              </Button>
              <Button
                variant="secondary"
                onClick={onAssemblyLoadSelected}
                disabled={
                  selectedCandidatePaths.length === 0 ||
                  assemblyQueuedSelectionCount >= maxAssemblyRobots
                }
                className="bg-[#3d3d3d] text-[#d4d4d4] border-[#5a5a5a] hover:bg-[#4a4a4a]"
              >
                Add to Queue ({selectedCandidatePaths.length})
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!entryMode.isAssembly && showUrdfDialog} onOpenChange={(open) => !open && onCloseUrdfDialog()}>
        <DialogContent className="max-w-4xl bg-[#282828] border-[#3d3d3d] text-[#d4d4d4]">
          <DialogHeader>
            <DialogTitle className="text-[#d4d4d4]">
              {candidateDialogTitle ?? modeUi.dialogTitle(null)}
            </DialogTitle>
            {candidateDialogDescription || modeUi.dialogDescription ? (
              <DialogDescription className="text-[#9d9d9d]">
                {candidateDialogDescription ?? modeUi.dialogDescription}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {renderCandidateList()}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={onLoadRobotOnlyFromDialog}
              disabled={!hasSelectedPrimaryCandidate}
              className="h-8 bg-[#3d3d3d] text-[#d4d4d4] border-[#5a5a5a] px-3 text-xs hover:bg-[#4a4a4a]"
            >
              Load
            </Button>
            <Button
              variant="secondary"
              onClick={onSelectRobotForSetup}
              disabled={!hasSelectedPrimaryCandidate}
              className="h-8 bg-[#3d3d3d] text-[#d4d4d4] border-[#5a5a5a] px-3 text-xs hover:bg-[#4a4a4a]"
            >
              Setup
            </Button>
            <Button
              variant="outline"
              onClick={onCloseUrdfDialog}
              className="h-8 bg-[#1e1e1e] text-[#d4d4d4] border-[#3d3d3d] px-3 text-xs hover:bg-[#2a2a2a] hover:border-[#4a4a4a]"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
