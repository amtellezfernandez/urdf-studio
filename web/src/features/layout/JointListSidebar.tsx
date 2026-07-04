import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { JointControl } from "@/features/layout/JointControl";
import { Camera as CameraIcon, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  type JointAxisMap,
  type JointLimits,
  type LinkData,
} from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { useObjectStore } from "@/features/objects";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useJointStore } from "@/shared/store/useJointStore";
import { useLinkHighlightStore } from "@/shared/store/useLinkHighlightStore";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { getJointColor } from "@/features/urdf/utils/jointColors";
import { addCollisionToLink } from "@/features/urdf/editor/updateLinkData";
import type { URDFRobot } from "urdf-loader";
import { LinkControl } from "@/features/urdf/editor/LinkEditor";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import {
  buildFilteredJointNames,
  buildHierarchyTree,
  buildJointTypes,
} from "@/features/layout/sidebarSelectors";
import {
  filterLinksForSidebar,
  resolveLinkSidebarInteractionState,
  type LinkSidebarViewMode,
} from "@/features/layout/linkSidebarFilters";
import { buildRobotStructureLabels } from "@/features/layout/robotStructureLabels";
import {
  expandStructureSectionsContainingItem,
  toGroupDisplayLabel,
} from "@/features/layout/structureGroups";
import {
  buildAlphabeticalLinkSections,
  buildMeshGroupedLinkSections,
  type LinkSidebarGroupingMode,
} from "@/features/layout/linkSidebarGrouping";
import {
  TOP_NAV_HEIGHT,
  VIEWPORT_HEIGHT_WITH_TOP_NAV,
} from "@/features/layout/page/constants";
import { applyCollisionSimplifyToSelectedLinks } from "@/features/viewer/collisionSimplifySelection";
import {
  removeMergedCollisionLinks,
  replaceMergedCollisionLinks,
} from "@/features/viewer/collisionMergeSelection";
import { useStructureGroupEditor } from "@/features/layout/useStructureGroupEditor";
import {
  areStringSetsEqual,
  reconcileCollapsedSectionIds,
} from "@/features/layout/structureSectionVisibility";
import { resolveEffectiveEndEffectorLink } from "@/features/layout/endEffectorSelection";
import {
  advanceJointActivityState,
  createInitialJointActivityState,
  resolveActiveJointNameSet,
} from "@/features/layout/jointActivity";
import { JOINT_ACTIVITY_PARAMS } from "@/features/layout/jointActivityParams";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  JOINT_LIST_SIDEBAR_PARAMS,
} from "@/features/layout/jointListSidebarParams";
import { parseJointEffortLimits } from "@/features/layout/jointEffortLimits";
import { HierarchyJointBrowserView } from "@/features/layout/HierarchyJointBrowserView";
import { SidebarWorldSection } from "@/features/layout/SidebarWorldSection";
import { CameraEditorPanel } from "@/features/layout/CameraEditorPanel";
import { ObjectEditorPanel } from "@/features/layout/ObjectEditorPanel";
import { LinkBatchEditorPanel } from "@/features/layout/LinkBatchEditorPanel";
import { SidebarStructureControls } from "@/features/layout/SidebarStructureControls";
import { LinkBrowserView } from "@/features/layout/LinkBrowserView";
import { FlatJointBrowserView } from "@/features/layout/FlatJointBrowserView";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import {
  countSelectedValues,
  filterStringArrayMembers,
  filterStringSetMembers,
  toggleSelectAllStringSetValues,
  toggleStringSetGroup,
  toggleStringSetValue,
} from "@/features/layout/jointListSidebarSelection";


const JOINT_LIST_CLASS_NAMES = JOINT_LIST_SIDEBAR_PARAMS.classNames;

const SIDEBAR_PANEL_LAYOUT = JOINT_LIST_SIDEBAR_PARAMS.panelLayout;
const SIDEBAR_SECTION_CLASS = JOINT_LIST_CLASS_NAMES.sidebarSection;
const SIDEBAR_SECTION_HEADER_CLASS = JOINT_LIST_CLASS_NAMES.sidebarSectionHeader;
const MIN_LINK_BATCH_SELECTION_FOR_EDITOR = JOINT_LIST_SIDEBAR_PARAMS.minLinkBatchSelectionForEditor;
const STRUCTURE_SUBGROUP_ACTION_BUTTON_CLASS = JOINT_LIST_CLASS_NAMES.structureSubgroupActionButton;

interface JointListSidebarProps {
  availableJoints: string[];
  availableLinks?: string[];
  jointLimits: JointLimits;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  hoveredLink?: string | null;
  onJointSelect?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
  onJointHover?: (jointName: string | null) => void;
  hoveredJoint?: string | null;
  deletedJoints?: Set<string>;
  width?: number;
  isCollapsed?: boolean;
  angleUnit?: "rad" | "deg";
  onAngleUnitChange?: (unit: "rad" | "deg") => void;
  urdfContent?: string;
  urdfAnalysis?: UrdfAnalysis | null;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  onJointChange?: (jointName: string, value: number) => void;
  onJointAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onJointOriginChange?: (
    jointName: string,
    xyz: [number, number, number],
    rpy: [number, number, number]
  ) => void;
  onResetAxis?: (jointName: string) => void;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointLimitsChange?: (
    jointName: string,
    lowerLimit?: number | null,
    upperLimit?: number | null
  ) => void;
  onJointVelocityChange?: (jointName: string, velocity: number | null) => void;
  onJointEffortChange?: (jointName: string, effort: number | null) => void;
  onJointNameChange?: (oldName: string, newName: string) => boolean | void;
  onDeleteJoint?: (jointName: string) => void;
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  // Link editing props
  meshFiles?: Record<string, Blob>;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onLinkNameChange?: (oldName: string, newName: string) => void;
  onUrdfChange?: (newContent: string) => void;
  collisionVisibility?: CollisionVisibility;
  onCollisionVisibilityChange?: (visibility: CollisionVisibility) => void;
  collisionSimplifyLinks?: string[];
  onCollisionSimplifyLinksChange?: (links: string[]) => void;
  collisionMergedLinks?: string[];
  onCollisionMergedLinksChange?: (links: string[]) => void;
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
  endEffectorCandidates?: string[];
  onMarkAsEndEffector?: (linkName: string | null) => void;
  onGenerateInertialDraft?: (linkName: string, densityPresetId: InertialDensityPresetId) => void;
  simulationPrepPanelOpen?: boolean;
  voxelDerivedInertialLinks?: string[];
}

type StructureViewMode = "links" | "flat" | "hierarchy";
type SidebarViewMode = StructureViewMode;

const STRUCTURE_MODE_OPTIONS: Array<{
  value: StructureViewMode;
  baseLabel: string;
  requiresUrdf?: boolean;
}> = [
  { value: "flat", baseLabel: "Joints" },
  { value: "links", baseLabel: "Links", requiresUrdf: true },
  { value: "hierarchy", baseLabel: "Hierarchy", requiresUrdf: true },
];

export const JointListSidebar = ({
  availableJoints,
  availableLinks = [],
  jointLimits,
  selectedJoint,
  selectedLink: selectedLinkProp,
  hoveredLink: hoveredLinkProp,
  onJointSelect,
  onLinkSelect,
  onJointHover,
  hoveredJoint,
  deletedJoints = new Set(),
  width = DEFAULT_RIGHT_SIDEBAR_WIDTH,
  isCollapsed = false,
  angleUnit: angleUnitProp,
  onAngleUnitChange: onAngleUnitChangeProp,
  urdfContent,
  urdfAnalysis,
  jointAxes = {},
  originalJointAxes = {},
  onJointChange,
  onJointAxisChange,
  onJointOriginChange,
  onResetAxis,
  onJointTypeChange,
  onJointLimitsChange,
  onJointVelocityChange,
  onJointEffortChange,
  onJointNameChange,
  onDeleteJoint,
  onJointLinkChange,
  meshFiles = {},
  onMaterialChange,
  onLinkNameChange,
  onUrdfChange,
  collisionVisibility = {},
  onCollisionVisibilityChange,
  collisionSimplifyLinks = [],
  onCollisionSimplifyLinksChange,
  collisionMergedLinks = [],
  onCollisionMergedLinksChange,
  robot,
  endEffectorLink,
  endEffectorCandidates = [],
  onMarkAsEndEffector,
  onGenerateInertialDraft,
  simulationPrepPanelOpen = false,
  voxelDerivedInertialLinks = [],
}: JointListSidebarProps) => {
  // Use prop if provided, otherwise default to "rad"
  const angleUnit = angleUnitProp ?? "rad";
  const onAngleUnitChange = onAngleUnitChangeProp ?? (() => {});

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<SidebarViewMode>("flat");
  const [linkGroupingMode, setLinkGroupingMode] = useState<LinkSidebarGroupingMode>("body");
  const effectiveStructureViewMode: SidebarViewMode = viewMode;
  const [collapsedLinkSectionIds, setCollapsedLinkSectionIds] = useState<Set<string>>(new Set());
  const [collapsedJointSectionIds, setCollapsedJointSectionIds] = useState<Set<string>>(new Set());
  const knownLinkSectionIdsRef = useRef<Set<string>>(new Set());
  const knownJointSectionIdsRef = useRef<Set<string>>(new Set());
  const jointActivityStateRef = useRef(createInitialJointActivityState());
  const [activeMovingJointNames, setActiveMovingJointNames] = useState<Set<string>>(new Set());
  const liveJointValues = useJointStore((state) => state.jointValues);
  const liveJointValuesRef = useRef<Record<string, number>>({});
  const jointEffortLimits = useMemo(() => parseJointEffortLimits(urdfContent), [urdfContent]);

  // Use selectedLink from props instead of local state
  const selectedLink = selectedLinkProp ?? null;
  const hoveredLink = hoveredLinkProp ?? null;
  const setSelectedLink = useCallback((linkName: string | null) => {
    onLinkSelect?.(linkName);
  }, [onLinkSelect]);
  const [selectedBatchLinks, setSelectedBatchLinks] = useState<Set<string>>(new Set());
  const selectedBatchLinkNames = useMemo(
    () => Array.from(selectedBatchLinks).sort((lhs, rhs) => lhs.localeCompare(rhs)),
    [selectedBatchLinks]
  );
  const simplifiedLinkSet = useMemo(
    () => new Set(collisionSimplifyLinks),
    [collisionSimplifyLinks]
  );
  const mergedLinkSet = useMemo(
    () => new Set(collisionMergedLinks),
    [collisionMergedLinks]
  );
  const voxelDerivedInertialLinkSet = useMemo(
    () => new Set(voxelDerivedInertialLinks),
    [voxelDerivedInertialLinks]
  );
  const linkSidebarInteractionState = useMemo(
    () =>
      resolveLinkSidebarInteractionState({
        currentViewMode: viewMode as LinkSidebarViewMode,
        simulationPrepPanelOpen,
        selectedLink,
        hoveredLink,
      }),
    [hoveredLink, selectedLink, simulationPrepPanelOpen, viewMode]
  );
  const highlightedLinkName = linkSidebarInteractionState.highlightedLinkName;
  const analysis = useMemo(() => {
    if (urdfAnalysis) return urdfAnalysis;
    if (!urdfContent) return null;
    return analyzeUrdf(urdfContent);
  }, [urdfAnalysis, urdfContent]);
  const structureLabels = useMemo(
    () => buildRobotStructureLabels(analysis, urdfContent),
    [analysis, urdfContent]
  );
  const isAnalysisInvalid = urdfAnalysis?.isValid === false;
  const hasMultipleEndEffectors = endEffectorCandidates.length > 1;
  const panelRows = SIDEBAR_PANEL_LAYOUT.structureRows;
  const jointHierarchy = analysis?.jointHierarchy ?? null;
  const totalJointCount = useMemo(
    () => Object.keys(jointLimits).length,
    [jointLimits]
  );
  const allLinks = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.linkNames].sort();
  }, [analysis]);
  const structureModeOptions = useMemo(
    () =>
      STRUCTURE_MODE_OPTIONS.map((option) => {
        if (option.value === "flat") {
          return {
            ...option,
            label: `${option.baseLabel} (${totalJointCount})`,
          };
        }
        if (option.value === "links") {
          return {
            ...option,
            label: `${option.baseLabel} (${allLinks.length})`,
          };
        }
        return {
          ...option,
          label: option.baseLabel,
        };
      }),
    [allLinks.length, totalJointCount]
  );
  const colorJointNames = availableJoints;
  const effectiveEndEffectorLink = useMemo(
    () =>
      resolveEffectiveEndEffectorLink({
        explicitEndEffectorLink: endEffectorLink,
        endEffectorCandidates,
        availableLinks: allLinks,
      }),
    [allLinks, endEffectorCandidates, endEffectorLink]
  );
  const structureIdentityKey = useMemo(
    () => `${availableJoints.join("|")}::${allLinks.join("|")}::${linkGroupingMode}`,
    [allLinks, availableJoints, linkGroupingMode]
  );
  const previousStructureIdentityKeyRef = useRef<string | null>(null);
  const linksWithCollisionSet = useMemo(() => {
    if (!analysis?.isValid) return new Set<string>();
    const collisionLinkNames = Object.entries(analysis.collisionsByLink)
      .filter(([, collisions]) => collisions.length > 0)
      .map(([linkName]) => linkName);
    return new Set(collisionLinkNames);
  }, [analysis]);
  const selectedBatchCollisionLinkNames = useMemo(
    () => selectedBatchLinkNames.filter((linkName) => linksWithCollisionSet.has(linkName)),
    [linksWithCollisionSet, selectedBatchLinkNames]
  );
  const selectedBatchCollisionCount = selectedBatchCollisionLinkNames.length;
  const hasSelectedCollisionBatchLinks = selectedBatchCollisionCount > 0;
  const hasMultiSelectedCollisionBatchLinks =
    selectedBatchCollisionCount >= MIN_LINK_BATCH_SELECTION_FOR_EDITOR;
  const selectedBatchSimplifiedCount = useMemo(
    () =>
      selectedBatchCollisionLinkNames.filter((linkName) => simplifiedLinkSet.has(linkName)).length,
    [selectedBatchCollisionLinkNames, simplifiedLinkSet]
  );
  const selectedBatchMergedCount = useMemo(
    () => selectedBatchCollisionLinkNames.filter((linkName) => mergedLinkSet.has(linkName)).length,
    [selectedBatchCollisionLinkNames, mergedLinkSet]
  );
  const hasSelectedBatchLinks = selectedBatchLinkNames.length > 0;
  const hasMultiSelectedBatchLinks =
    selectedBatchLinkNames.length >= MIN_LINK_BATCH_SELECTION_FOR_EDITOR;
  const hasMixedBatchSimplifyState =
    hasMultiSelectedCollisionBatchLinks &&
    selectedBatchSimplifiedCount > 0 &&
    selectedBatchSimplifiedCount < selectedBatchCollisionCount;
  const hasMixedBatchMergeState =
    hasMultiSelectedCollisionBatchLinks &&
    selectedBatchMergedCount > 0 &&
    selectedBatchMergedCount < selectedBatchCollisionCount;

  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const worldObjectCount = useObjectStore((state) => state.objects.length);
  const worldCameraCount = useCameraStore((state) => state.cameras.length);
  const structureListScrollRef = useRef<HTMLDivElement | null>(null);
  const editorTitle = useMemo(() => {
    if (hasMultiSelectedBatchLinks) {
      return `Link Batch Editor (${selectedBatchLinkNames.length})`;
    }
    if (selectedCameraId) return "Camera Editor";
    if (selectedJoint) return `Joint Editor (${selectedJoint})`;
    if (selectedLink) return `Link Editor (${selectedLink})`;
    if (selectedObjectId) return "Object Editor";
    return "No Selection";
  }, [
    hasMultiSelectedBatchLinks,
    selectedBatchLinkNames.length,
    selectedCameraId,
    selectedJoint,
    selectedLink,
    selectedObjectId,
  ]);
  const visibilityJointSeed = useMemo(
    () => new Set(availableJoints),
    [availableJoints]
  );
  const [visibleJoints, setVisibleJoints] = useState<Set<string>>(visibilityJointSeed);

  // Reset visibility when the loaded URDF joint set changes.
  useEffect(() => {
    setVisibleJoints(new Set(visibilityJointSeed));
  }, [visibilityJointSeed]);
  const handleVisibilityToggle = useCallback((jointName: string) => {
    const newVisible = toggleStringSetValue(visibleJoints, jointName);
    setVisibleJoints(newVisible);
  }, [visibleJoints]);
  const handleBatchLinkToggle = useCallback((linkName: string) => {
    setSelectedBatchLinks((prev) => toggleStringSetValue(prev, linkName));
  }, []);
  const toggleBatchLinkGroup = useCallback((linkNames: string[]) => {
    setSelectedBatchLinks((previousSelectedLinks) =>
      toggleStringSetGroup(previousSelectedLinks, linkNames)
    );
  }, []);
  const clearBatchLinkSelection = useCallback(() => {
    setSelectedBatchLinks(new Set());
  }, []);
  const clearCrossSelections = useCallback(() => {
    onJointSelect?.(null);
    setSelectedLink(null);
    useObjectStore.getState().setSelectedObject(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink]);
  const selectSidebarLink = useCallback((linkName: string) => {
    setSelectedLink(linkName);
    onJointSelect?.(null);
    useObjectStore.getState().setSelectedObject(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink]);
  const selectSidebarJoint = useCallback((jointName: string) => {
    onJointSelect?.(jointName);
    setSelectedLink(null);
    useObjectStore.getState().setSelectedObject(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink]);
  const closeSidebarEditor = useCallback(() => {
    clearCrossSelections();
    clearBatchLinkSelection();
  }, [clearBatchLinkSelection, clearCrossSelections]);
  useEffect(() => {
    if (effectiveStructureViewMode !== "links" && selectedBatchLinks.size > 0) {
      clearBatchLinkSelection();
    }
  }, [clearBatchLinkSelection, effectiveStructureViewMode, selectedBatchLinks.size]);
  useEffect(() => {
    useLinkHighlightStore.getState().setHighlightedLinks(selectedBatchLinkNames);
  }, [selectedBatchLinkNames]);
  useEffect(
    () => () => {
      useLinkHighlightStore.getState().clearHighlightedLinks();
    },
    []
  );
  const applyBatchCollisionSimplify = useCallback(
    (simplify: boolean) => {
      if (!onCollisionSimplifyLinksChange || selectedBatchCollisionLinkNames.length === 0) {
        return;
      }
      const updated = applyCollisionSimplifyToSelectedLinks(
        collisionSimplifyLinks,
        selectedBatchCollisionLinkNames,
        simplify
      );
      onCollisionSimplifyLinksChange(updated);
    },
    [
      collisionSimplifyLinks,
      onCollisionSimplifyLinksChange,
      selectedBatchCollisionLinkNames,
    ]
  );
  const simplifySelectedBatchCollisions = useCallback(() => {
    applyBatchCollisionSimplify(true);
  }, [applyBatchCollisionSimplify]);
  const restoreSelectedBatchCollisionMeshes = useCallback(() => {
    applyBatchCollisionSimplify(false);
  }, [applyBatchCollisionSimplify]);
  const applyBatchCollisionMerge = useCallback(() => {
    if (
      !onCollisionMergedLinksChange ||
      selectedBatchCollisionLinkNames.length < MIN_LINK_BATCH_SELECTION_FOR_EDITOR
    ) {
      return;
    }
    onCollisionMergedLinksChange(replaceMergedCollisionLinks(selectedBatchCollisionLinkNames));
  }, [onCollisionMergedLinksChange, selectedBatchCollisionLinkNames]);
  const clearBatchCollisionMerge = useCallback(() => {
    if (!onCollisionMergedLinksChange || selectedBatchCollisionLinkNames.length === 0) {
      return;
    }
    onCollisionMergedLinksChange(
      removeMergedCollisionLinks(collisionMergedLinks, selectedBatchCollisionLinkNames)
    );
  }, [
    collisionMergedLinks,
    onCollisionMergedLinksChange,
    selectedBatchCollisionLinkNames,
  ]);
  const addMeshCollisionForLink = useCallback(
    (linkName: string) => {
      if (!urdfContent || !onUrdfChange || !analysis?.isValid) {
        return;
      }
      if (linksWithCollisionSet.has(linkName)) {
        return;
      }
      const linkData = analysis.linkDataByName[linkName];
      if (!linkData) {
        return;
      }
      const meshVisual = linkData.visuals.find(
        (visual) => visual.geometry.type === "mesh" && Boolean(visual.geometry.params.filename)
      );
      if (!meshVisual) {
        return;
      }
      const meshFilename = meshVisual.geometry.params.filename ?? "";
      const meshScale = meshVisual.geometry.params.scale ?? "1 1 1";
      const nextUrdf = addCollisionToLink(
        urdfContent,
        linkName,
        "mesh",
        {
          filename: meshFilename,
          scale: meshScale,
        },
        meshVisual.origin
      );
      if (nextUrdf !== urdfContent) {
        onUrdfChange(nextUrdf);
      }
    },
    [analysis, linksWithCollisionSet, onUrdfChange, urdfContent]
  );
  // Get all unique joint types
  const jointTypes = useMemo(() => buildJointTypes(jointLimits), [jointLimits]);
  useEffect(() => {
    if (selectedBatchLinks.size === 0) return;
    const availableLinksSet = new Set(allLinks);
    setSelectedBatchLinks((previousSelectedLinks) => {
      const filteredSelectedLinks = filterStringSetMembers(
        previousSelectedLinks,
        availableLinksSet
      );
      return filteredSelectedLinks.size === previousSelectedLinks.size
        ? previousSelectedLinks
        : filteredSelectedLinks;
    });
  }, [allLinks, selectedBatchLinks.size]);
  useEffect(() => {
    if (!onCollisionMergedLinksChange || collisionMergedLinks.length === 0) return;
    const availableLinksSet = new Set(
      allLinks.filter((linkName) => linksWithCollisionSet.has(linkName))
    );
    const filteredMergedLinks = filterStringArrayMembers(collisionMergedLinks, availableLinksSet);
    if (filteredMergedLinks.length !== collisionMergedLinks.length) {
      onCollisionMergedLinksChange(filteredMergedLinks);
    }
  }, [allLinks, collisionMergedLinks, linksWithCollisionSet, onCollisionMergedLinksChange]);
  useEffect(() => {
    if (!onCollisionSimplifyLinksChange || collisionSimplifyLinks.length === 0) return;
    const availableLinksSet = new Set(
      allLinks.filter((linkName) => linksWithCollisionSet.has(linkName))
    );
    const filteredSimplifyLinks = filterStringArrayMembers(
      collisionSimplifyLinks,
      availableLinksSet
    );
    if (filteredSimplifyLinks.length !== collisionSimplifyLinks.length) {
      onCollisionSimplifyLinksChange(filteredSimplifyLinks);
    }
  }, [
    allLinks,
    collisionSimplifyLinks,
    linksWithCollisionSet,
    onCollisionSimplifyLinksChange,
  ]);

  // Get selected link data
  const selectedLinkData = useMemo(() => {
    if (!selectedLink) return null;
    if (analysis?.isValid) {
      return analysis.linkDataByName[selectedLink] ?? null;
    }
    return null;
  }, [analysis, selectedLink]);

  // Filter links by search query
  const filteredLinks = useMemo(() => {
    return filterLinksForSidebar({
      allLinks,
      searchQuery: deferredSearchQuery,
      voxelDerivedInertialLinkSet,
      voxelOnly: false,
    });
  }, [allLinks, deferredSearchQuery, voxelDerivedInertialLinkSet]);
  useEffect(() => {
    const nextViewMode = linkSidebarInteractionState.viewMode;
    if (nextViewMode !== viewMode) {
      setViewMode(nextViewMode);
    }
  }, [linkSidebarInteractionState.viewMode, viewMode]);
  // Filter joints by search and type (flat view)
  const flatViewJointNames = availableJoints;
  // Use jointLimits as source of truth only in URDF-joints mode to keep fixed joints visible.
  const filteredJoints = useMemo(
    () =>
      buildFilteredJointNames({
        availableJoints: flatViewJointNames,
        jointLimits,
        typeFilter,
        searchQuery: deferredSearchQuery,
        includeJointLimitNames: true,
      }),
    [
      deferredSearchQuery,
      flatViewJointNames,
      jointLimits,
      typeFilter,
    ]
  );
  const trackedJointNamesForActivity = useMemo(
    () =>
      Array.from(
        new Set([...availableJoints, ...Object.keys(jointLimits)])
      ).sort(),
    [availableJoints, jointLimits]
  );
  const updateActiveMovingJointNames = useCallback(
    (nowMs: number) => {
      const nextActivityState = advanceJointActivityState({
        state: jointActivityStateRef.current,
        trackedJointNames: trackedJointNamesForActivity,
        currentJointValues: liveJointValuesRef.current,
        nowMs,
        changeEpsilonRad: JOINT_ACTIVITY_PARAMS.changeEpsilonRad,
        visibleHoldMs: JOINT_ACTIVITY_PARAMS.visibleHoldMs,
      });
      jointActivityStateRef.current = nextActivityState;
      const nextActiveJointNames = resolveActiveJointNameSet(
        nextActivityState.activeUntilByJointName,
        nowMs
      );
      setActiveMovingJointNames((previous) =>
        areStringSetsEqual(previous, nextActiveJointNames) ? previous : nextActiveJointNames
      );
    },
    [trackedJointNamesForActivity]
  );

  const {
    canReassignStructureGroups,
    isStructureDragActive,
    groupedLinksWithCustom,
    groupedJointsWithCustom,
    activeStructureDropGroup,
    isSubgroupCreatorOpen,
    subgroupDraftLabel,
    setSubgroupDraftLabel,
    openSubgroupCreator,
    closeSubgroupCreator,
    createCustomSubgroup,
    handleStructureDragStart,
    handleStructureGroupDragOver,
    handleStructureGroupDragLeave,
    handleStructureGroupDrop,
    handleStructureListDragOver,
    handleStructureListDrop,
    handleStructureDragEnd,
  } = useStructureGroupEditor({
    analysis,
    urdfContent,
    onUrdfChange,
    structureLabels,
    viewMode: effectiveStructureViewMode,
    filteredLinks,
    filteredJoints,
  });
  const displayedLinkSections = useMemo(() => {
    if (linkGroupingMode === "mesh") {
      return buildMeshGroupedLinkSections({
        analysis,
        filteredLinks,
      });
    }
    if (linkGroupingMode === "alpha") {
      return buildAlphabeticalLinkSections(filteredLinks);
    }
    return groupedLinksWithCustom;
  }, [analysis, filteredLinks, groupedLinksWithCustom, linkGroupingMode]);
  const canReassignDisplayedLinkGroups =
    canReassignStructureGroups && linkGroupingMode === "body";
  const getDisplayedLinkSectionLabel = useCallback(
    (sectionLabel: string) =>
      linkGroupingMode === "body"
        ? toGroupDisplayLabel(sectionLabel)
        : sectionLabel,
    [linkGroupingMode]
  );
  useEffect(() => {
    if (previousStructureIdentityKeyRef.current === structureIdentityKey) {
      return;
    }
    previousStructureIdentityKeyRef.current = structureIdentityKey;
    knownLinkSectionIdsRef.current = new Set();
    knownJointSectionIdsRef.current = new Set();
    setCollapsedLinkSectionIds(new Set());
    setCollapsedJointSectionIds(new Set());
    jointActivityStateRef.current = createInitialJointActivityState();
    setActiveMovingJointNames(new Set());
  }, [structureIdentityKey]);
  useEffect(() => {
    if (effectiveStructureViewMode === "links" && linkGroupingMode !== "body" && isSubgroupCreatorOpen) {
      closeSubgroupCreator();
    }
  }, [
    closeSubgroupCreator,
    effectiveStructureViewMode,
    isSubgroupCreatorOpen,
    linkGroupingMode,
  ]);
  useEffect(() => {
    liveJointValuesRef.current = liveJointValues;
    const nowMs =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    updateActiveMovingJointNames(nowMs);
  }, [liveJointValues, updateActiveMovingJointNames]);
  useEffect(() => {
    if (activeMovingJointNames.size === 0) return;
    const intervalId = window.setInterval(() => {
      const nowMs =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      updateActiveMovingJointNames(nowMs);
    }, JOINT_ACTIVITY_PARAMS.pruneIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [activeMovingJointNames.size, updateActiveMovingJointNames]);
  const selectedFilteredLinkCount = useMemo(
    () => countSelectedValues(filteredLinks, selectedBatchLinks),
    [filteredLinks, selectedBatchLinks]
  );
  const areAllFilteredLinksSelected =
    filteredLinks.length > 0 && selectedFilteredLinkCount === filteredLinks.length;
  useEffect(() => {
    setCollapsedLinkSectionIds((prev) => {
      const reconciled = reconcileCollapsedSectionIds({
        previousCollapsedSectionIds: prev,
        knownSectionIds: knownLinkSectionIdsRef.current,
        sections: displayedLinkSections,
        collapseNewSectionsByDefault: true,
        collapseAllSections: false,
      });
      knownLinkSectionIdsRef.current = reconciled.knownSectionIds;
      return areStringSetsEqual(prev, reconciled.collapsedSectionIds)
        ? prev
        : reconciled.collapsedSectionIds;
    });
  }, [displayedLinkSections]);
  useEffect(() => {
    setCollapsedLinkSectionIds((prev) => {
      const next = expandStructureSectionsContainingItem({
        previousCollapsedSectionIds: prev,
        sections: displayedLinkSections,
        itemName: highlightedLinkName,
      });
      return areStringSetsEqual(prev, next) ? prev : next;
    });
  }, [displayedLinkSections, highlightedLinkName]);
  useEffect(() => {
    if (effectiveStructureViewMode !== "flat") return;
    setCollapsedJointSectionIds((prev) => {
      const reconciled = reconcileCollapsedSectionIds({
        previousCollapsedSectionIds: prev,
        knownSectionIds: knownJointSectionIdsRef.current,
        sections: groupedJointsWithCustom,
        collapseNewSectionsByDefault: true,
        collapseAllSections: false,
      });
      knownJointSectionIdsRef.current = reconciled.knownSectionIds;
      return areStringSetsEqual(prev, reconciled.collapsedSectionIds)
        ? prev
        : reconciled.collapsedSectionIds;
    });
  }, [effectiveStructureViewMode, groupedJointsWithCustom]);
  const toggleLinkSectionCollapse = useCallback(
    (sectionId: string) => {
      setCollapsedLinkSectionIds((prev) => toggleStringSetValue(prev, sectionId));
    },
    []
  );
  const toggleJointSectionCollapse = useCallback(
    (sectionId: string) => {
      setCollapsedJointSectionIds((prev) => toggleStringSetValue(prev, sectionId));
    },
    []
  );

  // Build tree structure for hierarchy view (Link -> Joint -> Link -> Joint...)
  const hierarchyTree = useMemo(
    () =>
      effectiveStructureViewMode === "hierarchy"
        ? buildHierarchyTree({
            jointHierarchy,
            jointLimits,
            typeFilter,
            searchQuery: deferredSearchQuery,
          })
        : null,
    [
      deferredSearchQuery,
      effectiveStructureViewMode,
      jointHierarchy,
      jointLimits,
      typeFilter,
    ]
  );

  if (isCollapsed) {
    return null;
  }

  const toggleSelectAllFilteredLinks = () => {
    setSelectedBatchLinks((previousSelectedLinks) =>
      toggleSelectAllStringSetValues(
        previousSelectedLinks,
        filteredLinks,
        areAllFilteredLinksSelected
      )
    );
  };

  return (
    <div
      className="fixed right-0 z-30 h-screen bg-background/95 border-l border-border/35 flex flex-col backdrop-blur-sm"
      style={{
        width,
        top: TOP_NAV_HEIGHT,
        height: VIEWPORT_HEIGHT_WITH_TOP_NAV,
      }}
    >
      {/* Two equal square sections */}
      <div className="grid h-full min-h-0 gap-1 p-1" style={{ gridTemplateRows: panelRows }}>
        {/* Top Section: Joints */}
        <div className={SIDEBAR_SECTION_CLASS}>
          {/* Header */}
          <SidebarStructureControls
            canReassignStructureGroups={canReassignStructureGroups}
            effectiveStructureViewMode={effectiveStructureViewMode}
            headerClassName={cn(SIDEBAR_SECTION_HEADER_CLASS, "space-y-1")}
            isSubgroupCreatorOpen={isSubgroupCreatorOpen}
            jointTypes={jointTypes}
            leadingContent={
              <SidebarWorldSection
                cameraCount={worldCameraCount}
                endEffectorLink={effectiveEndEffectorLink}
                objectCount={worldObjectCount}
                onJointSelect={onJointSelect}
                robot={robot}
                setSelectedLink={setSelectedLink}
              />
            }
            linkGroupingMode={linkGroupingMode}
            onCloseSubgroupCreator={closeSubgroupCreator}
            onCreateCustomSubgroup={createCustomSubgroup}
            onLinkGroupingModeChange={setLinkGroupingMode}
            onOpenSubgroupCreator={openSubgroupCreator}
            onSearchQueryChange={setSearchQuery}
            onStructureViewModeChange={setViewMode}
            onSubgroupDraftLabelChange={setSubgroupDraftLabel}
            onTypeFilterChange={setTypeFilter}
            searchQuery={searchQuery}
            structureModeOptions={structureModeOptions}
            subgroupActionButtonClassName={STRUCTURE_SUBGROUP_ACTION_BUTTON_CLASS}
            subgroupDraftLabel={subgroupDraftLabel}
            typeFilter={typeFilter}
            urdfContentAvailable={Boolean(urdfContent)}
          />

          {/* Scrollable Joint List */}
          <div
            ref={structureListScrollRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1 minimal-scrollbar"
            onDragOver={(event) => {
              handleStructureListDragOver(event, structureListScrollRef.current);
            }}
            onDrop={(event) => {
              handleStructureListDrop(event, structureListScrollRef.current);
            }}
          >
            {effectiveStructureViewMode === "links" ? (
              <LinkBrowserView
                activeStructureDropGroup={activeStructureDropGroup}
                areAllFilteredLinksSelected={areAllFilteredLinksSelected}
                canReassignDisplayedLinkGroups={canReassignDisplayedLinkGroups}
                collapsedLinkSectionIds={collapsedLinkSectionIds}
                displayedLinkSections={displayedLinkSections}
                effectiveEndEffectorLink={effectiveEndEffectorLink}
                endEffectorLink={endEffectorLink}
                formatSectionLabel={getDisplayedLinkSectionLabel}
                highlightedLinkName={highlightedLinkName}
                isStructureDragActive={isStructureDragActive}
                linkDataByName={analysis?.isValid ? analysis.linkDataByName : null}
                linksWithCollisionSet={linksWithCollisionSet}
                mergedLinkSet={mergedLinkSet}
                onAddMeshCollisionForLink={addMeshCollisionForLink}
                onBatchLinkToggle={handleBatchLinkToggle}
                onLinkSelect={selectSidebarLink}
                onMarkAsEndEffector={onMarkAsEndEffector}
                onStructureDragEnd={handleStructureDragEnd}
                onStructureDragStart={handleStructureDragStart}
                onStructureGroupDragLeave={handleStructureGroupDragLeave}
                onStructureGroupDragOver={handleStructureGroupDragOver}
                onStructureGroupDrop={handleStructureGroupDrop}
                onToggleBatchLinkGroup={toggleBatchLinkGroup}
                onToggleLinkSectionCollapse={toggleLinkSectionCollapse}
                onToggleSelectAllFilteredLinks={toggleSelectAllFilteredLinks}
                searchQuery={searchQuery}
                selectedBatchLinkNames={selectedBatchLinkNames}
                selectedBatchLinks={selectedBatchLinks}
                selectedLink={selectedLink}
                simplifiedLinkSet={simplifiedLinkSet}
                voxelDerivedInertialLinkSet={voxelDerivedInertialLinkSet}
              />
            ) : effectiveStructureViewMode === "flat" ? (
              <FlatJointBrowserView
                activeMovingJointNames={activeMovingJointNames}
                activeStructureDropGroup={activeStructureDropGroup}
                angleUnit={angleUnit}
                availableJoints={availableJoints}
                canReassignStructureGroups={canReassignStructureGroups}
                colorJointNames={colorJointNames}
                collapsedJointSectionIds={collapsedJointSectionIds}
                deletedJoints={deletedJoints}
                groupedJointsWithCustom={groupedJointsWithCustom}
                hoveredJoint={hoveredJoint}
                isStructureDragActive={isStructureDragActive}
                jointEffortLimits={jointEffortLimits}
                jointLimits={jointLimits}
                onJointHover={onJointHover}
                onJointSelect={selectSidebarJoint}
                onStructureDragEnd={handleStructureDragEnd}
                onStructureDragStart={handleStructureDragStart}
                onStructureGroupDragLeave={handleStructureGroupDragLeave}
                onStructureGroupDragOver={handleStructureGroupDragOver}
                onStructureGroupDrop={handleStructureGroupDrop}
                onToggleJointSectionCollapse={toggleJointSectionCollapse}
                onVisibilityToggle={handleVisibilityToggle}
                searchQuery={searchQuery}
                selectedJoint={selectedJoint}
                structureJointLabels={structureLabels.jointByName}
                typeFilter={typeFilter}
                visibleJoints={visibleJoints}
              />
            ) : (
              <HierarchyJointBrowserView
                hierarchyTree={hierarchyTree}
                jointLimits={jointLimits}
                deletedJoints={deletedJoints}
                selectedJoint={selectedJoint}
                hoveredJoint={hoveredJoint}
                angleUnit={angleUnit}
                onJointSelect={onJointSelect}
                onLinkSelect={selectSidebarLink}
                selectedLink={selectedLink}
                availableJoints={availableJoints}
                colorJointNames={colorJointNames}
                jointEffortLimits={jointEffortLimits}
                visibleJoints={visibleJoints}
                onVisibilityToggle={handleVisibilityToggle}
                endEffectorLink={effectiveEndEffectorLink}
                onMarkAsEndEffector={onMarkAsEndEffector}
                structureLabels={structureLabels}
                searchQuery={searchQuery}
                typeFilter={typeFilter}
              />
            )}
          </div>
        </div>

        {/* Bottom Section: General Editor */}
        <div className={SIDEBAR_SECTION_CLASS}>
          {/* Header */}
          <div className={SIDEBAR_SECTION_HEADER_CLASS}>
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground/90 truncate pr-2"
                title={editorTitle}
              >
                {editorTitle}
              </span>
              {(selectedJoint ||
                selectedLink ||
                selectedObjectId ||
                selectedCameraId ||
                hasSelectedBatchLinks) && (
                <button
                  onClick={closeSidebarEditor}
                  className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5 hover:bg-muted/40"
                  title="Close editor"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden pr-1 blender-scrollbar [scrollbar-gutter:stable]">
            {isAnalysisInvalid ? (
              <div className="p-3 text-xs text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-sm m-2">
                <div className="font-medium mb-1">URDF is invalid</div>
                <div className="text-amber-100/80">
                  Fix the XML to re-enable joint and link editing.
                </div>
                {urdfAnalysis?.error && (
                  <div className="mt-2 text-[11px] text-amber-100/70 line-clamp-3">
                    {urdfAnalysis.error}
                  </div>
                )}
              </div>
            ) : hasMultiSelectedBatchLinks ? (
              <LinkBatchEditorPanel
                canClearMergedCollision={Boolean(
                  onCollisionMergedLinksChange && hasSelectedCollisionBatchLinks
                )}
                canMergeCollisions={Boolean(
                  onCollisionMergedLinksChange && hasMultiSelectedCollisionBatchLinks
                )}
                canSimplifyCollisions={Boolean(
                  onCollisionSimplifyLinksChange && hasSelectedCollisionBatchLinks
                )}
                hasMixedBatchMergeState={hasMixedBatchMergeState}
                hasMixedBatchSimplifyState={hasMixedBatchSimplifyState}
                hasSelectedCollisionBatchLinks={hasSelectedCollisionBatchLinks}
                mergedLinkSet={mergedLinkSet}
                onApplyCollisionMerge={applyBatchCollisionMerge}
                onClearCollisionMerge={clearBatchCollisionMerge}
                onClearSelection={clearBatchLinkSelection}
                onRestoreCollisionMeshes={restoreSelectedBatchCollisionMeshes}
                onSimplifyCollisions={simplifySelectedBatchCollisions}
                selectedBatchCollisionCount={selectedBatchCollisionCount}
                selectedBatchLinkNames={selectedBatchLinkNames}
                selectedBatchMergedCount={selectedBatchMergedCount}
                selectedBatchSimplifiedCount={selectedBatchSimplifiedCount}
                simplifiedLinkSet={simplifiedLinkSet}
              />
            ) : selectedCameraId ? (
              <CameraEditorPanel
                cameraId={selectedCameraId}
                availableJoints={availableJoints || []}
                robot={robot}
                urdfSensors={urdfAnalysis?.sensors ?? []}
              />
            ) : selectedJoint ? (
              <div 
                className="p-1"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <JointControl
                  jointName={selectedJoint}
                  jointInfo={jointLimits[selectedJoint]}
                  jointAxis={jointAxes[selectedJoint]}
                  originalAxis={originalJointAxes[selectedJoint]}
                  groupLabel={structureLabels.jointByName[selectedJoint] ?? null}
                  onValueChange={(value) => {
                    if (onJointChange && selectedJoint) {
                      onJointChange(selectedJoint, value);
                    }
                  }}
                  onAxisChange={onJointAxisChange}
                  onOriginChange={onJointOriginChange}
                  onResetAxis={onResetAxis}
                  onDeleteJoint={onDeleteJoint}
                  isDeleted={deletedJoints.has(selectedJoint)}
                  angleUnit={angleUnit}
                  onHover={onJointHover}
                  urdfContent={urdfContent}
                  urdfAnalysis={analysis}
                  isHighlighted={true}
                  onLinkChange={onJointLinkChange}
                  onTypeChange={onJointTypeChange ? (newType, lowerLimit, upperLimit) => {
                    onJointTypeChange(selectedJoint, newType, lowerLimit, upperLimit);
                  } : undefined}
                  onLimitsChange={onJointLimitsChange ? (lowerLimit, upperLimit) => {
                    onJointLimitsChange(selectedJoint, lowerLimit, upperLimit);
                  } : undefined}
                  onVelocityChange={onJointVelocityChange ? (velocity) => {
                    onJointVelocityChange(selectedJoint, velocity);
                  } : undefined}
                  onEffortChange={onJointEffortChange ? (effort) => {
                    onJointEffortChange(selectedJoint, effort);
                  } : undefined}
                  onNameChange={onJointNameChange}
                  alwaysExpanded={true}
                  hideValueDisplay={true}
                />
              </div>
            ) : selectedLink && selectedLinkData ? (
              <div 
                className="p-1"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <LinkControl
                  linkData={selectedLinkData}
                  urdfContent={urdfContent}
                  onMaterialChange={onMaterialChange}
                  onLinkNameChange={onLinkNameChange}
                  onUrdfChange={onUrdfChange}
                  meshFiles={meshFiles}
                  isHighlighted={true}
                  onSelect={() => {}}
                  collisionVisibility={collisionVisibility[selectedLink] || {}}
                  onCollisionVisibilityChange={(index, visible) => {
                    if (onCollisionVisibilityChange) {
                      const newVisibility = {
                        ...collisionVisibility,
                        [selectedLink]: {
                          ...(collisionVisibility[selectedLink] || {}),
                          [index]: visible,
                        },
                      };
                      onCollisionVisibilityChange(newVisibility);
                    }
                  }}
                  alwaysExpanded={true}
                  endEffectorLink={effectiveEndEffectorLink}
                  endEffectorCandidates={endEffectorCandidates}
                  analysisValid={analysis?.isValid === true}
                  onMarkAsEndEffector={onMarkAsEndEffector}
                  onGenerateInertialDraft={onGenerateInertialDraft}
                  voxelDerivedInertialLinks={voxelDerivedInertialLinks}
                />
                {hasMultipleEndEffectors && (
                  <div className="px-2 pb-2 text-[10px] text-muted-foreground/80">
                    Multiple end-effector candidates detected: {endEffectorCandidates.join(", ")}.
                  </div>
                )}
              </div>
            ) : selectedObjectId ? (
              <ObjectEditorPanel
                objectId={selectedObjectId}
                availableLinks={availableLinks || []}
                sidebarWidth={width}
                robot={robot}
                endEffectorLink={effectiveEndEffectorLink}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50 p-4 text-center">
                Select a joint, link, object, or camera to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
