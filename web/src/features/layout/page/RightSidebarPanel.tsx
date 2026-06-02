import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { JointListSidebar } from "@/features/layout/JointListSidebar";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { JointAxisMap, JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type {
  AngleUnit,
  MeshFiles,
} from "@/shared/types/feature";
import type { URDFRobot } from "urdf-loader";
import { ChevronsLeft } from "lucide-react";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { AssemblyInspectorData } from "@/features/assembly/inspector/buildAssemblyInspectorData";
import { AssemblyRightRobotsPanel } from "@/features/assembly/workspace/AssemblyRightRobotsPanel";
import { SidebarDock } from "@/features/layout/page/SidebarDock";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";

type RightSidebarPanelProps = {
  workspaceMode: WorkspaceMode;
  assemblyInspector: AssemblyInspectorData | null;
  onDuplicateAssemblyRobot?: (instanceId: string) => void;
  substitutionSession?: {
    hostRobotId: string;
    hostRobotName: string;
    replacementRobotId: string;
    replacementRobotName: string;
  } | null;
  onApplySubstitution?: (hostRootLink: string, replacementRootLink: string) => void;
  availableJoints: string[];
  episodeJointNames: string[];
  availableLinks: string[];
  jointLimits: JointLimits;
  selectedJoint: string | null;
  selectedLink: string | null;
  hoveredLink: string | null;
  onJointSelect: (joint: string | null) => void;
  onLinkSelect: (link: string | null) => void;
  hoveredJoint: string | null;
  onJointHover: (joint: string | null) => void;
  deletedJoints: Set<string>;
  rightSidebarWidth: number;
  isRightSidebarCollapsed: boolean;
  vizUrdfContent: string;
  urdfAnalysis: UrdfAnalysis | null;
  jointAxes: JointAxisMap;
  originalJointAxes: JointAxisMap;
  onJointChange: (jointName: string, value: number) => void;
  onJointAxisChange: (jointName: string, axis: [number, number, number]) => void;
  onJointOriginChange: (
    jointName: string,
    xyz: [number, number, number],
    rpy: [number, number, number]
  ) => void;
  onResetAxis: (jointName: string) => void;
  onJointTypeChange: (
    jointName: string,
    jointType: string,
    lowerLimit?: number,
    upperLimit?: number
  ) => void;
  onJointLimitsChange: (
    jointName: string,
    lowerLimit?: number | null,
    upperLimit?: number | null
  ) => void;
  onJointVelocityChange: (jointName: string, velocity: number | null) => void;
  onJointEffortChange: (jointName: string, effort: number | null) => void;
  onJointNameChange: (oldName: string, newName: string) => boolean | void;
  onDeleteJoint: (jointName: string) => void;
  onJointLinkChange: (jointName: string, parentLink: string, childLink: string) => void;
  angleUnit: AngleUnit;
  onAngleUnitChange: (unit: AngleUnit) => void;
  meshFiles: MeshFiles;
  onMaterialChange: (linkName: string, materialName: string, color: string) => void;
  onLinkNameChange: (oldName: string, newName: string) => void;
  onUrdfChange: (content: string) => void;
  collisionVisibility: CollisionVisibility;
  onCollisionVisibilityChange: (visibility: CollisionVisibility) => void;
  collisionSimplifyLinks: string[];
  onCollisionSimplifyLinksChange: (links: string[]) => void;
  collisionMergedLinks: string[];
  onCollisionMergedLinksChange: (links: string[]) => void;
  endEffectorLink: string | null;
  endEffectorCandidates: string[];
  onMarkAsEndEffector: (linkName: string | null) => void;
  robot: URDFRobot | null;
  simulationPrepPanelOpen?: boolean;
  onGenerateInertialDraft?: (linkName: string, densityPresetId: InertialDensityPresetId) => void;
  voxelDerivedInertialLinks?: string[];
  onRightSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleCollapse: () => void;
};

const RightSidebarPanelBase = ({
  workspaceMode,
  assemblyInspector,
  onDuplicateAssemblyRobot,
  substitutionSession,
  onApplySubstitution,
  availableJoints,
  episodeJointNames,
  availableLinks,
  jointLimits,
  selectedJoint,
  selectedLink,
  hoveredLink,
  onJointSelect,
  onLinkSelect,
  hoveredJoint,
  onJointHover,
  deletedJoints,
  rightSidebarWidth,
  isRightSidebarCollapsed,
  vizUrdfContent,
  urdfAnalysis,
  jointAxes,
  originalJointAxes,
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
  angleUnit,
  onAngleUnitChange,
  meshFiles,
  onMaterialChange,
  onLinkNameChange,
  onUrdfChange,
  collisionVisibility,
  onCollisionVisibilityChange,
  collisionSimplifyLinks,
  onCollisionSimplifyLinksChange,
  collisionMergedLinks,
  onCollisionMergedLinksChange,
  endEffectorLink,
  endEffectorCandidates,
  onMarkAsEndEffector,
  robot,
  simulationPrepPanelOpen = false,
  onGenerateInertialDraft,
  voxelDerivedInertialLinks,
  onRightSidebarResizeStart,
  onToggleCollapse,
}: RightSidebarPanelProps) => {
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);

  if (workspaceModeUi.isAssembly) {
    return (
      <AssemblyRightRobotsPanel
        assemblyInspector={assemblyInspector}
        onDuplicateAssemblyRobot={onDuplicateAssemblyRobot}
        substitutionSession={substitutionSession}
        rightSidebarWidth={rightSidebarWidth}
        isRightSidebarCollapsed={isRightSidebarCollapsed}
        onToggleCollapse={onToggleCollapse}
        onRightSidebarResizeStart={onRightSidebarResizeStart}
      />
    );
  }

  return (
    <SidebarDock
      side="right"
      sidebarWidth={rightSidebarWidth}
      isCollapsed={isRightSidebarCollapsed}
      onToggleCollapse={onToggleCollapse}
      onResizeStart={onRightSidebarResizeStart}
      CollapseIcon={ChevronsLeft}
    >
    <JointListSidebar
      availableJoints={availableJoints}
      episodeJointNames={episodeJointNames}
      availableLinks={availableLinks}
      jointLimits={jointLimits}
      selectedJoint={selectedJoint}
      selectedLink={selectedLink}
      hoveredLink={hoveredLink}
      onJointSelect={onJointSelect}
      onLinkSelect={onLinkSelect}
      hoveredJoint={hoveredJoint}
      onJointHover={onJointHover}
      deletedJoints={deletedJoints}
      width={rightSidebarWidth}
      isCollapsed={isRightSidebarCollapsed}
      urdfContent={vizUrdfContent}
      urdfAnalysis={urdfAnalysis}
      jointAxes={jointAxes}
      originalJointAxes={originalJointAxes}
      onJointChange={onJointChange}
      onJointAxisChange={onJointAxisChange}
      onJointOriginChange={onJointOriginChange}
      onResetAxis={onResetAxis}
      onJointTypeChange={onJointTypeChange}
      onJointLimitsChange={onJointLimitsChange}
      onJointVelocityChange={onJointVelocityChange}
      onJointEffortChange={onJointEffortChange}
      onJointNameChange={onJointNameChange}
      onDeleteJoint={onDeleteJoint}
      onJointLinkChange={onJointLinkChange}
      angleUnit={angleUnit}
      onAngleUnitChange={onAngleUnitChange}
      meshFiles={meshFiles}
      onMaterialChange={onMaterialChange}
      onLinkNameChange={onLinkNameChange}
      onUrdfChange={onUrdfChange}
      collisionVisibility={collisionVisibility}
      onCollisionVisibilityChange={onCollisionVisibilityChange}
      collisionSimplifyLinks={collisionSimplifyLinks}
      onCollisionSimplifyLinksChange={onCollisionSimplifyLinksChange}
      collisionMergedLinks={collisionMergedLinks}
      onCollisionMergedLinksChange={onCollisionMergedLinksChange}
      endEffectorLink={endEffectorLink}
      endEffectorCandidates={endEffectorCandidates}
      onMarkAsEndEffector={onMarkAsEndEffector}
      robot={robot}
      simulationPrepPanelOpen={simulationPrepPanelOpen}
      onGenerateInertialDraft={onGenerateInertialDraft}
      voxelDerivedInertialLinks={voxelDerivedInertialLinks}
    />
    </SidebarDock>
  );
};

RightSidebarPanelBase.displayName = "RightSidebarPanel";

export const RightSidebarPanel = memo(RightSidebarPanelBase);
