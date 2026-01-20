import type React from "react";
import { JointListSidebar } from "@/features/layout/JointListSidebar";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { JointAxisMap, JointLimits } from "@/features/urdf";
import type { AngleUnit, MeshFiles } from "@/shared/types/feature";
import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";
import { SIDEBAR_RESIZER_WIDTH } from "@/features/layout/page/constants";

type RightSidebarPanelProps = {
  availableJoints: string[];
  episodeJointNames: string[];
  availableLinks: string[];
  jointLimits: JointLimits;
  selectedJoint: string | null;
  selectedLink: string | null;
  onJointSelect: (joint: string | null) => void;
  onLinkSelect: (link: string | null) => void;
  hoveredJoint: string | null;
  onJointHover: (joint: string | null) => void;
  deletedJoints: Set<string>;
  rightSidebarWidth: number;
  isRightSidebarCollapsed: boolean;
  vizUrdfContent: string;
  jointAxes: JointAxisMap;
  originalJointAxes: JointAxisMap;
  onJointChange: (jointName: string, value: number) => void;
  onJointAxisChange: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis: (jointName: string) => void;
  onJointTypeChange: (
    jointName: string,
    jointType: string,
    lowerLimit?: number,
    upperLimit?: number
  ) => void;
  onJointVelocityChange: (jointName: string, velocity: number | null) => void;
  onJointNameChange: (oldName: string, newName: string) => void;
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
  endEffectorLink: string | null;
  onMarkAsEndEffector: (linkName: string | null) => void;
  robot: URDFRobot | null;
  robotBoundingBox: THREE.Box3 | null;
  onRightSidebarResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
};

export const RightSidebarPanel = ({
  availableJoints,
  episodeJointNames,
  availableLinks,
  jointLimits,
  selectedJoint,
  selectedLink,
  onJointSelect,
  onLinkSelect,
  hoveredJoint,
  onJointHover,
  deletedJoints,
  rightSidebarWidth,
  isRightSidebarCollapsed,
  vizUrdfContent,
  jointAxes,
  originalJointAxes,
  onJointChange,
  onJointAxisChange,
  onResetAxis,
  onJointTypeChange,
  onJointVelocityChange,
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
  endEffectorLink,
  onMarkAsEndEffector,
  robot,
  robotBoundingBox,
  onRightSidebarResizeStart,
}: RightSidebarPanelProps) => (
  <>
    <JointListSidebar
      availableJoints={availableJoints}
      episodeJointNames={episodeJointNames}
      availableLinks={availableLinks}
      jointLimits={jointLimits}
      selectedJoint={selectedJoint}
      selectedLink={selectedLink}
      onJointSelect={onJointSelect}
      onLinkSelect={onLinkSelect}
      hoveredJoint={hoveredJoint}
      onJointHover={onJointHover}
      deletedJoints={deletedJoints}
      width={rightSidebarWidth}
      isCollapsed={isRightSidebarCollapsed}
      urdfContent={vizUrdfContent}
      jointAxes={jointAxes}
      originalJointAxes={originalJointAxes}
      onJointChange={onJointChange}
      onJointAxisChange={onJointAxisChange}
      onResetAxis={onResetAxis}
      onJointTypeChange={onJointTypeChange}
      onJointVelocityChange={onJointVelocityChange}
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
      endEffectorLink={endEffectorLink}
      onMarkAsEndEffector={onMarkAsEndEffector}
      robot={robot}
      robotBoundingBox={robotBoundingBox}
    />

    {!isRightSidebarCollapsed && (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right sidebar"
        onPointerDown={onRightSidebarResizeStart}
        className="fixed z-40 cursor-col-resize select-none"
        style={{
          top: "32px",
          bottom: 0,
          right: rightSidebarWidth - SIDEBAR_RESIZER_WIDTH / 2,
          width: SIDEBAR_RESIZER_WIDTH,
        }}
      >
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70" />
      </div>
    )}
  </>
);
