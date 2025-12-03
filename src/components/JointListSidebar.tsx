import type React from "react";
import { useState, useMemo } from "react";
import { JointListItem } from "@/components/JointListItem";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Search, X, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";
import { useJointStore } from "@/store/useJointStore";
import { parseJointHierarchy } from "@/urdf_corrections/parseJointHierarchy";

export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 280;
export const RIGHT_SIDEBAR_MIN_WIDTH = 200;
export const RIGHT_SIDEBAR_MAX_WIDTH = 450;

interface JointListSidebarProps {
  availableJoints: string[];
  jointLimits: JointLimits;
  selectedJoint?: string | null;
  onJointSelect?: (jointName: string | null) => void;
  deletedJoints?: Set<string>;
  width?: number;
  isCollapsed?: boolean;
  angleUnit?: "rad" | "deg";
  onAngleUnitChange?: (unit: "rad" | "deg") => void;
  urdfContent?: string;
}

export const JointListSidebar = ({
  availableJoints,
  jointLimits,
  selectedJoint,
  onJointSelect,
  deletedJoints = new Set(),
  width = DEFAULT_RIGHT_SIDEBAR_WIDTH,
  isCollapsed = false,
  angleUnit: angleUnitProp,
  onAngleUnitChange: onAngleUnitChangeProp,
  urdfContent,
}: JointListSidebarProps) => {
  const jointValues = useJointStore((s) => s.jointValues);
  const angleUnitStore = useJointStore((s) => s.angleUnit);
  const setAngleUnitStore = useJointStore((s) => s.setAngleUnit);

  // Use prop if provided, otherwise use store
  const angleUnit = angleUnitProp ?? angleUnitStore;
  const onAngleUnitChange = onAngleUnitChangeProp ?? setAngleUnitStore;

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"flat" | "hierarchy">("flat");

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

  // Filter joints by search and type (flat view)
  const filteredJoints = useMemo(() => {
    let joints = availableJoints;

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

  // Filter hierarchical joints
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
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Joints</span>
              <span className="text-[10px] text-muted-foreground">
                {filteredJoints.length} of {availableJoints.length}
              </span>
            </div>
          </div>

          {/* Filters and Controls */}
          <div className="flex-shrink-0 p-2 space-y-2 border-b border-border/20 bg-background">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Search joints..."
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

            {/* Type Filter, Angle Unit, and Hierarchy Toggle */}
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

              <button
                onClick={() => setViewMode(viewMode === "flat" ? "hierarchy" : "flat")}
                className={cn(
                  "h-7 px-1.5 flex items-center gap-1 text-xs rounded border transition-colors flex-shrink-0",
                  viewMode === "hierarchy"
                    ? "bg-primary/15 border-primary/50 text-primary"
                    : "bg-muted/20 border-border/30 text-foreground hover:bg-muted/30"
                )}
                title={viewMode === "flat" ? "Switch to hierarchical view" : "Switch to flat view"}
                disabled={!urdfContent}
              >
                <Network className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/20 rounded border border-border/30 flex-shrink-0">
                <span className="text-[10px] text-muted-foreground min-w-[24px]">rad</span>
                <Switch
                  checked={angleUnit === "deg"}
                  onCheckedChange={(checked) => onAngleUnitChange(checked ? "deg" : "rad")}
                  className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
                />
                <span className="text-[10px] text-muted-foreground min-w-[24px]">deg</span>
              </div>
            </div>
          </div>

          {/* Scrollable Joint List */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2">
            {viewMode === "flat" ? (
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
                      angleUnit={angleUnit}
                      onClick={() => onJointSelect?.(jointName)}
                      onHover={onJointSelect}
                    />
                  ))}
                </div>
              )
            ) : (
              // Hierarchical view
              filteredHierarchyJoints.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {searchQuery || typeFilter !== "all"
                    ? "No joints match the filters"
                    : "No joints available"}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredHierarchyJoints.map((joint, index) => {
                    const depth = joint.depth ?? 0;
                    const isLast = index === filteredHierarchyJoints.length - 1;
                    const nextDepth = !isLast ? (filteredHierarchyJoints[index + 1]?.depth ?? 0) : 0;

                    return (
                      <div
                        key={`${joint.jointName}-${jointLimits[joint.jointName]?.type || 'unknown'}`}
                        className="relative"
                        style={{ paddingLeft: `${depth * 12}px` }}
                      >
                        {/* Tree lines */}
                        {depth > 0 && (
                          <>
                            {/* Horizontal line to joint */}
                            <div
                              className="absolute top-1/2 bg-border/30"
                              style={{
                                left: `${(depth - 1) * 12 + 6}px`,
                                width: '6px',
                                height: '1px',
                              }}
                            />
                            {/* Vertical line from parent */}
                            <div
                              className="absolute bg-border/30"
                              style={{
                                left: `${(depth - 1) * 12 + 6}px`,
                                top: '0',
                                bottom: nextDepth >= depth ? '0' : '50%',
                                width: '1px',
                              }}
                            />
                          </>
                        )}
                        <JointListItem
                          jointName={joint.jointName}
                          jointInfo={jointLimits[joint.jointName]}
                          currentValue={jointValues[joint.jointName] ?? 0}
                          onValueChange={() => {}} // Read-only
                          isDeleted={deletedJoints.has(joint.jointName)}
                          isSelected={selectedJoint === joint.jointName}
                          angleUnit={angleUnit}
                          onClick={() => onJointSelect?.(joint.jointName)}
                          onHover={onJointSelect}
                        />
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>

        {/* Bottom Section: Empty for now */}
        <div className="flex flex-col min-h-0 border border-border/30 rounded-sm bg-background overflow-hidden">
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
            {/* Empty section - ready for future content */}
          </div>
        </div>
      </div>
    </div>
  );
};
