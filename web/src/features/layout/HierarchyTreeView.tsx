import React from "react";
import * as THREE from "three";
import { Link2 } from "lucide-react";
import type { URDFRobot } from "urdf-loader";
import { cn } from "@/shared/lib/utils";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { JointListItem } from "@/features/layout/JointListItem";
import type { JointHierarchyTreeModel } from "@/features/layout/sidebarSelectors";
import type { RobotStructureLabels } from "@/features/layout/robotStructureLabels";

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

const HIERARCHY_TREE_INDENT_PX = 8;
const HIERARCHY_TREE_LINE_OFFSET_PX = 4;
const HIERARCHY_TREE_BRANCH_WIDTH_PX = 4;
const HIERARCHY_LINK_COLOR = "#4a9eff";

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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
        No joints found
      </div>
    );
  }

  const toggleEndEffectorForLink = (linkName: string) => {
    if (!onMarkAsEndEffector) return;
    onMarkAsEndEffector(endEffectorLink === linkName ? null : linkName);
  };
  const selectHierarchyLink = (linkName: string) => {
    onLinkSelect?.(linkName);
    onJointSelect?.(null);
  };
  const selectHierarchyJoint = (jointName: string) => {
    onJointSelect?.(jointName);
    onLinkSelect?.(null);
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

      let linkCoordinates: { position: { x: number; y: number; z: number }; quaternion: { w: number; x: number; y: number; z: number } } | null = null;
      if (isEE && robot) {
        try {
          const linkObj = robot.links?.[linkName] ?? robot.getObjectByName?.(linkName);
          if (linkObj) {
            linkObj.updateMatrixWorld?.(true);
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            linkObj.matrixWorld.decompose(position, quaternion, scale);
            linkCoordinates = {
              position: { x: position.x, y: position.y, z: position.z },
              quaternion: { w: quaternion.w, x: quaternion.x, y: quaternion.y, z: quaternion.z },
            };
          }
        } catch (error) {
          console.error("Error getting link coordinates:", error);
        }
      }

      if (joints.length === 0) {
        return (
          <div
            key={`link-${linkName}-${depth}`}
            className="relative"
            style={{ paddingLeft: `${depth * HIERARCHY_TREE_INDENT_PX}px` }}
          >
            {depth > 0 && (
              <>
                <div
                  className="absolute top-1/2 bg-border/30"
                  style={{
                    left: `${(depth - 1) * HIERARCHY_TREE_INDENT_PX + HIERARCHY_TREE_LINE_OFFSET_PX}px`,
                    width: `${HIERARCHY_TREE_BRANCH_WIDTH_PX}px`,
                    height: "1px",
                  }}
                />
                <div
                  className="absolute bg-border/30"
                  style={{
                    left: `${(depth - 1) * HIERARCHY_TREE_INDENT_PX + HIERARCHY_TREE_LINE_OFFSET_PX}px`,
                    top: "0",
                    bottom: "50%",
                    width: "1px",
                  }}
                />
              </>
            )}
            <div
              className={cn(
                "px-1.5 cursor-pointer hover:bg-muted/20 rounded transition-colors",
                isSelected && "hover:bg-muted/30",
                isEE ? "py-1" : "py-0.5"
              )}
              style={
                isSelected
                  ? {
                      backgroundColor: hexToRgba(HIERARCHY_LINK_COLOR, 0.15),
                    }
                  : undefined
              }
              onClick={() => selectHierarchyLink(linkName)}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Link2 className={cn("h-3 w-3 shrink-0", isSelected ? "text-primary" : "text-muted-foreground/60")} />
                <span
                  className={cn(
                    isEE ? "text-[11px] font-semibold" : "text-[10px]",
                    "min-w-0 flex-1 truncate",
                    isSelected ? "" : "text-muted-foreground/60"
                  )}
                  style={
                    isSelected
                      ? { color: HIERARCHY_LINK_COLOR }
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
                {onMarkAsEndEffector ? (
                  <button
                    type="button"
                    className={cn(
                      "text-[7px] px-1 py-0 rounded border font-semibold uppercase tracking-[0.05em]",
                      isEE
                        ? "border-primary/60 bg-primary/20 text-primary"
                        : "border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleEndEffectorForLink(linkName);
                    }}
                    title={isEE ? "Clear end-effector" : "Mark as end-effector"}
                  >
                    {isEE ? "EE" : "Set EE"}
                  </button>
                ) : null}
                {isEE && !onMarkAsEndEffector && (
                  <span className="text-[8px] px-1 py-0.5 bg-primary/20 text-primary rounded font-semibold">
                    EE
                  </span>
                )}
              </div>

              {isEE && linkCoordinates && (
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
              )}
            </div>
          </div>
        );
      }

      return (
        <div key={`link-${linkName}-${depth}`}>
          <div
            className="relative"
            style={{ paddingLeft: `${depth * HIERARCHY_TREE_INDENT_PX}px` }}
          >
            {depth > 0 && (
              <>
                <div
                  className="absolute top-1/2 bg-border/30"
                  style={{
                    left: `${(depth - 1) * HIERARCHY_TREE_INDENT_PX + HIERARCHY_TREE_LINE_OFFSET_PX}px`,
                    width: `${HIERARCHY_TREE_BRANCH_WIDTH_PX}px`,
                    height: "1px",
                  }}
                />
                <div
                  className="absolute bg-border/30"
                  style={{
                    left: `${(depth - 1) * HIERARCHY_TREE_INDENT_PX + HIERARCHY_TREE_LINE_OFFSET_PX}px`,
                    top: "0",
                    bottom: "0",
                    width: "1px",
                  }}
                />
              </>
            )}
            <div
              className={cn(
                "px-1.5 py-0.5 cursor-pointer hover:bg-muted/20 rounded transition-colors",
                isSelected && "hover:bg-muted/30"
              )}
              style={
                isSelected
                  ? {
                      backgroundColor: hexToRgba(HIERARCHY_LINK_COLOR, 0.15),
                    }
                  : undefined
              }
              onClick={() => selectHierarchyLink(linkName)}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Link2 className={cn("h-3 w-3 shrink-0", isSelected ? "text-primary" : "text-muted-foreground/60")} />
                <span
                  className={cn(
                    "text-[10px] min-w-0 flex-1 truncate",
                    isSelected ? "" : "text-muted-foreground/60"
                  )}
                  style={
                    isSelected
                      ? { color: HIERARCHY_LINK_COLOR }
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
                {onMarkAsEndEffector ? (
                  <button
                    type="button"
                    className={cn(
                      "text-[7px] px-1 py-0 rounded border font-semibold uppercase tracking-[0.05em]",
                      endEffectorLink === linkName
                        ? "border-primary/60 bg-primary/20 text-primary"
                        : "border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleEndEffectorForLink(linkName);
                    }}
                    title={endEffectorLink === linkName ? "Clear end-effector" : "Mark as end-effector"}
                  >
                    {endEffectorLink === linkName ? "EE" : "Set EE"}
                  </button>
                ) : null}
                {endEffectorLink === linkName && !onMarkAsEndEffector && (
                  <span className="text-[7px] px-0.5 py-0 bg-primary/20 text-primary rounded font-medium">
                    EE
                  </span>
                )}
              </div>
            </div>
          </div>
          {joints.map((joint, jointIndex) => {
            if (!joint || !joint.jointName || !joint.childLink) {
              return null;
            }

            const isLastJoint = jointIndex === joints.length - 1;
            const childJoints = hierarchyTree.linkToJoints.get(joint.childLink) || [];
            const hasChildJoints = childJoints.length > 0;

            return (
              <div key={`joint-${joint.jointName}`}>
                <div
                  className="relative"
                  style={{ paddingLeft: `${(depth + 1) * HIERARCHY_TREE_INDENT_PX}px` }}
                >
                  <>
                    <div
                      className="absolute top-1/2 bg-border/30"
                      style={{
                        left: `${depth * HIERARCHY_TREE_INDENT_PX + HIERARCHY_TREE_LINE_OFFSET_PX}px`,
                        width: `${HIERARCHY_TREE_BRANCH_WIDTH_PX}px`,
                        height: "1px",
                      }}
                    />
                    <div
                      className="absolute bg-border/30"
                      style={{
                        left: `${depth * HIERARCHY_TREE_INDENT_PX + HIERARCHY_TREE_LINE_OFFSET_PX}px`,
                        top: "0",
                        bottom: hasChildJoints || !isLastJoint ? "0" : "50%",
                        width: "1px",
                      }}
                    />
                  </>
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
                </div>
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
        Error rendering hierarchy view. Check console for details.
      </div>
    );
  }
});

HierarchyTreeView.displayName = "HierarchyTreeView";
