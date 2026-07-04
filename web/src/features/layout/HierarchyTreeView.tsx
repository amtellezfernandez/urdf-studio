import React from "react";
import * as THREE from "three";
import { Link2 } from "lucide-react";
import type { URDFRobot } from "urdf-loader";
import { hexToRgba } from "@/shared/lib/color";
import { cn } from "@/shared/lib/utils";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { JointListItem } from "@/features/layout/JointListItem";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import type { JointHierarchyTreeModel } from "@/features/layout/sidebarSelectors";
import type { RobotStructureLabels } from "@/features/layout/robotStructureLabels";
import {
  extractLinkWorldPose,
  resolveHierarchyTreeViewEmptyState,
  resolveHierarchyTreeViewErrorState,
  resolveNextEndEffectorLink,
  type LinkWorldPose,
} from "@/features/layout/hierarchyTreeViewHelpers";

export interface HierarchyTreeViewProps {
  hierarchyTree: JointHierarchyTreeModel | null;
  jointLimits: JointLimits;
  deletedJoints: Set<string>;
  selectedJoint?: string | null;
  hoveredJoint?: string | null;
  angleUnit: "rad" | "deg";
  onJointSelect?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
  selectedLink?: string | null;
  availableJoints: string[];
  colorJointNames: string[];
  jointEffortLimits: Record<string, number | null>;
  visibleJoints: Set<string>;
  onVisibilityToggle: (jointName: string) => void;
  endEffectorLink?: string | null;
  onMarkAsEndEffector?: (linkName: string | null) => void;
  robot?: URDFRobot | null;
  structureLabels: RobotStructureLabels;
}

type TreeIndentedFrameProps = {
  children: React.ReactNode;
  connectorBottom?: string;
  connectorDepth?: number;
  paddingDepth: number;
};

type HierarchyLinkRowProps = {
  isEndEffector: boolean;
  isLeaf: boolean;
  isSelected: boolean;
  linkCoordinates: LinkWorldPose | null;
  linkName: string;
  onSelect: () => void;
  onToggleEndEffector?: () => void;
  structureLabel: string | null;
};

const HIERARCHY_TREE_PARAMS = JOINT_LIST_SIDEBAR_PARAMS.hierarchyTree;

function TreeBranchConnector({
  bottom,
  connectorDepth,
}: {
  bottom: string;
  connectorDepth: number;
}) {
  const connectorLeft =
    connectorDepth * HIERARCHY_TREE_PARAMS.indentPx +
    HIERARCHY_TREE_PARAMS.lineOffsetPx;
  return (
    <>
      <div
        className="absolute top-1/2 bg-border/30"
        style={{
          left: `${connectorLeft}px`,
          width: `${HIERARCHY_TREE_PARAMS.branchWidthPx}px`,
          height: "1px",
        }}
      />
      <div
        className="absolute bg-border/30"
        style={{
          left: `${connectorLeft}px`,
          top: "0",
          bottom,
          width: "1px",
        }}
      />
    </>
  );
}

function TreeIndentedFrame({
  children,
  connectorBottom,
  connectorDepth,
  paddingDepth,
}: TreeIndentedFrameProps) {
  return (
    <div
      className="relative"
      style={{ paddingLeft: `${paddingDepth * HIERARCHY_TREE_PARAMS.indentPx}px` }}
    >
      {connectorDepth !== undefined && connectorBottom ? (
        <TreeBranchConnector
          connectorDepth={connectorDepth}
          bottom={connectorBottom}
        />
      ) : null}
      {children}
    </div>
  );
}

function HierarchyLinkRow({
  isEndEffector,
  isLeaf,
  isSelected,
  linkCoordinates,
  linkName,
  onSelect,
  onToggleEndEffector,
  structureLabel,
}: HierarchyLinkRowProps) {
  return (
    <div
      className={cn(
        "px-1.5 cursor-pointer hover:bg-muted/20 rounded transition-colors",
        isSelected && "hover:bg-muted/30",
        isLeaf && isEndEffector ? "py-1" : "py-0.5"
      )}
      style={
        isSelected
          ? {
              backgroundColor: hexToRgba(HIERARCHY_TREE_PARAMS.linkColor, 0.15),
            }
          : undefined
      }
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Link2
          className={cn(
            "h-3 w-3 shrink-0",
            isSelected ? "text-primary" : "text-muted-foreground/60"
          )}
        />
        <span
          className={cn(
            isLeaf && isEndEffector ? "text-[11px] font-semibold" : "text-[10px]",
            "min-w-0 flex-1 truncate",
            isSelected ? "" : "text-muted-foreground/60"
          )}
          style={
            isSelected
              ? { color: HIERARCHY_TREE_PARAMS.linkColor }
              : undefined
          }
          title={linkName}
        >
          {linkName}
        </span>
        {structureLabel ? (
          <span className="text-[7px] px-1 py-0 bg-muted/20 border border-border/40 text-muted-foreground rounded font-semibold uppercase tracking-[0.05em]">
            {structureLabel}
          </span>
        ) : null}
        {onToggleEndEffector ? (
          <button
            type="button"
            className={cn(
              "text-[7px] px-1 py-0 rounded border font-semibold uppercase tracking-[0.05em]",
              isEndEffector
                ? "border-primary/60 bg-primary/20 text-primary"
                : "border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggleEndEffector();
            }}
            title={isEndEffector ? "Clear end-effector" : "Mark as end-effector"}
          >
            {isEndEffector ? "EE" : "Set EE"}
          </button>
        ) : null}
        {isEndEffector && !onToggleEndEffector ? (
          <span
            className={cn(
              "bg-primary/20 text-primary rounded",
              isLeaf
                ? "text-[8px] px-1 py-0.5 font-semibold"
                : "text-[7px] px-0.5 py-0 font-medium"
            )}
          >
            EE
          </span>
        ) : null}
      </div>

      {isLeaf && isEndEffector && linkCoordinates ? (
        <div className="mt-1 pt-1 border-t border-border/30 space-y-0.5">
          <div className="text-[9px] font-mono text-emerald-600">
            <div className="flex justify-between">
              <span className="text-muted-foreground">x:</span>
              <span>{linkCoordinates.position.x.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">y:</span>
              <span>{linkCoordinates.position.y.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">z:</span>
              <span>{linkCoordinates.position.z.toFixed(4)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const HierarchyTreeView = React.memo(({
  hierarchyTree,
  jointLimits,
  deletedJoints,
  selectedJoint,
  hoveredJoint,
  angleUnit,
  onJointSelect,
  onLinkSelect,
  selectedLink,
  availableJoints,
  colorJointNames,
  jointEffortLimits,
  visibleJoints,
  onVisibilityToggle,
  endEffectorLink,
  onMarkAsEndEffector,
  robot,
  structureLabels,
}: HierarchyTreeViewProps) => {
  if (!hierarchyTree || hierarchyTree.rootLinks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        {resolveHierarchyTreeViewEmptyState({
          hasHierarchyTree: hierarchyTree !== null,
          rootLinkCount: hierarchyTree?.rootLinks.length ?? 0,
        })}
      </div>
    );
  }

  const toggleEndEffectorForLink = (linkName: string) => {
    if (!onMarkAsEndEffector) return;
    onMarkAsEndEffector(
      resolveNextEndEffectorLink({
        currentEndEffectorLink: endEffectorLink,
        linkName,
      })
    );
  };
  const selectHierarchyLink = (linkName: string) => {
    onLinkSelect?.(linkName);
    onJointSelect?.(null);
  };
  const selectHierarchyJoint = (jointName: string) => {
    onLinkSelect?.(null);
    onJointSelect?.(jointName);
  };

  const renderLinkNode = (linkName: string, depth: number = 0, visitedLinks: Set<string> = new Set()): React.ReactNode => {
    if (visitedLinks.has(linkName) || depth > 100) {
      return null;
    }

    const branchVisitedLinks = new Set(visitedLinks);
    branchVisitedLinks.add(linkName);

    const isSelected = selectedLink === linkName;
    const structureLabel = structureLabels.linkByName[linkName] ?? null;

    try {
      const joints = hierarchyTree.linkToJoints.get(linkName) || [];
      const isEE = endEffectorLink === linkName;

      let linkCoordinates: LinkWorldPose | null = null;
      if (isEE && robot) {
        try {
          linkCoordinates = extractLinkWorldPose(robot, linkName);
        } catch (error) {
          console.error("Error getting link coordinates:", error);
        }
      }

      if (joints.length === 0) {
        return (
          <TreeIndentedFrame
            key={`link-${linkName}-${depth}`}
            paddingDepth={depth}
            connectorDepth={depth > 0 ? depth - 1 : undefined}
            connectorBottom={depth > 0 ? "50%" : undefined}
          >
            <HierarchyLinkRow
              linkName={linkName}
              isSelected={isSelected}
              isEndEffector={isEE}
              isLeaf={true}
              structureLabel={structureLabel}
              linkCoordinates={linkCoordinates}
              onSelect={() => selectHierarchyLink(linkName)}
              onToggleEndEffector={
                onMarkAsEndEffector
                  ? () => toggleEndEffectorForLink(linkName)
                  : undefined
              }
            />
          </TreeIndentedFrame>
        );
      }

      return (
        <div key={`link-${linkName}-${depth}`}>
          <TreeIndentedFrame
            paddingDepth={depth}
            connectorDepth={depth > 0 ? depth - 1 : undefined}
            connectorBottom={depth > 0 ? "0" : undefined}
          >
            <HierarchyLinkRow
              linkName={linkName}
              isSelected={isSelected}
              isEndEffector={isEE}
              isLeaf={false}
              structureLabel={structureLabel}
              linkCoordinates={null}
              onSelect={() => selectHierarchyLink(linkName)}
              onToggleEndEffector={
                onMarkAsEndEffector
                  ? () => toggleEndEffectorForLink(linkName)
                  : undefined
              }
            />
          </TreeIndentedFrame>
          {joints.map((joint, jointIndex) => {
            if (!joint || !joint.jointName || !joint.childLink) {
              return null;
            }

            const isLastJoint = jointIndex === joints.length - 1;
            const childJoints = hierarchyTree.linkToJoints.get(joint.childLink) || [];
            const hasChildJoints = childJoints.length > 0;

            return (
              <div key={`joint-${joint.jointName}`}>
                <TreeIndentedFrame
                  paddingDepth={depth + 1}
                  connectorDepth={depth}
                  connectorBottom={hasChildJoints || !isLastJoint ? "0" : "50%"}
                >
                  <JointListItem
                    jointName={joint.jointName}
                    jointInfo={jointLimits[joint.jointName]}
                    effortLimit={jointEffortLimits[joint.jointName] ?? null}
                    onValueChange={() => {}}
                    isDeleted={deletedJoints.has(joint.jointName)}
                    isSelected={selectedJoint === joint.jointName}
                    isHighlighted={hoveredJoint === joint.jointName}
                    angleUnit={angleUnit}
                    onClick={() => selectHierarchyJoint(joint.jointName)}
                    onHover={undefined}
                    availableJoints={availableJoints}
                    colorJointNames={colorJointNames}
                    isVisible={visibleJoints.has(joint.jointName)}
                    onVisibilityToggle={onVisibilityToggle}
                    hideColorSquare={false}
                    groupLabel={structureLabels.jointByName[joint.jointName] ?? null}
                    compact
                  />
                </TreeIndentedFrame>
                {renderLinkNode(joint.childLink, depth + 1, branchVisitedLinks)}
              </div>
            );
          })}
        </div>
      );
    } catch (error) {
      console.error(`Error rendering link node ${linkName}:`, error);
      return (
        <div key={`error-${linkName}-${depth}`} className="text-xs text-red-500 px-2 py-1">
          Error rendering {linkName}
        </div>
      );
    }
  };

  try {
    return (
      <div className="space-y-0.5">
        {hierarchyTree.rootLinks.map((rootLink, index) => {
          if (!rootLink) return null;
          return (
            <React.Fragment key={`root-${rootLink}-${index}`}>
              {renderLinkNode(rootLink, 0)}
            </React.Fragment>
          );
        })}
      </div>
    );
  } catch (error) {
    console.error("Error rendering hierarchy tree:", error);
    return (
      <div className="flex items-center justify-center h-full text-xs text-red-500 p-4 text-center">
        {resolveHierarchyTreeViewErrorState()}
      </div>
    );
  }
});

HierarchyTreeView.displayName = "HierarchyTreeView";
