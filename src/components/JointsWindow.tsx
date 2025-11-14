import { useState, useMemo } from "react";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { BlenderPanel } from "@/components/ui/blender-panel";
import { JointControl } from "@/components/JointControl";
import { Search, X, ChevronDown, ChevronRight, Network, RotateCw, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";
import type { JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { parseJointHierarchy, type JointHierarchyNode } from "@/urdf_corrections/parseJointHierarchy";

interface JointsWindowProps {
  availableJoints: string[];
  jointLimits: JointLimits;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  storeJointValues: Record<string, number>;
  onJointChange: (jointName: string, value: number) => void;
  onJointSelect?: (jointName: string | null) => void;
  selectedJoint?: string | null;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointNameChange?: (oldName: string, newName: string) => void;
  onJointAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis?: (jointName: string) => void;
  onDeleteJoint?: (jointName: string) => void;
  deletedJoints: Set<string>;
  angleUnit: "rad" | "deg";
  onAngleUnitChange: (unit: "rad" | "deg") => void;
  urdfContent?: string;
  velocityLimitEnabled?: boolean;
  onVelocityLimitEnabledChange?: (enabled: boolean) => void;
  globalMaxJointVelocity?: number;
  onGlobalMaxJointVelocityChange?: (velocity: number) => void;
  sliderValue?: number;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  fromDisplayVelocity?: (value: number) => number;
  applyGlobalVelocityToAll?: () => void;
  onRotateRobot?: (axis: "x" | "y" | "z") => void;
  rotationAxis?: "x" | "y" | "z";
  onRotationAxisChange?: (axis: "x" | "y" | "z") => void;
  onResetRotation?: () => void;
  hasRotationChanges?: boolean;
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  rotationPlaneVisible?: boolean;
  onRotationPlaneVisibilityChange?: (visible: boolean) => void;
}

export const JointsWindow = ({
  availableJoints,
  jointLimits,
  jointAxes = {},
  originalJointAxes = {},
  storeJointValues,
  onJointChange,
  onJointSelect,
  selectedJoint,
  onJointTypeChange,
  onJointNameChange,
  onJointAxisChange,
  onResetAxis,
  onDeleteJoint,
  deletedJoints,
  angleUnit,
  onAngleUnitChange,
  urdfContent,
  velocityLimitEnabled = false,
  onVelocityLimitEnabledChange,
  globalMaxJointVelocity = 0,
  onGlobalMaxJointVelocityChange,
  sliderValue = 0,
  sliderMin = 0,
  sliderMax = 10,
  sliderStep = 0.1,
  fromDisplayVelocity,
  applyGlobalVelocityToAll,
  onRotateRobot,
  rotationAxis = "z",
  onRotationAxisChange,
  onResetRotation,
  hasRotationChanges = false,
  onJointLinkChange,
  rotationPlaneVisible = false,
  onRotationPlaneVisibilityChange,
}: JointsWindowProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(["revolute", "continuous"]));
  const [viewMode, setViewMode] = useState<"type" | "hierarchy">("type");

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
    let joints = Object.keys(jointLimits);
    
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
    
    return joints.sort();
  }, [jointLimits, typeFilter, searchQuery]);

  // Group joints by type
  const jointsByType = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    filteredJoints.forEach(jointName => {
      const type = jointLimits[jointName]?.type || "unknown";
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(jointName);
    });
    return grouped;
  }, [filteredJoints, jointLimits]);

  // Parse hierarchical structure
  const jointHierarchy = useMemo(() => {
    if (!urdfContent) return null;
    return parseJointHierarchy(urdfContent);
  }, [urdfContent]);

  // Filter and order joints for Blender-style flat list view
  const filteredOrderedJoints = useMemo(() => {
    if (!jointHierarchy) return [];
    
    // Get all joints in URDF order, filtered
    return jointHierarchy.orderedJoints.filter(joint => {
      const matchesType = typeFilter === "all" || joint.type === typeFilter;
      const matchesSearch = !searchQuery.trim() || joint.jointName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [jointHierarchy, typeFilter, searchQuery]);

  // Render folder-style flat hierarchy
  const renderFlatHierarchy = (): React.ReactNode => {
    if (!jointHierarchy) return null;
    
    return filteredOrderedJoints.map((joint) => {
      const depth = joint.depth ?? 0;
      
      return (
        <div 
          key={joint.jointName} 
          className="mb-1"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          <JointControl
            jointName={joint.jointName}
            jointInfo={jointLimits[joint.jointName]}
            jointAxis={jointAxes[joint.jointName]}
            originalAxis={originalJointAxes?.[joint.jointName]}
            currentValue={storeJointValues[joint.jointName] ?? 0}
            onValueChange={(value) => {
              onJointChange(joint.jointName, value);
              onJointSelect?.(joint.jointName);
            }}
            onTypeChange={(newType, lowerLimit, upperLimit) => {
              onJointTypeChange?.(joint.jointName, newType, lowerLimit, upperLimit);
            }}
            onNameChange={onJointNameChange}
            onAxisChange={onJointAxisChange}
            onResetAxis={onResetAxis}
            onDeleteJoint={onDeleteJoint}
            isDeleted={deletedJoints.has(joint.jointName)}
            angleUnit={angleUnit}
            onHover={onJointSelect}
            urdfContent={urdfContent}
            isHighlighted={selectedJoint === joint.jointName}
            onLinkChange={onJointLinkChange}
          />
        </div>
      );
    });
  };

  const toggleTypeExpansion = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const hasJoints = Object.keys(jointLimits).length > 0;

  return (
    <div className="flex flex-col w-full">
      {/* Robot Position - Compact single line */}
      {onRotateRobot && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border/30 bg-muted/10">
          <span className="text-xs font-semibold text-foreground flex-shrink-0">Robot Position</span>
          <Select
            value={rotationAxis}
            onValueChange={(value) => onRotationAxisChange?.(value as "x" | "y" | "z")}
          >
            <SelectTrigger className="h-6 text-xs w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="x" className="text-xs">X</SelectItem>
              <SelectItem value="y" className="text-xs">Y</SelectItem>
              <SelectItem value="z" className="text-xs">Z</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="default"
            size="sm"
            className="h-6 px-2 text-xs flex-shrink-0"
            onClick={() => onRotateRobot(rotationAxis)}
            title={`Rotate root link and direct children 90° around ${rotationAxis.toUpperCase()}-axis`}
          >
            <RotateCw className="w-3 h-3" />
          </Button>
          {onResetRotation && hasRotationChanges && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs flex-shrink-0"
              onClick={onResetRotation}
              title="Reset rotation to original position"
            >
              Reset
            </Button>
          )}
        </div>
      )}

      {/* Global Motion Limits - Compact single line */}
      {(onVelocityLimitEnabledChange || onRotationPlaneVisibilityChange) && (
        <div className="flex flex-col gap-1.5 px-3 py-2 text-xs border-b border-border/30 bg-muted/10">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground flex-shrink-0">Motion Limits</span>
            {onVelocityLimitEnabledChange && (
              <Switch
                checked={velocityLimitEnabled}
                onCheckedChange={onVelocityLimitEnabledChange}
                className="h-5 w-9 flex-shrink-0 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted"
              />
            )}
            {velocityLimitEnabled && fromDisplayVelocity && onGlobalMaxJointVelocityChange && (
              <>
                <div className="flex-1 min-w-0 px-2">
                  <Slider
                    value={[sliderValue]}
                    min={sliderMin}
                    max={sliderMax}
                    step={sliderStep}
                    onValueChange={([value]) => onGlobalMaxJointVelocityChange(fromDisplayVelocity(value))}
                    className="h-2"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground min-w-[55px] text-right flex-shrink-0">
                  {sliderValue.toFixed(angleUnit === "deg" ? 1 : 2)} {angleUnit === "deg" ? "°/s" : "rad/s"}
                </span>
                {applyGlobalVelocityToAll && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] flex-shrink-0"
                    onClick={applyGlobalVelocityToAll}
                  >
                    Apply All
                  </Button>
                )}
              </>
            )}
          </div>
          {/* Rotation Planes Toggle */}
          {onRotationPlaneVisibilityChange && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-shrink-0">Rotation Planes</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => onRotationPlaneVisibilityChange(!rotationPlaneVisible)}
                title={rotationPlaneVisible ? "Hide rotation planes" : "Show rotation planes"}
              >
                {rotationPlaneVisible ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Header Controls */}
      <div className="flex-shrink-0 space-y-2 p-3 border-b border-border/30">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search joints..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 pr-8 text-xs bg-input border-border"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center hover:bg-muted/50 rounded"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filters Row */}
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-xs">All Types</SelectItem>
              {jointTypes.map(type => (
                <SelectItem key={type} value={type} className="text-xs capitalize">
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2.5 px-3 py-1.5 bg-muted/30 rounded border border-border/50">
            <span className="text-xs text-muted-foreground min-w-[24px]">rad</span>
            <Switch
              checked={angleUnit === "deg"}
              onCheckedChange={(checked) => onAngleUnitChange(checked ? "deg" : "rad")}
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted h-5 w-9"
            />
            <span className="text-xs text-muted-foreground min-w-[24px]">deg</span>
          </div>

          <button
            onClick={() => setViewMode(viewMode === "type" ? "hierarchy" : "type")}
            className={cn(
              "h-7 px-2 flex items-center gap-1.5 text-xs rounded border transition-colors",
              viewMode === "hierarchy"
                ? "bg-primary/20 border-primary text-primary"
                : "bg-muted/30 border-border text-foreground hover:bg-muted/50"
            )}
            title={viewMode === "type" ? "Switch to hierarchical view" : "Switch to type view"}
          >
            <Network className="w-3 h-3" />
            <span>Hierarchy</span>
          </button>
        </div>

        {/* Stats */}
        {hasJoints && (
          <div className="text-[10px] text-muted-foreground px-1">
            {filteredJoints.length} of {Object.keys(jointLimits).length} joints
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* Joints List */}
      <div className="flex-1 p-2 px-3">
        {!hasJoints ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No joints loaded
          </div>
        ) : filteredJoints.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No joints found
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        ) : viewMode === "hierarchy" ? (
          <div className="space-y-0.5">
            {filteredOrderedJoints.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No joints found in hierarchy
                {searchQuery && ` matching "${searchQuery}"`}
              </div>
            ) : (
              renderFlatHierarchy()
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(jointsByType).map(([type, joints]) => {
              const isExpanded = expandedTypes.has(type);
              const typeCount = joints.length;
              
              return (
                <div key={type} className="border border-border/20 rounded-sm bg-muted/10">
                  <button
                    onClick={() => toggleTypeExpansion(type)}
                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      )}
                      <span className="text-xs font-semibold text-foreground capitalize">
                        {type}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        ({typeCount})
                      </span>
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="border-t border-border/20 divide-y divide-border/10">
                      {joints.map((jointName, index) => (
                        <div key={jointName} className={cn(
                          "bg-background/50",
                          index === 0 && "border-t-0"
                        )}>
                          <JointControl
                            jointName={jointName}
                            jointInfo={jointLimits[jointName]}
                            jointAxis={jointAxes[jointName]}
                            originalAxis={originalJointAxes?.[jointName]}
                            currentValue={storeJointValues[jointName] ?? 0}
                            onValueChange={(value) => {
                              onJointChange(jointName, value);
                              onJointSelect?.(jointName);
                            }}
                            onTypeChange={(newType, lowerLimit, upperLimit) => {
                              onJointTypeChange?.(jointName, newType, lowerLimit, upperLimit);
                            }}
                            onNameChange={onJointNameChange}
                            onAxisChange={onJointAxisChange}
                            onResetAxis={onResetAxis}
                            onDeleteJoint={onDeleteJoint}
                            isDeleted={deletedJoints.has(jointName)}
                            angleUnit={angleUnit}
                            onHover={onJointSelect}
                            urdfContent={urdfContent}
                            isHighlighted={selectedJoint === jointName}
                            onLinkChange={onJointLinkChange}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

