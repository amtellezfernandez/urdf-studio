import type React from "react";
import { useState, useMemo } from "react";
import { JointListItem } from "@/components/JointListItem";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";
import { useJointStore } from "@/store/useJointStore";

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
}: JointListSidebarProps) => {
  const jointValues = useJointStore((s) => s.jointValues);
  const angleUnitStore = useJointStore((s) => s.angleUnit);
  const setAngleUnitStore = useJointStore((s) => s.setAngleUnit);

  // Use prop if provided, otherwise use store
  const angleUnit = angleUnitProp ?? angleUnitStore;
  const onAngleUnitChange = onAngleUnitChangeProp ?? setAngleUnitStore;

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Get all unique joint types
  const jointTypes = useMemo(() => {
    const types = new Set<string>();
    Object.values(jointLimits).forEach(j => {
      if (j?.type) types.add(j.type);
    });
    return Array.from(types).sort();
  }, [jointLimits]);

  // Filter joints by search and type
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

        {/* Type Filter and Angle Unit */}
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        {filteredJoints.length === 0 ? (
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
        )}
      </div>
    </div>
  );
};
