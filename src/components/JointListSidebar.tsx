import React, { useState, useMemo, useEffect } from "react";
import { JointListItem } from "@/components/JointListItem";
import { JointControl } from "@/components/JointControl";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, Box, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";
import type { JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { useJointStore } from "@/store/useJointStore";
import { useObjectStore } from "@/store/useObjectStore";
import { useCameraStore } from "@/store/useCameraStore";
import { parseJointHierarchy, type JointHierarchyNode } from "@/urdf_corrections/parseJointHierarchy";
import { parseLinkData, type LinkData } from "@/urdf_corrections/parseLinkData";
import { LinkControl } from "@/components/LinkEditor";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { CameraList } from "@/components/CameraList";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import * as THREE from "three";

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
  colorJointNames: string[];
  visibleJoints: Set<string>;
  onVisibilityToggle: (jointName: string) => void;
  endEffectorLink?: string | null;
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
  colorJointNames,
  visibleJoints,
  onVisibilityToggle,
  endEffectorLink,
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

    const isSelected = selectedLink === linkName;
    const linkColor = "#4a9eff"; // Blue color for links

    // Helper to convert hex to rgba
    const hexToRgba = (hex: string, alpha: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    try {
      const joints = hierarchyTree.linkToJoints.get(linkName) || [];
      if (joints.length === 0) {
        // Leaf link - just show the link
        return (
          <div key={`link-${linkName}-${depth}`} className="relative" style={{ paddingLeft: `${depth * 12}px` }}>
            <div
              className={cn(
                "px-1.5 py-0.5 cursor-pointer hover:bg-muted/20 rounded transition-colors",
                isSelected && "hover:bg-muted/30"
              )}
              style={
                isSelected
                  ? {
                      backgroundColor: hexToRgba(linkColor, 0.15),
                    }
                  : undefined
              }
              onClick={() => {
                onLinkSelect?.(linkName);
                onJointSelect?.(null); // Clear joint selection when selecting link
              }}
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-[10px] flex-1",
                    isSelected ? "" : "text-muted-foreground/60"
                  )}
                  style={
                    isSelected
                      ? { color: linkColor }
                      : undefined
                  }
                >
                  🔗 {linkName}
                </span>
                {endEffectorLink === linkName && (
                  <span className="text-[7px] px-0.5 py-0 bg-primary/20 text-primary rounded font-medium">
                    EE
                  </span>
                )}
              </div>
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
                isSelected && "hover:bg-muted/30"
              )}
              style={
                isSelected
                  ? {
                      backgroundColor: hexToRgba(linkColor, 0.15),
                    }
                  : undefined
              }
              onClick={() => {
                onLinkSelect?.(linkName);
                onJointSelect?.(null); // Clear joint selection when selecting link
              }}
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-[10px] flex-1",
                    isSelected ? "" : "text-muted-foreground/60"
                  )}
                  style={
                    isSelected
                      ? { color: linkColor }
                      : undefined
                  }
                >
                  🔗 {linkName}
                </span>
                {endEffectorLink === linkName && (
                  <span className="text-[7px] px-0.5 py-0 bg-primary/20 text-primary rounded font-medium">
                    EE
                  </span>
                )}
              </div>
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
                    colorJointNames={colorJointNames}
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
const POINT_SIZE = 0.02;

// Object Editor Panel
interface ObjectEditorPanelProps {
  objectId: string;
  availableLinks: string[];
  robot?: any;
  endEffectorLink?: string | null;
}

const ObjectEditorPanel = ({ objectId, availableLinks, robot, endEffectorLink }: ObjectEditorPanelProps) => {
  const objects = useObjectStore((state) => state.objects);
  const updateObjectPosition = useObjectStore((state) => state.updateObjectPosition);
  const updateObjectSize = useObjectStore((state) => state.updateObjectSize);
  const updateTrackedJoint = useObjectStore((state) => state.updateTrackedJoint);
  const updateObjectIkTarget = useObjectStore((state) => state.updateObjectIkTarget);
  const updateIkTargetType = useObjectStore((state) => state.updateIkTargetType);
  const updateOrbitParams = useObjectStore((state) => state.updateOrbitParams);
  const removeObject = useObjectStore((state) => state.removeObject);

  const obj = objects.find((o) => o.id === objectId);
  if (!obj) return null;

  const isPoint = obj.type === "point";

  // Get world position of joint from the robot THREE.js object
  const getJointWorldPosition = (jointName: string): THREE.Vector3 | null => {
    if (!robot || !jointName) return null;
    try {
      const joint = robot.joints?.[jointName];
      if (!joint) return null;
      const worldPosition = new THREE.Vector3();
      joint.getWorldPosition(worldPosition);
      return worldPosition;
    } catch (error) {
      return null;
    }
  };

  const getLinkWorldPosition = (linkName: string): THREE.Vector3 | null => {
    if (!robot || !linkName) return null;
    try {
      const link =
        robot.links?.[linkName] ??
        robot.getObjectByName?.(linkName) ??
        robot.getObjectByName?.(decodeURIComponent(linkName));
      if (!link) return null;
      link.updateMatrixWorld(true);
      const pos = new THREE.Vector3();
      link.getWorldPosition(pos);
      return pos;
    } catch (error) {
      return null;
    }
  };

  const effectiveTargetName = obj.trackedJointName ?? endEffectorLink ?? null;
  const trackedJointPos = effectiveTargetName
    ? getJointWorldPosition(effectiveTargetName) ?? getLinkWorldPosition(effectiveTargetName)
    : null;
  const distance = trackedJointPos ? obj.position.distanceTo(trackedJointPos) : null;

  return (
    <div className="p-1" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <BlenderPanel title={null} alwaysExpanded={true}>
        <div className="space-y-1.5">
          <BlenderPropertyRow label="Type">
            <span className="text-[10px] text-[#d4d4d4]">{obj.type.charAt(0).toUpperCase() + obj.type.slice(1)}</span>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position X">
            <NumberInput
              value={obj.position.x}
              onValueChange={(val) => {
                const newPos = obj.position.clone();
                newPos.x = val;
                updateObjectPosition(obj.id, newPos);
              }}
              step={0.01}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position Y">
            <NumberInput
              value={obj.position.y}
              onValueChange={(val) => {
                const newPos = obj.position.clone();
                newPos.y = val;
                updateObjectPosition(obj.id, newPos);
              }}
              step={0.01}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position Z">
            <NumberInput
              value={obj.position.z}
              onValueChange={(val) => {
                const newPos = obj.position.clone();
                newPos.z = val;
                updateObjectPosition(obj.id, newPos);
              }}
              step={0.01}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          {isPoint ? (
            <BlenderPropertyRow label="Size">
              <span className="text-[10px] text-[#d4d4d4]">Fixed at {POINT_SIZE} m</span>
            </BlenderPropertyRow>
          ) : (
            <>
              <BlenderPropertyRow label="Size X">
                <NumberInput
                  value={obj.size.x}
                  onValueChange={(val) => {
                    const newSize = obj.size.clone();
                    newSize.x = val;
                    updateObjectSize(obj.id, newSize);
                  }}
                  step={0.01}
                  min={0.01}
                  compact
                  className="w-20"
                />
              </BlenderPropertyRow>

              <BlenderPropertyRow label="Size Y">
                <NumberInput
                  value={obj.size.y}
                  onValueChange={(val) => {
                    const newSize = obj.size.clone();
                    newSize.y = val;
                    updateObjectSize(obj.id, newSize);
                  }}
                  step={0.01}
                  min={0.01}
                  compact
                  className="w-20"
                />
              </BlenderPropertyRow>

              <BlenderPropertyRow label="Size Z">
                <NumberInput
                  value={obj.size.z}
                  onValueChange={(val) => {
                    const newSize = obj.size.clone();
                    newSize.z = val;
                    updateObjectSize(obj.id, newSize);
                  }}
                  step={0.01}
                  min={0.01}
                  compact
                  className="w-20"
                />
              </BlenderPropertyRow>
            </>
          )}

          <BlenderPropertyRow label="Track Link">
            <Select
              value={
                obj.trackedJointName
                  ? obj.trackedJointName
                  : endEffectorLink
                    ? "__end_effector__"
                    : "none"
              }
              onValueChange={(value) => {
                if (value === "none") {
                  updateTrackedJoint(obj.id, null);
                } else if (value === "__end_effector__") {
                  updateTrackedJoint(obj.id, null); // default to end-effector
                } else {
                  updateTrackedJoint(obj.id, value);
                }
              }}
            >
              <SelectTrigger className="h-6 text-[10px] bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                {endEffectorLink && (
                  <SelectItem value="__end_effector__" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                    Use end-effector ({endEffectorLink})
                  </SelectItem>
                )}
                <SelectItem value="none" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                  None
                </SelectItem>
                {availableLinks.map((link) => (
                  <SelectItem key={link} value={link} className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                    {link}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BlenderPropertyRow>

          {obj.trackedJointName && distance !== null && (
            <BlenderPropertyRow label="Distance">
              <span className="text-[10px] text-[#d4d4d4] font-mono">{distance.toFixed(4)} m</span>
            </BlenderPropertyRow>
          )}

          <BlenderPropertyRow label="IK Target">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={obj.isIkTarget}
                onChange={(e) => updateObjectIkTarget(obj.id, e.target.checked)}
                className="h-3.5 w-3.5 accent-[#3d3d3d] bg-[#1e1e1e] border-[#3d3d3d]"
              />
              <span className="text-[10px] text-[#d4d4d4]">
                Click object in viewer to solve IK
              </span>
            </div>
          </BlenderPropertyRow>

          {obj.isIkTarget && (
            <>
              <BlenderPropertyRow label="IK Mode">
                <Select
                  value={obj.ikTargetType ?? "punctual"}
                  onValueChange={(value: "punctual" | "orbit") => updateIkTargetType(obj.id, value)}
                >
                  <SelectTrigger className="h-6 text-[10px] bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                    <SelectItem value="punctual" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                      Punctual
                    </SelectItem>
                    <SelectItem value="orbit" className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                      Orbit
                    </SelectItem>
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>

              {obj.ikTargetType === "orbit" && (
                <>
                  <BlenderPropertyRow label="Orbit Radius">
                    <NumberInput
                      value={obj.orbitRadius ?? 0.3}
                      onValueChange={(val) => updateOrbitParams(obj.id, { radius: val })}
                      step={0.01}
                      min={0.01}
                      compact
                      className="w-20"
                    />
                  </BlenderPropertyRow>

                  <BlenderPropertyRow label="Inclination">
                    <NumberInput
                      value={obj.orbitInclination ?? 45}
                      onValueChange={(val) => updateOrbitParams(obj.id, { inclination: val })}
                      step={5}
                      min={-90}
                      max={90}
                      compact
                      className="w-20"
                    />
                  </BlenderPropertyRow>

                  <BlenderPropertyRow label="Orbit Phase">
                    <NumberInput
                      value={obj.orbitPhase ?? 0}
                      onValueChange={(val) => updateOrbitParams(obj.id, { phase: val % 360 })}
                      step={15}
                      min={0}
                      max={360}
                      compact
                      className="w-20"
                    />
                  </BlenderPropertyRow>
                </>
              )}
            </>
          )}

          <div className="pt-1 border-t border-[#3d3d3d]">
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeObject(obj.id)}
              className="h-6 text-[10px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#3d3d3d] w-full"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </BlenderPanel>
    </div>
  );
};

// Camera Editor Panel
interface CameraEditorPanelProps {
  cameraId: string;
  availableLinks: string[];
}

const CameraEditorPanel = ({ cameraId, availableLinks }: CameraEditorPanelProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const updateCamera = useCameraStore((state) => state.updateCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);

  const camera = cameras.find((c) => c.id === cameraId);
  if (!camera) return null;

  const radToDeg = (rad: number) => (rad * 180) / Math.PI;
  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  return (
    <div className="p-1" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <BlenderPanel title={null} alwaysExpanded={true}>
        <div className="space-y-1.5">
          <BlenderPropertyRow label="Name">
            <span className="text-[10px] text-[#d4d4d4]">{camera.name}</span>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Parent Link">
            <Select
              value={camera.parent_link}
              onValueChange={(value) => {
                updateCamera(camera.id, { parent_link: value });
              }}
            >
              <SelectTrigger className="h-6 text-[10px] bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                {availableLinks.map((link) => (
                  <SelectItem key={link} value={link} className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                    {link}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position X">
            <NumberInput
              value={camera.pose.xyz[0]}
              onValueChange={(val) => {
                const newXyz: [number, number, number] = [val, camera.pose.xyz[1], camera.pose.xyz[2]];
                updateCamera(camera.id, { pose: { ...camera.pose, xyz: newXyz } });
              }}
              step={0.01}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position Y">
            <NumberInput
              value={camera.pose.xyz[1]}
              onValueChange={(val) => {
                const newXyz: [number, number, number] = [camera.pose.xyz[0], val, camera.pose.xyz[2]];
                updateCamera(camera.id, { pose: { ...camera.pose, xyz: newXyz } });
              }}
              step={0.01}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Position Z">
            <NumberInput
              value={camera.pose.xyz[2]}
              onValueChange={(val) => {
                const newXyz: [number, number, number] = [camera.pose.xyz[0], camera.pose.xyz[1], val];
                updateCamera(camera.id, { pose: { ...camera.pose, xyz: newXyz } });
              }}
              step={0.01}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Roll">
            <NumberInput
              value={radToDeg(camera.pose.rpy[0])}
              onValueChange={(val) => {
                const newRpy: [number, number, number] = [degToRad(val), camera.pose.rpy[1], camera.pose.rpy[2]];
                updateCamera(camera.id, { pose: { ...camera.pose, rpy: newRpy } });
              }}
              step={1}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Pitch">
            <NumberInput
              value={radToDeg(camera.pose.rpy[1])}
              onValueChange={(val) => {
                const newRpy: [number, number, number] = [camera.pose.rpy[0], degToRad(val), camera.pose.rpy[2]];
                updateCamera(camera.id, { pose: { ...camera.pose, rpy: newRpy } });
              }}
              step={1}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Yaw">
            <NumberInput
              value={radToDeg(camera.pose.rpy[2])}
              onValueChange={(val) => {
                const newRpy: [number, number, number] = [camera.pose.rpy[0], camera.pose.rpy[1], degToRad(val)];
                updateCamera(camera.id, { pose: { ...camera.pose, rpy: newRpy } });
              }}
              step={1}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Width">
            <NumberInput
              value={camera.intrinsics.width}
              onValueChange={(val) => {
                updateCamera(camera.id, {
                  intrinsics: { ...camera.intrinsics, width: Math.round(val) },
                });
              }}
              step={1}
              min={1}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Height">
            <NumberInput
              value={camera.intrinsics.height}
              onValueChange={(val) => {
                updateCamera(camera.id, {
                  intrinsics: { ...camera.intrinsics, height: Math.round(val) },
                });
              }}
              step={1}
              min={1}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <BlenderPropertyRow label="FOV">
            <NumberInput
              value={camera.intrinsics.fov_deg}
              onValueChange={(val) => {
                updateCamera(camera.id, {
                  intrinsics: { ...camera.intrinsics, fov_deg: val },
                });
              }}
              step={1}
              min={1}
              max={179}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>

          <div className="pt-1 border-t border-[#3d3d3d]">
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeCamera(camera.id)}
              className="h-6 text-[10px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#3d3d3d] w-full"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </BlenderPanel>
    </div>
  );
};

// Component for Elements view (Objects and Cameras)
interface ElementsViewProps {
  selectedJoint?: string | null;
  urdfContent?: string;
  availableJoints: string[];
  availableLinks?: string[];
  robot?: any;
  onCameraSelect?: (cameraId: string) => void;
  onJointSelect?: (jointName: string | null) => void;
  setSelectedLink?: (linkName: string | null) => void;
}

const ElementsView = ({ selectedJoint, urdfContent, availableJoints, availableLinks, robot, onCameraSelect, onJointSelect, setSelectedLink }: ElementsViewProps) => {
  const objects = useObjectStore((state) => state.objects);
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);
  const removeObject = useObjectStore((state) => state.removeObject);
  
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);

  const hasElements = objects.length > 0 || cameras.length > 0;

  if (!hasElements) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        No elements created yet.
        <br />
        {"Use Create -> Objects -> Cube/Point or Create -> Camera to add elements."}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Objects */}
      {objects.map((obj) => {
        const isSelected = obj.id === selectedObjectId;

        return (
          <div
            key={obj.id}
            className={cn(
              "px-2 py-1.5 border border-[#3d3d3d] rounded-sm transition-colors cursor-pointer",
              isSelected
                ? "bg-[#2a2a2a] border-[#4d4d4d]"
                : "bg-[#1e1e1e] hover:bg-[#252525] hover:border-[#4d4d4d]"
            )}
            onClick={() => {
              setSelectedObject(obj.id);
              onJointSelect?.(null);
              setSelectedLink(null);
              useCameraStore.getState().selectCamera(null);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Box className="h-3 w-3 text-[#9d9d9d]" />
                <span className="text-[11px] font-normal text-[#d4d4d4]">
                  {obj.type.charAt(0).toUpperCase() + obj.type.slice(1)} {obj.id.split("-")[1]}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeObject(obj.id);
                }}
                className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
      
      {/* Cameras */}
      {cameras.map((camera) => {
        const isSelected = camera.id === selectedCameraId;

        return (
          <div
            key={camera.id}
            className={cn(
              "px-2 py-1.5 border border-[#3d3d3d] rounded-sm transition-colors cursor-pointer",
              isSelected
                ? "bg-[#2a2a2a] border-[#4d4d4d]"
                : "bg-[#1e1e1e] hover:bg-[#252525] hover:border-[#4d4d4d]"
            )}
            onClick={() => {
              selectCamera(camera.id);
              onCameraSelect?.(camera.id);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Video className="h-3 w-3 text-[#9d9d9d]" />
                <span className="text-[11px] font-normal text-[#d4d4d4] truncate">
                  {camera.name}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeCamera(camera.id);
                }}
                className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface JointListSidebarProps {
  availableJoints: string[];
  availableLinks?: string[];
  jointLimits: JointLimits;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  onJointSelect?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
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
  robot?: any;
  episodeJointNames?: string[];
  endEffectorLink?: string | null;
  onMarkAsEndEffector?: (linkName: string | null) => void;
}

export const JointListSidebar = ({
  availableJoints,
  episodeJointNames = [],
  availableLinks = [],
  jointLimits,
  selectedJoint,
  selectedLink: selectedLinkProp,
  onJointSelect,
  onLinkSelect,
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
  robot,
  endEffectorLink,
  onMarkAsEndEffector,
}: JointListSidebarProps) => {
  const jointValues = useJointStore((s) => s.jointValues);

  // Use prop if provided, otherwise default to "rad"
  const angleUnit = angleUnitProp ?? "rad";
  const onAngleUnitChange = onAngleUnitChangeProp ?? (() => {});

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"links" | "flat" | "hierarchy" | "elements">("flat");

  // Use selectedLink from props instead of local state
  const selectedLink = selectedLinkProp ?? null;
  const setSelectedLink = (linkName: string | null) => {
    onLinkSelect?.(linkName);
  };

  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
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

  const colorJointNames = useMemo(() => {
    if (episodeJointNames && episodeJointNames.length > 0) {
      return episodeJointNames;
    }
    return availableJoints;
  }, [episodeJointNames, availableJoints]);

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
              <button
                onClick={() => setViewMode("elements")}
                className={cn(
                  "text-xs font-medium transition-colors",
                  viewMode === "elements"
                    ? "text-primary cursor-default"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
              >
                Elements
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
                  {filteredLinks.map((linkName) => {
                    const isSelected = selectedLink === linkName;
                    const linkColor = "#4a9eff"; // Blue color for links

                    // Helper to convert hex to rgba
                    const hexToRgba = (hex: string, alpha: number) => {
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                    };

                    return (
                      <div
                        key={linkName}
                        className={cn(
                          "px-1.5 py-1.5 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/10",
                          isSelected && "hover:bg-muted/30"
                        )}
                        style={
                          isSelected
                            ? {
                                backgroundColor: hexToRgba(linkColor, 0.15),
                              }
                            : undefined
                        }
                        onClick={() => {
                          setSelectedLink(linkName);
                          onJointSelect?.(null);
                          useObjectStore.getState().setSelectedObject(null);
                          useCameraStore.getState().selectCamera(null);
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground/60">🔗</span>
                          <span
                            className={cn(
                              "text-xs font-medium flex-1",
                              isSelected ? "" : "text-foreground"
                            )}
                            style={
                              isSelected
                                ? { color: linkColor }
                                : undefined
                            }
                          >
                            {linkName}
                          </span>
                          {endEffectorLink === linkName && (
                            <span className="text-[8px] px-1 py-0.5 bg-primary/20 text-primary rounded font-medium">
                              EE
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                        setSelectedLink(null);
                        useObjectStore.getState().setSelectedObject(null);
                        useCameraStore.getState().selectCamera(null);
                      }}
                      onHover={onJointHover}
                      availableJoints={availableJoints}
                      colorJointNames={colorJointNames}
                      isVisible={visibleJoints.has(jointName)}
                      onVisibilityToggle={handleVisibilityToggle}
                    />
                  ))}
                </div>
              )
            ) : viewMode === "elements" ? (
              // Elements view (Objects and Cameras)
              <ElementsView
                selectedJoint={selectedJoint}
                urdfContent={urdfContent}
                availableJoints={availableJoints}
                availableLinks={availableLinks}
                robot={robot}
                onCameraSelect={() => {
                  onJointSelect?.(null);
                  setSelectedLink(null);
                  useObjectStore.getState().setSelectedObject(null);
                }}
                onJointSelect={onJointSelect}
                setSelectedLink={setSelectedLink}
              />
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
                    onJointSelect?.(null);
                    useObjectStore.getState().setSelectedObject(null);
                    useCameraStore.getState().selectCamera(null);
                  }}
                  selectedLink={selectedLink}
                  availableJoints={availableJoints}
                  colorJointNames={colorJointNames}
                  visibleJoints={visibleJoints}
                  onVisibilityToggle={handleVisibilityToggle}
                  endEffectorLink={endEffectorLink}
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
                {selectedJoint ? `Joint Editor (${selectedJoint})` : selectedLink ? `Link Editor (${selectedLink})` : selectedObjectId ? `Object Editor` : selectedCameraId ? `Camera Editor` : "No Selection"}
              </span>
              {(selectedJoint || selectedLink || selectedObjectId || selectedCameraId) && (
                <button
                  onClick={() => {
                    onJointSelect?.(null);
                    setSelectedLink(null);
                    useObjectStore.getState().setSelectedObject(null);
                    useCameraStore.getState().selectCamera(null);
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
                  endEffectorLink={endEffectorLink}
                  onMarkAsEndEffector={onMarkAsEndEffector}
                />
              </div>
            ) : selectedObjectId ? (
              <ObjectEditorPanel
                objectId={selectedObjectId}
                availableLinks={availableLinks || []}
                robot={robot}
                endEffectorLink={endEffectorLink}
              />
            ) : selectedCameraId ? (
              <CameraEditorPanel
                cameraId={selectedCameraId}
                availableLinks={availableLinks || []}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50 p-4 text-center">
                Select a joint, link, object, or camera to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

