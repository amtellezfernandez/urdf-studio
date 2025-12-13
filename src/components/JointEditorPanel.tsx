import { useState, useEffect, useCallback, useMemo } from "react";
import { CustomSlider } from "@/components/ui/custom-slider";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { JointAxisInfo, JointLimitInfo } from "@/features/urdf";
import { useJointStore } from "@/store/useJointStore";
import { getJointLinks } from "@/features/urdf";
import { JOINT_TYPES, AXIS_PRESETS } from "@/constants/jointConstants";
import { DEG_TO_RAD, RAD_TO_DEG } from "@/lib/angleConversions";

interface JointEditorPanelProps {
  jointName: string | null;
  jointInfo?: JointLimitInfo;
  jointAxis?: JointAxisInfo;
  currentValue: number;
  onValueChange: (value: number) => void;
  onAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis?: (jointName: string) => void;
  originalAxis?: JointAxisInfo;
  angleUnit?: "rad" | "deg";
  onDeleteJoint?: (jointName: string) => void;
  isDeleted?: boolean;
  urdfContent?: string;
  onLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  onTypeChange?: (newType: string, lowerLimit?: number, upperLimit?: number) => void;
  onClose?: () => void;
  robot?: any; // Three.js robot object for getting link coordinates
}

export const JointEditorPanel = ({
  jointName,
  jointInfo,
  jointAxis,
  currentValue,
  onValueChange,
  onAxisChange,
  onResetAxis,
  originalAxis,
  angleUnit = "rad",
  onDeleteJoint,
  isDeleted = false,
  urdfContent,
  onLinkChange,
  onTypeChange,
  onClose,
  robot,
}: JointEditorPanelProps) => {
  const currentType = jointInfo?.type || "continuous";
  const hasLowerLimit = jointInfo?.lower !== null && jointInfo?.lower !== undefined;
  const hasUpperLimit = jointInfo?.upper !== null && jointInfo?.upper !== undefined;
  const fallbackRange = Math.PI * 4;
  const min = hasLowerLimit && jointInfo ? jointInfo.lower ?? -fallbackRange : -fallbackRange;
  const max = hasUpperLimit && jointInfo ? jointInfo.upper ?? fallbackRange : fallbackRange;

  const needsLimits = currentType === "revolute" || currentType === "prismatic";
  const needsAxis = ["revolute", "continuous", "prismatic", "planar"].includes(currentType);

  const jointMaxVelocityOverride = useJointStore(
    (s) => jointName ? s.jointVelocityLimits[jointName] : undefined
  );
  const globalMaxJointVelocity = useJointStore((s) => s.globalMaxJointVelocity);
  const setJointMaxVelocity = useJointStore((s) => s.setJointMaxVelocity);

  const degPerRad = RAD_TO_DEG;
  const radPerDeg = DEG_TO_RAD;
  const hasCustomVelocity =
    jointMaxVelocityOverride !== undefined && jointMaxVelocityOverride !== null;
  const effectiveJointVelocity =
    jointMaxVelocityOverride !== undefined && jointMaxVelocityOverride !== null
      ? jointMaxVelocityOverride
      : globalMaxJointVelocity;
  const velocityUnit = angleUnit === "deg" ? "°/s" : "rad/s";
  const velocityStep = angleUnit === "deg" ? 0.5 : 0.05;
  const velocityMin = angleUnit === "deg" ? 0.01 * RAD_TO_DEG : 0.01;
  const velocityDisplayRaw =
    angleUnit === "deg" ? effectiveJointVelocity * degPerRad : effectiveJointVelocity;
  const velocityPrecision = angleUnit === "deg" ? 100 : 1000;
  const velocityDisplay = Math.round(velocityDisplayRaw * velocityPrecision) / velocityPrecision;

  const handleJointVelocityChange = useCallback(
    (value: number) => {
      if (!jointName) return;
      const velocityRad = angleUnit === "deg" ? value * radPerDeg : value;
      setJointMaxVelocity(jointName, velocityRad);
    },
    [angleUnit, jointName, setJointMaxVelocity, radPerDeg]
  );

  const handleResetVelocity = useCallback(() => {
    if (!jointName) return;
    setJointMaxVelocity(jointName, null);
  }, [jointName, setJointMaxVelocity]);

  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Axis state
  const [localAxisX, setLocalAxisX] = useState<string>(
    jointAxis?.xyz ? String(jointAxis.xyz[0]) : "0"
  );
  const [localAxisY, setLocalAxisY] = useState<string>(
    jointAxis?.xyz ? String(jointAxis.xyz[1]) : "0"
  );
  const [localAxisZ, setLocalAxisZ] = useState<string>(
    jointAxis?.xyz ? String(jointAxis.xyz[2]) : "1"
  );

  // Get parent and child links from URDF
  const jointLinks = useMemo(() => {
    if (!urdfContent || !jointName) return { parentLink: null, childLink: null };
    return getJointLinks(urdfContent, jointName);
  }, [urdfContent, jointName]);

  // Get all available links for selection
  const availableLinks = useMemo(() => {
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

  // Update local axis when prop changes
  useEffect(() => {
    if (jointAxis?.xyz) {
      setLocalAxisX(String(jointAxis.xyz[0]));
      setLocalAxisY(String(jointAxis.xyz[1]));
      setLocalAxisZ(String(jointAxis.xyz[2]));
    }
  }, [jointAxis?.xyz]);

  // Find matching preset for current axis
  const getAxisPreset = (): string => {
    if (!jointAxis?.xyz) return "Custom";
    const [x, y, z] = jointAxis.xyz;
    const tolerance = 0.001;
    for (const [label, preset] of Object.entries(AXIS_PRESETS)) {
      if (
        Math.abs(preset.axis[0] - x) < tolerance &&
        Math.abs(preset.axis[1] - y) < tolerance &&
        Math.abs(preset.axis[2] - z) < tolerance
      ) {
        return label;
      }
    }
    return "Custom";
  };

  const [selectedPreset, setSelectedPreset] = useState<string>(getAxisPreset());

  useEffect(() => {
    setSelectedPreset(getAxisPreset());
  }, [jointAxis?.xyz]);

  const handleAxisPresetChange = (preset: string) => {
    if (!jointName) return;
    setSelectedPreset(preset);
    if (preset !== "Custom" && AXIS_PRESETS[preset]) {
      const axis = AXIS_PRESETS[preset].axis;
      setLocalAxisX(String(axis[0]));
      setLocalAxisY(String(axis[1]));
      setLocalAxisZ(String(axis[2]));
      onAxisChange?.(jointName, axis);
    }
  };

  const [localLowerLimit, setLocalLowerLimit] = useState<string>(
    jointInfo?.lower !== null ? String(jointInfo.lower) : ""
  );
  const [localUpperLimit, setLocalUpperLimit] = useState<string>(
    jointInfo?.upper !== null ? String(jointInfo.upper) : ""
  );

  // Update local limits when jointInfo changes (including type changes)
  useEffect(() => {
    const newType = jointInfo?.type || "continuous";
    const needsLimits = newType === "revolute" || newType === "prismatic";

    if (needsLimits) {
      const lower = jointInfo?.lower !== null && jointInfo?.lower !== undefined
        ? String(jointInfo.lower)
        : "";
      const upper = jointInfo?.upper !== null && jointInfo?.upper !== undefined
        ? String(jointInfo.upper)
        : "";
      setLocalLowerLimit(lower);
      setLocalUpperLimit(upper);
    } else {
      setLocalLowerLimit("");
      setLocalUpperLimit("");
    }
  }, [jointInfo?.lower, jointInfo?.upper, jointInfo?.type]);

  // Get child link coordinates
  const linkCoordinates = useMemo(() => {
    if (!robot || !jointLinks.childLink) return null;

    const linkObj = robot.links?.[jointLinks.childLink] ?? robot.getObjectByName?.(jointLinks.childLink);
    if (!linkObj) return null;

    try {
      linkObj.updateMatrixWorld?.(true);
      const position = new (window as any).THREE.Vector3();
      const quaternion = new (window as any).THREE.Quaternion();
      const scale = new (window as any).THREE.Vector3();
      linkObj.matrixWorld.decompose(position, quaternion, scale);

      return {
        position: { x: position.x, y: position.y, z: position.z },
        quaternion: { w: quaternion.w, x: quaternion.x, y: quaternion.y, z: quaternion.z },
      };
    } catch (error) {
      console.error("Error getting link coordinates:", error);
      return null;
    }
  }, [robot, jointLinks.childLink, currentValue]); // Re-compute when joint value changes

  if (!jointName) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground/70 p-4">
        Select a joint to edit its properties
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background border-l border-border/20">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/20 bg-muted/5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-medium text-foreground truncate">
            {jointName}
          </span>
          {isDeleted && (
            <span className="text-[9px] text-muted-foreground/70 flex-shrink-0">
              (deleted)
            </span>
          )}
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="coordinates" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-3 mt-2">
          <TabsTrigger value="coordinates" className="text-xs">Coordinates</TabsTrigger>
          <TabsTrigger value="properties" className="text-xs">Properties</TabsTrigger>
        </TabsList>

        {/* Coordinates Tab */}
        <TabsContent value="coordinates" className="flex-1 overflow-y-auto p-3 space-y-2 mt-0">
          {jointLinks.childLink && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground">
                Link: {jointLinks.childLink}
              </div>

              {linkCoordinates ? (
                <>
                  <div className="space-y-1 bg-muted/20 rounded p-2">
                    <div className="text-[10px] font-semibold text-emerald-600 mb-1">Position (meters)</div>
                    <BlenderPropertyRow label="X">
                      <div className="font-mono text-xs">{linkCoordinates.position.x.toFixed(6)}</div>
                    </BlenderPropertyRow>
                    <BlenderPropertyRow label="Y">
                      <div className="font-mono text-xs">{linkCoordinates.position.y.toFixed(6)}</div>
                    </BlenderPropertyRow>
                    <BlenderPropertyRow label="Z">
                      <div className="font-mono text-xs">{linkCoordinates.position.z.toFixed(6)}</div>
                    </BlenderPropertyRow>
                  </div>

                  <div className="space-y-1 bg-muted/20 rounded p-2">
                    <div className="text-[10px] font-semibold text-blue-600 mb-1">Orientation (Quaternion)</div>
                    <BlenderPropertyRow label="W">
                      <div className="font-mono text-xs">{linkCoordinates.quaternion.w.toFixed(6)}</div>
                    </BlenderPropertyRow>
                    <BlenderPropertyRow label="X">
                      <div className="font-mono text-xs">{linkCoordinates.quaternion.x.toFixed(6)}</div>
                    </BlenderPropertyRow>
                    <BlenderPropertyRow label="Y">
                      <div className="font-mono text-xs">{linkCoordinates.quaternion.y.toFixed(6)}</div>
                    </BlenderPropertyRow>
                    <BlenderPropertyRow label="Z">
                      <div className="font-mono text-xs">{linkCoordinates.quaternion.z.toFixed(6)}</div>
                    </BlenderPropertyRow>
                  </div>

                  <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/10 rounded">
                    These coordinates are in world space (meters). With robot at origin and scale=1, these match PyRoki FK coordinates directly.
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  Link coordinates not available
                </div>
              )}
            </div>
          )}
          {!jointLinks.childLink && (
            <div className="text-xs text-muted-foreground italic">
              No child link for this joint
            </div>
          )}
        </TabsContent>

        {/* Properties Tab */}
        <TabsContent value="properties" className="flex-1 overflow-y-auto p-3 space-y-2 mt-0">
        {/* Value Slider */}
        <BlenderPropertyRow label="Value">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <CustomSlider
                value={[currentValue]}
                onValueChange={(value) => onValueChange(value[0])}
                min={min}
                max={max}
                step={0.01}
                disabled={currentType === "fixed"}
                jointType={currentType}
              />
            </div>
            <NumberInput
              value={angleUnit === "deg" ? currentValue * RAD_TO_DEG : currentValue}
              onValueChange={(val) => {
                const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                const clampedValue = Math.max(min, Math.min(max, radValue));
                onValueChange(clampedValue);
              }}
              step={angleUnit === "deg" ? 1 : 0.01}
              min={angleUnit === "deg" ? min * RAD_TO_DEG : min}
              max={angleUnit === "deg" ? max * RAD_TO_DEG : max}
              compact
              className="w-16"
            />
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label={`Max velocity ${hasCustomVelocity ? "(Custom)" : "(Global)"}`}>
          <div className="flex items-center gap-2">
            <NumberInput
              value={velocityDisplay}
              onValueChange={handleJointVelocityChange}
              step={velocityStep}
              min={velocityMin}
              compact
              className="w-20"
              aria-label="Max joint velocity"
            />
            <span className="text-[10px] text-muted-foreground">{velocityUnit}</span>
            {hasCustomVelocity && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] flex-shrink-0"
                onClick={handleResetVelocity}
                title="Reset to global velocity"
              >
                Reset
              </Button>
            )}
          </div>
        </BlenderPropertyRow>

        {/* Limits for Revolute/Prismatic */}
        {needsLimits && (
          <BlenderPropertyRow label={`Angle limits (${angleUnit === "deg" ? "deg" : "rad"})`}>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Min:</span>
                <NumberInput
                  value={angleUnit === "deg"
                    ? (localLowerLimit ? parseFloat(localLowerLimit) * RAD_TO_DEG : (jointInfo?.lower ?? 0) * RAD_TO_DEG)
                    : (localLowerLimit ? parseFloat(localLowerLimit) : (jointInfo?.lower ?? 0))}
                  onValueChange={(val) => {
                    const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                    setLocalLowerLimit(String(radValue));
                  }}
                  step={angleUnit === "deg" ? 1 : 0.01}
                  compact
                  className="w-20"
                />
              </div>
              <span className="text-xs text-muted-foreground">/</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Max:</span>
                <NumberInput
                  value={angleUnit === "deg"
                    ? (localUpperLimit ? parseFloat(localUpperLimit) * RAD_TO_DEG : (jointInfo?.upper ?? 0) * RAD_TO_DEG)
                    : (localUpperLimit ? parseFloat(localUpperLimit) : (jointInfo?.upper ?? 0))}
                  onValueChange={(val) => {
                    const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                    setLocalUpperLimit(String(radValue));
                  }}
                  step={angleUnit === "deg" ? 1 : 0.01}
                  compact
                  className="w-20"
                />
              </div>
            </div>
          </BlenderPropertyRow>
        )}

        {/* Joint Type */}
        {onTypeChange && (
          <BlenderPropertyRow label="Type">
            <Select
              value={currentType}
              onValueChange={(newType) => {
                const newTypeNeedsLimits = newType === "revolute" || newType === "prismatic";
                let lower: number | undefined = undefined;
                let upper: number | undefined = undefined;

                if (newTypeNeedsLimits) {
                  if (localLowerLimit && localLowerLimit.trim() !== "") {
                    const parsed = parseFloat(localLowerLimit);
                    if (!isNaN(parsed)) lower = parsed;
                  } else if (jointInfo?.lower !== null && jointInfo?.lower !== undefined) {
                    lower = jointInfo.lower;
                  }

                  if (localUpperLimit && localUpperLimit.trim() !== "") {
                    const parsed = parseFloat(localUpperLimit);
                    if (!isNaN(parsed)) upper = parsed;
                  } else if (jointInfo?.upper !== null && jointInfo?.upper !== undefined) {
                    upper = jointInfo.upper;
                  }
                }

                onTypeChange(newType, lower, upper);
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {JOINT_TYPES.map((type) => (
                  <SelectItem key={type} value={type} className="text-xs">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BlenderPropertyRow>
        )}

        {/* Parent and Child Links */}
        {onLinkChange && urdfContent && (
          <>
            <BlenderPropertyRow label="Parent Link">
              <Select
                value={jointLinks.parentLink || ""}
                onValueChange={(value) => {
                  if (jointLinks.childLink && onLinkChange && jointName) {
                    onLinkChange(jointName, value, jointLinks.childLink);
                  }
                }}
              >
                <SelectTrigger className="h-7 text-xs truncate text-left">
                  <SelectValue placeholder="Select parent link" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {availableLinks.map((link) => (
                    <SelectItem key={link} value={link} className="text-xs">
                      <span className="truncate block">{link}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Child Link">
              <Select
                value={jointLinks.childLink || ""}
                onValueChange={(value) => {
                  if (jointLinks.parentLink && onLinkChange && jointName) {
                    onLinkChange(jointName, jointLinks.parentLink, value);
                  }
                }}
              >
                <SelectTrigger className="h-7 text-xs truncate text-left">
                  <SelectValue placeholder="Select child link" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {availableLinks.map((link) => (
                    <SelectItem key={link} value={link} className="text-xs">
                      <span className="truncate block">{link}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </BlenderPropertyRow>
          </>
        )}

        {/* Axis */}
        {needsAxis && onAxisChange && (
          <>
            <BlenderPropertyRow label="Axis">
              <div className="flex items-center gap-1.5">
                <Select value={selectedPreset} onValueChange={handleAxisPresetChange}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue>
                      {selectedPreset !== "Custom" && AXIS_PRESETS[selectedPreset] ? (
                        <div className="flex items-center gap-1.5">
                          {AXIS_PRESETS[selectedPreset].icon}
                          <span className="text-xs">{AXIS_PRESETS[selectedPreset].label}</span>
                        </div>
                      ) : (
                        "Custom"
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {Object.entries(AXIS_PRESETS).map(([key, preset]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        <div className="flex items-center gap-1.5">
                          {preset.icon}
                          <span>{preset.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                    <SelectItem value="Custom" className="text-xs">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {onResetAxis && originalAxis && jointAxis && (
                  JSON.stringify(originalAxis.xyz) !== JSON.stringify(jointAxis.xyz) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => jointName && onResetAxis(jointName)}
                      title="Reset axis to original value"
                    >
                      Reset
                    </Button>
                  )
                )}
              </div>
            </BlenderPropertyRow>
            {/* Info text based on joint type */}
            <div className="text-[10px] text-muted-foreground pl-6 pb-1">
              {currentType === "revolute" || currentType === "continuous"
                ? "Rotation around axis"
                : currentType === "prismatic"
                ? "Slides along axis"
                : ""}
            </div>
            {selectedPreset === "Custom" && (
              <>
                <BlenderPropertyRow label="X">
                  <NumberInput
                    value={parseFloat(localAxisX) || 0}
                    onValueChange={(val) => {
                      setLocalAxisX(String(val));
                      const x = val;
                      const y = parseFloat(localAxisY) || 0;
                      const z = parseFloat(localAxisZ) || 0;
                      if (jointName) onAxisChange?.(jointName, [x, y, z]);
                    }}
                    step={0.01}
                    compact
                    className="w-20"
                  />
                </BlenderPropertyRow>
                <BlenderPropertyRow label="Y">
                  <NumberInput
                    value={parseFloat(localAxisY) || 0}
                    onValueChange={(val) => {
                      setLocalAxisY(String(val));
                      const x = parseFloat(localAxisX) || 0;
                      const y = val;
                      const z = parseFloat(localAxisZ) || 0;
                      if (jointName) onAxisChange?.(jointName, [x, y, z]);
                    }}
                    step={0.01}
                    compact
                    className="w-20"
                  />
                </BlenderPropertyRow>
                <BlenderPropertyRow label="Z">
                  <NumberInput
                    value={parseFloat(localAxisZ) || 0}
                    onValueChange={(val) => {
                      setLocalAxisZ(String(val));
                      const x = parseFloat(localAxisX) || 0;
                      const y = parseFloat(localAxisY) || 0;
                      const z = val;
                      if (jointName) onAxisChange?.(jointName, [x, y, z]);
                    }}
                    step={0.01}
                    compact
                    className="w-20"
                  />
                </BlenderPropertyRow>
              </>
            )}
          </>
        )}

        {/* Delete Button */}
        {onDeleteJoint && (
          <div className="pt-2">
            <Button
              variant="destructive"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-3 h-3 mr-1.5" />
              {isDeleted ? "Restore Joint" : "Delete Joint"}
            </Button>
          </div>
        )}
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Joint</DialogTitle>
            <DialogDescription>
              Are you sure you want to {isDeleted ? "restore" : "delete"} the joint "{jointName}"?
              {!isDeleted && " It will be removed from the exported URDF."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              No
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (jointName) onDeleteJoint?.(jointName);
                setShowDeleteDialog(false);
              }}
            >
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
