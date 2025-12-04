import React, { useState, useMemo, useEffect } from "react";
import { JointListItem } from "@/components/JointListItem";
import { JointControl } from "@/components/JointControl";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";
import type { JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { useJointStore } from "@/store/useJointStore";
import { parseJointHierarchy, type JointHierarchyNode } from "@/urdf_corrections/parseJointHierarchy";
import { parseLinkData, type LinkData } from "@/urdf_corrections/parseLinkData";
import { LinkControl } from "@/components/LinkEditor";
import type { CollisionVisibility } from "@/components/LinkEditor";

// Recursive component to render hierarchy tree
interface HierarchyTreeViewProps {
  hierarchyTree: {
    linkToJoints: Map<string, JointHierarchyNode[]>;
    rootLinks: string[];
    filteredJoints: JointHierarchyNode[];
  } | null;
  jointLimits: JointLimits;
  jointValues: Record<string, number>;
  deletedJoints: Set<string>;
  selectedJoint?: string | null;
  hoveredJoint?: string | null;
  angleUnit: "rad" | "deg";
  onJointSelect?: (jointName: string | null) => void;
  onJointHover?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
  selectedLink?: string | null;
  availableJoints: string[];
  visibleJoints: Set<string>;
  onVisibilityToggle: (jointName: string) => void;
}

const HierarchyTreeView = ({
  hierarchyTree,
  jointLimits,
  jointValues,
  deletedJoints,
  selectedJoint,
  hoveredJoint,
  angleUnit,
  onJointSelect,
  onJointHover,
  onLinkSelect,
  selectedLink,
  availableJoints,
  visibleJoints,
  onVisibilityToggle,
}: HierarchyTreeViewProps) => {
  if (!hierarchyTree || hierarchyTree.rootLinks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        No joints found
      </div>
    );
  }

  const renderLinkNode = (linkName: string, depth: number = 0, visitedLinks: Set<string> = new Set()): React.ReactNode => {
    // Prevent infinite loops and excessive depth
    if (visitedLinks.has(linkName) || depth > 100) {
      return null;
    }
    
    // Create a new set for this branch to track visited links
    const branchVisitedLinks = new Set(visitedLinks);
    branchVisitedLinks.add(linkName);

    try {
      const joints = hierarchyTree.linkToJoints.get(linkName) || [];
      if (joints.length === 0) {
        // Leaf link - just show the link
        return (
          <div key={`link-${linkName}-${depth}`} className="relative" style={{ paddingLeft: `${depth * 12}px` }}>
            <div 
              className={cn(
                "px-1.5 py-0.5 cursor-pointer hover:bg-muted/20 rounded transition-colors",
                selectedLink === linkName && "bg-primary/10"
              )}
              onClick={() => {
                onLinkSelect?.(linkName);
                onJointSelect?.(null); // Clear joint selection when selecting link
              }}
            >
              <span className="text-[10px] text-muted-foreground/60">
                🔗 {linkName}
              </span>
            </div>
          </div>
        );
      }

      return (
        <div key={`link-${linkName}-${depth}`}>
          {/* Link */}
          <div className="relative" style={{ paddingLeft: `${depth * 12}px` }}>
            {depth > 0 && (
              <>
                {/* Horizontal line to link */}
                <div
                  className="absolute top-1/2 bg-border/30"
                  style={{
                    left: `${(depth - 1) * 12 + 6}px`,
                    width: '6px',
                    height: '1px',
                  }}
                />
                {/* Vertical line */}
                <div
                  className="absolute bg-border/30"
                  style={{
                    left: `${(depth - 1) * 12 + 6}px`,
                    top: '0',
                    bottom: '0',
                    width: '1px',
                  }}
                />
              </>
            )}
            <div 
              className={cn(
                "px-1.5 py-0.5 cursor-pointer hover:bg-muted/20 rounded transition-colors",
                selectedLink === linkName && "bg-primary/10"
              )}
              onClick={() => {
                onLinkSelect?.(linkName);
                onJointSelect?.(null); // Clear joint selection when selecting link
              }}
            >
              <span className="text-[10px] text-muted-foreground/60">
                🔗 {linkName}
              </span>
            </div>
          </div>
          {/* Joints connected from this link */}
          {joints.map((joint, jointIndex) => {
            if (!joint || !joint.jointName || !joint.childLink) {
              return null;
            }
            
            const isLastJoint = jointIndex === joints.length - 1;
            const childJoints = hierarchyTree.linkToJoints.get(joint.childLink) || [];
            const hasChildJoints = childJoints.length > 0;
            
            return (
              <div key={`joint-${joint.jointName}`}>
                {/* Joint */}
                <div className="relative" style={{ paddingLeft: `${(depth + 1) * 12}px` }}>
                  {/* Tree lines */}
                  <>
                    {/* Horizontal line to joint */}
                    <div
                      className="absolute top-1/2 bg-border/30"
                      style={{
                        left: `${depth * 12 + 6}px`,
                        width: '6px',
                        height: '1px',
                      }}
                    />
                    {/* Vertical line */}
                    <div
                      className="absolute bg-border/30"
                      style={{
                        left: `${depth * 12 + 6}px`,
                        top: '0',
                        bottom: hasChildJoints || !isLastJoint ? '0' : '50%',
                        width: '1px',
                      }}
                    />
                  </>
                  <JointListItem
                    jointName={joint.jointName}
                    jointInfo={jointLimits[joint.jointName]}
                    currentValue={jointValues[joint.jointName] ?? 0}
                    onValueChange={() => {}} // Read-only
                    isDeleted={deletedJoints.has(joint.jointName)}
                    isSelected={selectedJoint === joint.jointName}
                    isHighlighted={hoveredJoint === joint.jointName}
                    angleUnit={angleUnit}
                    onClick={() => {
                      onJointSelect?.(joint.jointName);
                      onLinkSelect?.(null); // Clear link selection when selecting joint
                    }}
                    onHover={undefined} // Disable hover activation in hierarchy view
                    availableJoints={availableJoints}
                    isVisible={visibleJoints.has(joint.jointName)}
                    onVisibilityToggle={onVisibilityToggle}
                    hideColorSquare={true}
                  />
                </div>
                {/* Recursively render child link */}
                {renderLinkNode(joint.childLink, depth + 2, branchVisitedLinks)}
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
};

export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 280;
export const RIGHT_SIDEBAR_MIN_WIDTH = 200;
export const RIGHT_SIDEBAR_MAX_WIDTH = 450;

interface JointListSidebarProps {
  availableJoints: string[];
  jointLimits: JointLimits;
  selectedJoint?: string | null;
  onJointSelect?: (jointName: string | null) => void;
  onJointHover?: (jointName: string | null) => void;
  hoveredJoint?: string | null;
  deletedJoints?: Set<string>;
  width?: number;
  isCollapsed?: boolean;
  angleUnit?: "rad" | "deg";
  onAngleUnitChange?: (unit: "rad" | "deg") => void;
  urdfContent?: string;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  onJointChange?: (jointName: string, value: number) => void;
  onJointAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis?: (jointName: string) => void;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointNameChange?: (oldName: string, newName: string) => void;
  onDeleteJoint?: (jointName: string) => void;
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  // Link editing props
  meshFiles?: Record<string, Blob>;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onLinkNameChange?: (oldName: string, newName: string) => void;
  onUrdfChange?: (newContent: string) => void;
  collisionVisibility?: CollisionVisibility;
  onCollisionVisibilityChange?: (visibility: CollisionVisibility) => void;
}

export const JointListSidebar = ({
  availableJoints,
  jointLimits,
  selectedJoint,
  onJointSelect,
  onJointHover,
  hoveredJoint,
  deletedJoints = new Set(),
  width = DEFAULT_RIGHT_SIDEBAR_WIDTH,
  isCollapsed = false,
  angleUnit: angleUnitProp,
  onAngleUnitChange: onAngleUnitChangeProp,
  urdfContent,
  jointAxes = {},
  originalJointAxes = {},
  onJointChange,
  onJointAxisChange,
  onResetAxis,
  onJointTypeChange,
  onJointNameChange,
  onDeleteJoint,
  onJointLinkChange,
  meshFiles = {},
  onMaterialChange,
  onLinkNameChange,
  onUrdfChange,
  collisionVisibility = {},
  onCollisionVisibilityChange,
}: JointListSidebarProps) => {
  const jointValues = useJointStore((s) => s.jointValues);

  // Use prop if provided, otherwise default to "rad"
  const angleUnit = angleUnitProp ?? "rad";
  const onAngleUnitChange = onAngleUnitChangeProp ?? (() => {});

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"links" | "flat" | "hierarchy">("flat");
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [visibleJoints, setVisibleJoints] = useState<Set<string>>(new Set(availableJoints));

  // Sync visibility state with availableJoints changes
  useEffect(() => {
    // Initialize all joints as visible when availableJoints changes
    setVisibleJoints(new Set(availableJoints));
  }, [availableJoints]);

  // Listen for visibility changes from episode viewer
  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ jointName: string; isVisible: boolean }>;
      const { jointName, isVisible } = customEvent.detail;
      setVisibleJoints(prev => {
        const newSet = new Set(prev);
        if (isVisible) {
          newSet.add(jointName);
        } else {
          newSet.delete(jointName);
        }
        return newSet;
      });
    };

    window.addEventListener('episodeViewer:jointVisibilityChange' as any, handleVisibilityChange);
    return () => {
      window.removeEventListener('episodeViewer:jointVisibilityChange' as any, handleVisibilityChange);
    };
  }, []);

  const handleVisibilityToggle = (jointName: string) => {
    const isVisible = visibleJoints.has(jointName);
    const newVisible = new Set(visibleJoints);
    if (isVisible) {
      newVisible.delete(jointName);
    } else {
      newVisible.add(jointName);
    }
    setVisibleJoints(newVisible);
    
    // Dispatch event for episode viewer
    const event = new CustomEvent('jointVisibilityToggle', {
      detail: { jointName, isVisible: !isVisible }
    });
    window.dispatchEvent(event);
  };

  // Get all unique joint types
  const jointTypes = useMemo(() => {
    const types = new Set<string>();
    Object.values(jointLimits).forEach(j => {
      if (j?.type) types.add(j.type);
    });
    return Array.from(types).sort();
  }, [jointLimits]);

  // Parse hierarchical structure
  const jointHierarchy = useMemo(() => {
    if (!urdfContent) return null;
    return parseJointHierarchy(urdfContent);
  }, [urdfContent]);

  // Get all links from URDF
  const allLinks = useMemo(() => {
    if (!urdfContent) return [];
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) return [];

      const robot = xmlDoc.querySelector("robot");
      if (!robot) return [];

      const linkElements = xmlDoc.querySelectorAll("link");
      const links: string[] = [];
      linkElements.forEach((link) => {
        const name = link.getAttribute("name");
        if (name) links.push(name);
      });
      return links.sort();
    } catch (error) {
      console.error("Error parsing links:", error);
      return [];
    }
  }, [urdfContent]);

  // Get selected link data
  const selectedLinkData = useMemo(() => {
    if (!selectedLink || !urdfContent) return null;
    try {
      return parseLinkData(urdfContent, selectedLink);
    } catch (error) {
      console.error("Error parsing link data:", error);
      return null;
    }
  }, [selectedLink, urdfContent]);

  // Filter links by search query
  const filteredLinks = useMemo(() => {
    if (!searchQuery.trim()) return allLinks;
    const query = searchQuery.toLowerCase();
    return allLinks.filter(linkName => linkName.toLowerCase().includes(query));
  }, [allLinks, searchQuery]);

  // Filter joints by search and type (flat view)
  // Use jointLimits as source of truth to ensure all joints (including fixed) are visible
  const filteredJoints = useMemo(() => {
    // Combine availableJoints and all joints from jointLimits to ensure nothing is missed
    const allJointsSet = new Set([
      ...availableJoints,
      ...Object.keys(jointLimits)
    ]);
    let joints = Array.from(allJointsSet);

    // Filter by type
    if (typeFilter !== "all") {
      joints = joints.filter(jointName => {
        const jointInfo = jointLimits[jointName];
        return jointInfo?.type === typeFilter;
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      joints = joints.filter(jointName =>
        jointName.toLowerCase().includes(query)
      );
    }

    return joints;
  }, [availableJoints, jointLimits, typeFilter, searchQuery]);

  // Build tree structure for hierarchy view (Link -> Joint -> Link -> Joint...)
  const hierarchyTree = useMemo(() => {
    if (!jointHierarchy || viewMode !== "hierarchy") return null;

    // Build a map of link -> joints that have this link as parent
    const linkToJoints = new Map<string, JointHierarchyNode[]>();
    const processedLinks = new Set<string>();
    const rootLinks = new Set<string>();

    // Get filtered joints
    const filteredJoints = jointHierarchy.orderedJoints.filter(joint => {
      const jointType = jointLimits[joint.jointName]?.type || joint.type;
      const matchesType = typeFilter === "all" || jointType === typeFilter;
      const matchesSearch = !searchQuery.trim() || joint.jointName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });

    // Build link to joints mapping
    filteredJoints.forEach(joint => {
      if (!linkToJoints.has(joint.parentLink)) {
        linkToJoints.set(joint.parentLink, []);
      }
      linkToJoints.get(joint.parentLink)!.push(joint);
      processedLinks.add(joint.childLink);
    });

    // Find root links (links that are not child links of any filtered joint)
    filteredJoints.forEach(joint => {
      if (!processedLinks.has(joint.parentLink)) {
        rootLinks.add(joint.parentLink);
      }
    });

    return { linkToJoints, rootLinks: Array.from(rootLinks), filteredJoints };
  }, [jointHierarchy, viewMode, typeFilter, searchQuery, jointLimits]);

  // Filter hierarchical joints (for backward compatibility)
  const filteredHierarchyJoints = useMemo(() => {
    if (!jointHierarchy) return [];

    // Get all joints in URDF order, filtered
    return jointHierarchy.orderedJoints.filter(joint => {
      // Use type from jointLimits if available (updates immediately), fallback to hierarchy type
      const jointType = jointLimits[joint.jointName]?.type || joint.type;
      const matchesType = typeFilter === "all" || jointType === typeFilter;
      const matchesSearch = !searchQuery.trim() || joint.jointName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [jointHierarchy, typeFilter, searchQuery, jointLimits]);

  if (isCollapsed) {
    return null;
  }

  return (
    <div
      className="fixed right-0 z-30 h-screen bg-background border-l border-border/20 flex flex-col"
      style={{
        width,
        top: "28px", // Account for top navigation bar
        height: "calc(100vh - 28px)",
      }}
    >
      {/* Two equal square sections */}
      <div className="grid grid-rows-2 h-full gap-0.5 p-0.5">
        {/* Top Section: Joints */}
        <div className="flex flex-col min-h-0 border border-border/30 rounded-sm bg-background overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 px-3 py-2 border-b border-border/20 bg-muted/5">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode("flat")}
                className={cn(
                  "text-xs font-medium transition-colors",
                  viewMode === "flat"
                    ? "text-primary cursor-default"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
              >
                Joints
              </button>
              <button
                onClick={() => setViewMode("hierarchy")}
                disabled={!urdfContent}
                className={cn(
                  "text-xs font-medium transition-colors",
                  viewMode === "hierarchy"
                    ? "text-primary cursor-default"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
              >
                Hierarchy
              </button>
              <button
                onClick={() => setViewMode("links")}
                disabled={!urdfContent}
                className={cn(
                  "text-xs font-medium transition-colors",
                  viewMode === "links"
                    ? "text-primary cursor-default"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
              >
                Links
              </button>
              <div className="flex-1"></div>
            </div>
          </div>

          {/* Filters and Controls */}
          <div className="flex-shrink-0 p-2 space-y-2 border-b border-border/20 bg-background">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder={viewMode === "links" ? "Search links..." : "Search joints..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 pl-7 pr-7 text-xs bg-background border-border/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Type Filter - only show for flat joint view (not hierarchy or links) */}
            {viewMode === "flat" && (
              <div className="flex items-center gap-2">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-7 text-xs flex-1 bg-background border-border/50">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-xs">All</SelectItem>
                    {jointTypes.map(type => (
                      <SelectItem key={type} value={type} className="text-xs capitalize">
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {filteredJoints.length} of {Object.keys(jointLimits).length}
                </span>
              </div>
            )}
            {/* Links count - only show for links view */}
            {viewMode === "links" && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {filteredLinks.length} of {allLinks.length}
                </span>
              </div>
            )}
          </div>

          {/* Scrollable Joint List */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 minimal-scrollbar">
            {viewMode === "links" ? (
              // Links view
              filteredLinks.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {searchQuery
                    ? "No links match the search"
                    : "No links available"}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredLinks.map((linkName) => (
                    <div
                      key={linkName}
                      className={cn(
                        "px-1.5 py-1.5 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/10",
                        selectedLink === linkName && "bg-primary/10 border-primary/30"
                      )}
                      onClick={() => {
                        setSelectedLink(linkName);
                        onJointSelect?.(null); // Clear joint selection when selecting link
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground/60">🔗</span>
                        <span className="text-xs font-medium text-foreground">{linkName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : viewMode === "flat" ? (
              // Flat view
              filteredJoints.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {searchQuery || typeFilter !== "all"
                    ? "No joints match the filters"
                    : "No joints available"}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredJoints.map((jointName) => (
                    <JointListItem
                      key={jointName}
                      jointName={jointName}
                      jointInfo={jointLimits[jointName]}
                      currentValue={jointValues[jointName] ?? 0}
                      onValueChange={() => {}} // Read-only
                      isDeleted={deletedJoints.has(jointName)}
                      isSelected={selectedJoint === jointName}
                      isHighlighted={hoveredJoint === jointName}
                      angleUnit={angleUnit}
                      onClick={() => {
                        onJointSelect?.(jointName);
                        setSelectedLink(null); // Clear link selection when selecting joint
                      }}
                      onHover={onJointHover}
                      availableJoints={availableJoints}
                      isVisible={visibleJoints.has(jointName)}
                      onVisibilityToggle={handleVisibilityToggle}
                    />
                  ))}
                </div>
              )
            ) : (
              // Hierarchical view
              !hierarchyTree || filteredHierarchyJoints.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {!hierarchyTree 
                    ? "Loading hierarchy..."
                    : searchQuery || typeFilter !== "all"
                    ? "No joints match the filters"
                    : "No joints available"}
                </div>
              ) : (
                <HierarchyTreeView
                  hierarchyTree={hierarchyTree}
                  jointLimits={jointLimits}
                  jointValues={jointValues}
                  deletedJoints={deletedJoints}
                  selectedJoint={selectedJoint}
                  hoveredJoint={hoveredJoint}
                  angleUnit={angleUnit}
                  onJointSelect={onJointSelect}
                  onJointHover={onJointHover}
                  onLinkSelect={(linkName) => {
                    setSelectedLink(linkName);
                  }}
                  selectedLink={selectedLink}
                  availableJoints={availableJoints}
                  visibleJoints={visibleJoints}
                  onVisibilityToggle={handleVisibilityToggle}
                />
              )
            )}
          </div>
        </div>

        {/* Bottom Section: General Editor */}
        <div className="flex flex-col min-h-0 border border-border/30 rounded-sm bg-background overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 px-3 py-2 border-b border-border/20 bg-muted/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {selectedJoint ? `Joint Editor (${selectedJoint})` : selectedLink ? `Link Editor (${selectedLink})` : "No Selection"}
              </span>
              {(selectedJoint || selectedLink) && (
                <button
                  onClick={() => {
                    onJointSelect?.(null);
                    setSelectedLink(null);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Close editor"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden minimal-scrollbar">
            {selectedJoint ? (
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
                  currentValue={jointValues[selectedJoint] ?? 0}
                  onValueChange={(value) => {
                    if (onJointChange && selectedJoint) {
                      onJointChange(selectedJoint, value);
                    }
                  }}
                  onAxisChange={onJointAxisChange}
                  onResetAxis={onResetAxis}
                  onDeleteJoint={onDeleteJoint}
                  isDeleted={deletedJoints.has(selectedJoint)}
                  angleUnit={angleUnit}
                  onHover={onJointHover}
                  urdfContent={urdfContent}
                  isHighlighted={true}
                  onLinkChange={onJointLinkChange}
                  onTypeChange={onJointTypeChange ? (newType, lowerLimit, upperLimit) => {
                    onJointTypeChange(selectedJoint, newType, lowerLimit, upperLimit);
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
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50 p-4 text-center">
                Select a joint or link to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
