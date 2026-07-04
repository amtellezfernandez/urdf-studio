import React from "react";
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

type HierarchyJointRowProps = {
  angleUnit: "rad" | "deg";
  availableJoints: string[];
  colorJointNames: string[];
  deletedJoints: Set<string>;
  hoveredJoint?: string | null;
  jointEffortLimits: Record<string, number | null>;
  jointInfo: JointLimits[string] | undefined;
  jointName: string;
  onSelect: (jointName: string) => void;
  onVisibilityToggle: (jointName: string) => void;
  selectedJoint?: string | null;
  structureLabel: string | null;
  visibleJoints: Set<string>;
};

type HierarchyTreeBranchProps = {
  angleUnit: "rad" | "deg";
  availableJoints: string[];
  colorJointNames: string[];
  deletedJoints: Set<string>;
  endEffectorLink?: string | null;
  hoveredJoint?: string | null;
  jointEffortLimits: Record<string, number | null>;
  jointLimits: JointLimits;
  linkName: string;
  onMarkAsEndEffector?: (linkName: string | null) => void;
  onSelectJoint: (jointName: string) => void;
  onSelectLink: (linkName: string) => void;
  onVisibilityToggle: (jointName: string) => void;
  robot?: URDFRobot | null;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  structureLabels: RobotStructureLabels;
  tree: JointHierarchyTreeModel;
  visibleJoints: Set<string>;
  visitedLinks: Set<string>;
  depth: number;
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
      data-hierarchy-link-row={linkName}
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

function HierarchyJointRow({
  angleUnit,
  availableJoints,
  colorJointNames,
  deletedJoints,
  hoveredJoint,
  jointEffortLimits,
  jointInfo,
  jointName,
  onSelect,
  onVisibilityToggle,
  selectedJoint,
  structureLabel,
  visibleJoints,
}: HierarchyJointRowProps) {
  return (
    <JointListItem
      jointName={jointName}
      jointInfo={jointInfo}
      effortLimit={jointEffortLimits[jointName] ?? null}
      onValueChange={() => {}}
      isDeleted={deletedJoints.has(jointName)}
      isSelected={selectedJoint === jointName}
      isHighlighted={hoveredJoint === jointName}
      angleUnit={angleUnit}
      onClick={() => onSelect(jointName)}
      onHover={undefined}
      availableJoints={availableJoints}
      colorJointNames={colorJointNames}
      isVisible={visibleJoints.has(jointName)}
      onVisibilityToggle={onVisibilityToggle}
      hideColorSquare={false}
      groupLabel={structureLabel}
      compact
    />
  );
}

function HierarchyTreeBranch({
  angleUnit,
  availableJoints,
  colorJointNames,
  deletedJoints,
  depth,
  endEffectorLink,
  hoveredJoint,
  jointEffortLimits,
  jointLimits,
  linkName,
  onMarkAsEndEffector,
  onSelectJoint,
  onSelectLink,
  onVisibilityToggle,
  robot,
  selectedJoint,
  selectedLink,
  structureLabels,
  tree,
  visibleJoints,
  visitedLinks,
}: HierarchyTreeBranchProps) {
  if (visitedLinks.has(linkName) || depth > 100) {
    return null;
  }

  const branchVisitedLinks = new Set(visitedLinks);
  branchVisitedLinks.add(linkName);

  const isSelected = selectedLink === linkName;
  const isEndEffector = endEffectorLink === linkName;
  const structureLabel = structureLabels.linkByName[linkName] ?? null;
  const childJoints = tree.linkToJoints.get(linkName) ?? [];
  const isLeaf = childJoints.length === 0;
  const linkCoordinates =
    isEndEffector && robot ? extractLinkWorldPose(robot, linkName) : null;
  const toggleEndEffector =
    onMarkAsEndEffector
      ? () =>
          onMarkAsEndEffector(
            resolveNextEndEffectorLink({
              currentEndEffectorLink: endEffectorLink,
              linkName,
            })
          )
      : undefined;

  if (isLeaf) {
    return (
      <TreeIndentedFrame
        paddingDepth={depth}
        connectorDepth={depth > 0 ? depth - 1 : undefined}
        connectorBottom={depth > 0 ? "50%" : undefined}
      >
        <HierarchyLinkRow
          linkName={linkName}
          isSelected={isSelected}
          isEndEffector={isEndEffector}
          isLeaf={true}
          structureLabel={structureLabel}
          linkCoordinates={linkCoordinates}
          onSelect={() => onSelectLink(linkName)}
          onToggleEndEffector={toggleEndEffector}
        />
      </TreeIndentedFrame>
    );
  }

  return (
    <div data-hierarchy-branch={linkName}>
      <TreeIndentedFrame
        paddingDepth={depth}
        connectorDepth={depth > 0 ? depth - 1 : undefined}
        connectorBottom={depth > 0 ? "0" : undefined}
      >
        <HierarchyLinkRow
          linkName={linkName}
          isSelected={isSelected}
          isEndEffector={isEndEffector}
          isLeaf={false}
          structureLabel={structureLabel}
          linkCoordinates={null}
          onSelect={() => onSelectLink(linkName)}
          onToggleEndEffector={toggleEndEffector}
        />
      </TreeIndentedFrame>
      {childJoints.map((joint, jointIndex) => {
        if (!joint?.jointName || !joint.childLink) {
          return null;
        }

        const isLastJoint = jointIndex === childJoints.length - 1;
        const grandchildJoints = tree.linkToJoints.get(joint.childLink) ?? [];
        const hasGrandchildJoints = grandchildJoints.length > 0;

        return (
          <div key={`joint-${joint.jointName}`}>
            <TreeIndentedFrame
              paddingDepth={depth + 1}
              connectorDepth={depth}
              connectorBottom={hasGrandchildJoints || !isLastJoint ? "0" : "50%"}
            >
              <HierarchyJointRow
                angleUnit={angleUnit}
                availableJoints={availableJoints}
                colorJointNames={colorJointNames}
                deletedJoints={deletedJoints}
                hoveredJoint={hoveredJoint}
                jointEffortLimits={jointEffortLimits}
                jointInfo={jointLimits[joint.jointName]}
                jointName={joint.jointName}
                onSelect={onSelectJoint}
                onVisibilityToggle={onVisibilityToggle}
                selectedJoint={selectedJoint}
                structureLabel={structureLabels.jointByName[joint.jointName] ?? null}
                visibleJoints={visibleJoints}
              />
            </TreeIndentedFrame>
            <HierarchyTreeBranch
              angleUnit={angleUnit}
              availableJoints={availableJoints}
              colorJointNames={colorJointNames}
              deletedJoints={deletedJoints}
              depth={depth + 1}
              endEffectorLink={endEffectorLink}
              hoveredJoint={hoveredJoint}
              jointEffortLimits={jointEffortLimits}
              jointLimits={jointLimits}
              linkName={joint.childLink}
              onMarkAsEndEffector={onMarkAsEndEffector}
              onSelectJoint={onSelectJoint}
              onSelectLink={onSelectLink}
              onVisibilityToggle={onVisibilityToggle}
              robot={robot}
              selectedJoint={selectedJoint}
              selectedLink={selectedLink}
              structureLabels={structureLabels}
              tree={tree}
              visibleJoints={visibleJoints}
              visitedLinks={branchVisitedLinks}
            />
          </div>
        );
      })}
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

  const selectHierarchyLink = (linkName: string) => {
    onLinkSelect?.(linkName);
    onJointSelect?.(null);
  };
  const selectHierarchyJoint = (jointName: string) => {
    onLinkSelect?.(null);
    onJointSelect?.(jointName);
  };

  try {
    return (
      <div className="space-y-0.5">
        {hierarchyTree.rootLinks.map((rootLink, index) => {
          if (!rootLink) return null;
          return (
            <React.Fragment key={`root-${rootLink}-${index}`}>
              <HierarchyTreeBranch
                angleUnit={angleUnit}
                availableJoints={availableJoints}
                colorJointNames={colorJointNames}
                deletedJoints={deletedJoints}
                depth={0}
                endEffectorLink={endEffectorLink}
                hoveredJoint={hoveredJoint}
                jointEffortLimits={jointEffortLimits}
                jointLimits={jointLimits}
                linkName={rootLink}
                onMarkAsEndEffector={onMarkAsEndEffector}
                onSelectJoint={selectHierarchyJoint}
                onSelectLink={selectHierarchyLink}
                onVisibilityToggle={onVisibilityToggle}
                robot={robot}
                selectedJoint={selectedJoint}
                selectedLink={selectedLink}
                structureLabels={structureLabels}
                tree={hierarchyTree}
                visibleJoints={visibleJoints}
                visitedLinks={new Set()}
              />
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
