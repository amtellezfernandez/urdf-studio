import { useState, useMemo, useEffect, useRef } from "react";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { BlenderPanel } from "@/components/ui/blender-panel";
import { JointControl } from "@/components/JointControl";
import { Search, X, ChevronDown, ChevronRight, Network, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointAxisMap, JointLimits } from "@/features/urdf";
import { parseJointHierarchy, type JointHierarchyNode } from "@/features/urdf";
import { RAD_TO_DEG } from "@/lib/angleConversions";

interface JointsWindowProps {
  availableJoints: string[];
  jointLimits: JointLimits;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  storeJointValues: Record<string, number>;
  onJointChange: (jointName: string, value: number) => void;
  onJointSelect?: (jointName: string | null) => void;
  selectedJoint?: string | null;
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
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  rotationPlaneVisible?: boolean;
  onRotationPlaneVisibilityChange?: (visible: boolean) => void;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointNameChange?: (oldName: string, newName: string) => void;
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
  onJointLinkChange,
  rotationPlaneVisible = false,
  onRotationPlaneVisibilityChange,
  onJointTypeChange,
  onJointNameChange,
}: JointsWindowProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(["revolute", "continuous"]));
  const [viewMode, setViewMode] = useState<"type" | "hierarchy">("type");
  const lastJointTypesRef = useRef<Record<string, string>>({});
  const [editingJointName, setEditingJointName] = useState<string | null>(null);
  const [editedName, setEditedName] = useState<string>("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Get all unique joint types
  const jointTypes = useMemo(() => {
    const types = new Set<string>();
    Object.values(jointLimits).forEach(j => {
      if (j?.type) types.add(j.type);
    });
    return Array.from(types).sort();
  }, [jointLimits]);

  // Initialize ref with current joint types on mount and when jointLimits changes
  useEffect(() => {
    const currentJointTypes: Record<string, string> = {};
    Object.entries(jointLimits).forEach(([jointName, jointInfo]) => {
      if (jointInfo?.type) {
        currentJointTypes[jointName] = jointInfo.type;
      }
    });

    // Find joints that changed type (compare with previous ref value)
    const typeChanges: string[] = [];
    Object.entries(currentJointTypes).forEach(([jointName, newType]) => {
      const oldType = lastJointTypesRef.current[jointName];
      if (oldType !== undefined && oldType !== newType) {
        // Joint changed type - expand the new type group so it's visible
        typeChanges.push(newType);
      }
    });

    // Update the ref with current types AFTER detecting changes
    lastJointTypesRef.current = currentJointTypes;

    // Expand new type categories if any joints changed type
    if (typeChanges.length > 0 && viewMode === "type") {
      setExpandedTypes(prev => {
        const next = new Set(prev);
        typeChanges.forEach(type => next.add(type));
        return next;
      });
    }
  }, [jointLimits, viewMode]);

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
      // Use type from jointLimits if available (updates immediately), fallback to hierarchy type
      const jointType = jointLimits[joint.jointName]?.type || joint.type;
      const matchesType = typeFilter === "all" || jointType === typeFilter;
      const matchesSearch = !searchQuery.trim() || joint.jointName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [jointHierarchy, typeFilter, searchQuery, jointLimits]);

  // Render folder-style flat hierarchy
  const renderFlatHierarchy = (): React.ReactNode => {
    if (!jointHierarchy) return null;
    
    return filteredOrderedJoints.map((joint) => {
      const depth = joint.depth ?? 0;
      
      return (
        <div 
          key={`${joint.jointName}-${jointLimits[joint.jointName]?.type || 'unknown'}`}
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
            onAxisChange={onJointAxisChange}
            onResetAxis={onResetAxis}
            onDeleteJoint={onDeleteJoint}
            isDeleted={deletedJoints.has(joint.jointName)}
            angleUnit={angleUnit}
            onHover={onJointSelect}
            urdfContent={urdfContent}
            isHighlighted={selectedJoint === joint.jointName}
            onLinkChange={onJointLinkChange}
            onTypeChange={onJointTypeChange ? (newType, lowerLimit, upperLimit) => {
              onJointTypeChange(joint.jointName, newType, lowerLimit, upperLimit);
            } : undefined}
            onNameChange={onJointNameChange}
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

  // Handle name editing
  const handleNameDoubleClick = (e: React.MouseEvent, jointName: string) => {
    if (!onJointNameChange) return;
    e.stopPropagation();
    setEditingJointName(jointName);
    setEditedName(jointName);
  };

  const handleNameSubmit = (jointName: string) => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== jointName && onJointNameChange) {
      onJointNameChange(jointName, trimmedName);
    }
    setEditingJointName(null);
  };

  const handleNameCancel = () => {
    setEditingJointName(null);
    setEditedName("");
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, jointName: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSubmit(jointName);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleNameCancel();
    }
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingJointName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingJointName]);

  // Render simple joint list item (clickable, no expandable controls)
  const renderSimpleJointItem = (jointName: string, depth: number = 0) => {
    const jointInfo = jointLimits[jointName];
    const currentValue = storeJointValues[jointName] ?? 0;
    const isSelected = selectedJoint === jointName;
    const isDeleted = deletedJoints.has(jointName);
    const isEditing = editingJointName === jointName;
    const valueDisplay = angleUnit === "deg" 
      ? `${(currentValue * RAD_TO_DEG).toFixed(2)}°`
      : `${currentValue.toFixed(2)}`;

    return (
      <div
        key={jointName}
        className={cn(
          "px-1.5 py-1.5 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/10",
          isSelected && "bg-primary/10 border-primary/30",
          isDeleted && "opacity-50"
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={() => !isEditing && onJointSelect?.(jointName)}
        onMouseEnter={() => !isEditing && onJointSelect?.(jointName)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={nameInputRef}
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={() => handleNameSubmit(jointName)}
                onKeyDown={(e) => handleNameKeyDown(e, jointName)}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "text-xs font-medium flex-1 min-w-0 text-left bg-background border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary",
                  isDeleted
                    ? "text-muted-foreground/50"
                    : isSelected
                      ? "text-primary"
                      : "text-foreground"
                )}
              />
            ) : (
              <span
                className={cn(
                  "text-xs font-medium truncate cursor-text",
                  isSelected ? "text-primary" : "text-foreground",
                  isDeleted && "text-muted-foreground/50",
                  onJointNameChange && "hover:text-primary/80"
                )}
                title={isDeleted ? "Will be deleted in exported URDF" : onJointNameChange ? "Double-click to rename" : undefined}
                onDoubleClick={(e) => handleNameDoubleClick(e, jointName)}
              >
                {jointName}
              </span>
            )}
            {isDeleted && !isEditing && (
              <span className="text-[9px] text-muted-foreground/70">(deleted)</span>
            )}
          </div>
          {!isEditing && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
              {valueDisplay}
            </span>
          )}
        </div>
      </div>
    );
  };

  // Render simple list for hierarchy view
  const renderSimpleHierarchy = (): React.ReactNode => {
    if (!jointHierarchy) return null;
    
    return filteredOrderedJoints.map((joint) => {
      const depth = joint.depth ?? 0;
      return renderSimpleJointItem(joint.jointName, depth);
    });
  };

  return (
    <div className="flex flex-col w-full h-full">

      {/* Global Motion Limits - Minimalistic */}
      {(onVelocityLimitEnabledChange || onRotationPlaneVisibilityChange) && (
        <div className="flex flex-col gap-1 px-2 py-1 text-xs border-b border-border/20 bg-muted/5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground flex-shrink-0">Motion</span>
            {onVelocityLimitEnabledChange && (
              <Switch
                checked={velocityLimitEnabled}
                onCheckedChange={onVelocityLimitEnabledChange}
                className="h-4 w-7 flex-shrink-0 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
              />
            )}
            {velocityLimitEnabled && fromDisplayVelocity && onGlobalMaxJointVelocityChange && (
              <>
                <div className="flex-1 min-w-0 px-1.5">
                  <Slider
                    value={[sliderValue]}
                    min={sliderMin}
                    max={sliderMax}
                    step={sliderStep}
                    onValueChange={([value]) => onGlobalMaxJointVelocityChange(fromDisplayVelocity(value))}
                    className="h-1.5"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground min-w-[55px] text-right flex-shrink-0">
                  {sliderValue.toFixed(angleUnit === "deg" ? 1 : 2)} {angleUnit === "deg" ? "°/s" : "rad/s"}
                </span>
                {applyGlobalVelocityToAll && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[10px] flex-shrink-0"
                    onClick={applyGlobalVelocityToAll}
                  >
                    Apply
                  </Button>
                )}
              </>
            )}
          </div>
          {/* Rotation Planes Toggle */}
          {onRotationPlaneVisibilityChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground flex-shrink-0">Planes</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => onRotationPlaneVisibilityChange(!rotationPlaneVisible)}
                title={rotationPlaneVisible ? "Hide rotation planes" : "Show rotation planes"}
              >
                {rotationPlaneVisible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Header Controls - Minimalistic */}
      <div className="flex-shrink-0 space-y-1.5 px-2 py-1.5 border-b border-border/20">
        {/* Search Bar - Minimalistic */}
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 pr-8 text-xs bg-input/50 border-border/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center hover:bg-muted/50 rounded"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filters Row - Minimalistic */}
        <div className="flex items-center gap-1.5">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 text-xs w-32 border-border/50">
              <SelectValue />
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

          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/20 rounded border border-border/30">
            <span className="text-[10px] text-muted-foreground min-w-[24px]">rad</span>
            <Switch
              checked={angleUnit === "deg"}
              onCheckedChange={(checked) => onAngleUnitChange(checked ? "deg" : "rad")}
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
            />
            <span className="text-[10px] text-muted-foreground min-w-[24px]">deg</span>
          </div>

          <button
            onClick={() => setViewMode(viewMode === "type" ? "hierarchy" : "type")}
            className={cn(
              "h-7 px-1.5 flex items-center gap-1 text-xs rounded border transition-colors",
              viewMode === "hierarchy"
                ? "bg-primary/15 border-primary/50 text-primary"
                : "bg-muted/20 border-border/30 text-foreground hover:bg-muted/30"
            )}
            title={viewMode === "type" ? "Switch to hierarchical view" : "Switch to type view"}
          >
            <Network className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Stats - Minimalistic */}
        {hasJoints && (
          <div className="text-[10px] text-muted-foreground/70 px-0.5">
            {filteredJoints.length} of {Object.keys(jointLimits).length}
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* Joints List - Simple clickable list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 px-2">
        {!hasJoints ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
            No joints loaded
          </div>
        ) : filteredJoints.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
            No joints found
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        ) : viewMode === "hierarchy" ? (
          <div>
            {filteredOrderedJoints.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
                No joints found in hierarchy
                {searchQuery && ` matching "${searchQuery}"`}
              </div>
            ) : (
              renderSimpleHierarchy()
            )}
          </div>
        ) : (
          <div>
            {Object.entries(jointsByType).map(([type, joints]) => {
              const isExpanded = expandedTypes.has(type);
              const typeCount = joints.length;
              
              return (
                <div key={type} className="border border-border/15 rounded-sm bg-muted/5 mb-1">
                  <button
                    onClick={() => toggleTypeExpansion(type)}
                    className="w-full flex items-center justify-between px-1.5 py-1 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground/70" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground/70" />
                      )}
                      <span className="text-xs font-medium text-foreground capitalize">
                        {type}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        ({typeCount})
                      </span>
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="border-t border-border/15">
                      {joints.map((jointName) => (
                        renderSimpleJointItem(jointName)
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Joint Editor Panel - Always visible */}
      <div className="flex-shrink-0 border-t border-border/20 bg-muted/5">
        <div className="p-2 max-h-[50vh] overflow-y-auto minimal-scrollbar">
          {selectedJoint && jointLimits[selectedJoint] ? (
            <JointControl
              jointName={selectedJoint}
              jointInfo={jointLimits[selectedJoint]}
              jointAxis={jointAxes[selectedJoint]}
              originalAxis={originalJointAxes?.[selectedJoint]}
              currentValue={storeJointValues[selectedJoint] ?? 0}
              onValueChange={(value) => {
                onJointChange(selectedJoint, value);
              }}
              onAxisChange={onJointAxisChange}
              onResetAxis={onResetAxis}
              onDeleteJoint={onDeleteJoint}
              isDeleted={deletedJoints.has(selectedJoint)}
              angleUnit={angleUnit}
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
          ) : (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/70">
              Click on a joint to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
