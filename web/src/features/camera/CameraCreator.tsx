import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useCameraStore } from "@/shared/store/useCameraStore";
import {
  autoComputeCameraPoseDefault,
  remapCameraPoseToParentJointFrame,
  resolveCameraParentLinkNameFromJoint,
} from "@/features/camera";
import { normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import * as THREE from "three";

interface CameraCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableJoints: string[];
  robot?: URDFRobot | null;
}

type CameraPresetId = "gripper_top" | "base_front" | "wrist_side" | "overview";

type PoseProposalOptions = {
  marginForward?: number;
  marginUp?: number;
  rollOffset?: number;
  pitchOffset?: number;
  yawOffset?: number;
};

type CameraPreset = {
  label: string;
  description: string;
  defaultName: string;
  intrinsics: { width: number; height: number; fovDeg: number };
  poseOptions: PoseProposalOptions;
  preferredJointPatterns: RegExp[];
};

const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  gripper_top: {
    label: "Gripper Top",
    description: "Close grasp camera on tool/gripper joints.",
    defaultName: "Gripper Top",
    intrinsics: { width: 640, height: 480, fovDeg: 70 },
    poseOptions: { marginForward: 0.035, marginUp: 0.015, rollOffset: Math.PI / 2 },
    preferredJointPatterns: [
      /(wrist[_-]?flex|wrist.*flex|wrist|hand)/i,
      /(gripper_frame|tool0|tcp|end_effector|ee|gripper|tool)/i,
    ],
  },
  base_front: {
    label: "Base Front",
    description: "Forward monitor camera near base/shoulder joints.",
    defaultName: "Base Front",
    intrinsics: { width: 640, height: 480, fovDeg: 78 },
    poseOptions: { marginForward: 0.06, marginUp: 0.03, rollOffset: Math.PI / 2 },
    preferredJointPatterns: [/(shoulder|base|waist|root)/i],
  },
  wrist_side: {
    label: "Wrist Side",
    description: "Side angle for manipulation details.",
    defaultName: "Wrist Side",
    intrinsics: { width: 960, height: 540, fovDeg: 80 },
    poseOptions: {
      marginForward: 0.04,
      marginUp: 0.02,
      rollOffset: Math.PI / 2,
      yawOffset: Math.PI / 6,
    },
    preferredJointPatterns: [/(wrist|forearm|tool|gripper|hand)/i, /(elbow|arm)/i],
  },
  overview: {
    label: "Overview",
    description: "Wide context camera on base joints.",
    defaultName: "Overview",
    intrinsics: { width: 1280, height: 720, fovDeg: 92 },
    poseOptions: { marginForward: 0.1, marginUp: 0.08, rollOffset: Math.PI / 2 },
    preferredJointPatterns: [/(base|root|world)/i, /(shoulder|waist)/i],
  },
};

const isLowPriorityJoint = (name: string) => /fixed|frame|dummy|target|origin|marker|site/i.test(name);
const CAMERA_LINK_HINT_PATTERN = /(camera|cam|optic|sensor|lens)/i;
const DEFAULT_LOCAL_CAMERA_CENTER_POSE = {
  xyz: [0, 0, 0] as [number, number, number],
  rpy: [0, 0, 0] as [number, number, number],
};

const findPreferredJoint = (availableJoints: string[], presetId: CameraPresetId) => {
  const preset = CAMERA_PRESETS[presetId];
  for (const pattern of preset.preferredJointPatterns) {
    const match = availableJoints.find((joint) => pattern.test(joint) && !isLowPriorityJoint(joint));
    if (match) return match;
  }

  const nonFixed = availableJoints.find((joint) => !isLowPriorityJoint(joint));
  return nonFixed ?? availableJoints[0] ?? "";
};

const radToDeg = (rad: number) => (rad * 180) / Math.PI;
const degToRad = (deg: number) => (deg * Math.PI) / 180;

const computeLinkVisualCenterPose = (
  robot: URDFRobot,
  linkName: string
): { xyz: [number, number, number]; rpy: [number, number, number] } => {
  const linkObject =
    robot.links?.[linkName] ??
    robot.getObjectByName?.(linkName) ??
    robot.getObjectByName?.(decodeURIComponent(linkName));
  if (!linkObject) return DEFAULT_LOCAL_CAMERA_CENTER_POSE;

  try {
    linkObject.updateMatrixWorld(true);
    const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
    const localBounds = new THREE.Box3().makeEmpty();

    for (const child of linkObject.children ?? []) {
      const isVisual = Boolean((child as { isURDFVisual?: boolean }).isURDFVisual);
      if (!isVisual) continue;
      const childBounds = new THREE.Box3().setFromObject(child);
      if (childBounds.isEmpty()) continue;
      const childBoundsLocal = childBounds.clone().applyMatrix4(worldToLink);
      if (localBounds.isEmpty()) {
        localBounds.copy(childBoundsLocal);
      } else {
        localBounds.union(childBoundsLocal);
      }
    }

    if (localBounds.isEmpty()) return DEFAULT_LOCAL_CAMERA_CENTER_POSE;
    const center = localBounds.getCenter(new THREE.Vector3());
    return {
      xyz: [center.x, center.y, center.z],
      rpy: [0, 0, 0],
    };
  } catch {
    return DEFAULT_LOCAL_CAMERA_CENTER_POSE;
  }
};

export function CameraCreator({ open, onOpenChange, availableJoints, robot }: CameraCreatorProps) {
  const addCamera = useCameraStore((state) => state.addCamera);
  const cameras = useCameraStore((state) => state.cameras);

  const [presetId, setPresetId] = useState<CameraPresetId>("gripper_top");
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [parentJoint, setParentJoint] = useState("");
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);
  const [roll, setRoll] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(480);
  const [fovDeg, setFovDeg] = useState(70);

  const currentPreset = useMemo(() => CAMERA_PRESETS[presetId], [presetId]);

  const buildUniqueName = useCallback(
    (baseName: string) => {
      const normalized = baseName.trim() || "Camera";
      if (!cameras.some((camera) => camera.name === normalized)) return normalized;
      let suffix = 2;
      let candidate = `${normalized} ${suffix}`;
      while (cameras.some((camera) => camera.name === candidate)) {
        suffix += 1;
        candidate = `${normalized} ${suffix}`;
      }
      return candidate;
    },
    [cameras]
  );

  const proposePose = useCallback(
    (jointName: string, preset: CameraPresetId) => {
      if (!jointName || !robot) return;
      const parentLink = resolveCameraParentLinkNameFromJoint(robot, jointName);
      if (!parentLink) return;
      const useCameraCenterPose =
        CAMERA_LINK_HINT_PATTERN.test(parentLink) || CAMERA_LINK_HINT_PATTERN.test(jointName);
      const pose = useCameraCenterPose
        ? computeLinkVisualCenterPose(robot, parentLink)
        : (
            autoComputeCameraPoseDefault(robot, parentLink, CAMERA_PRESETS[preset].poseOptions) ??
            autoComputeCameraPoseDefault(robot, parentLink)
          );
      if (!pose) return;
      const jointFramePose = remapCameraPoseToParentJointFrame(
        robot,
        jointName,
        parentLink,
        pose
      );

      setPosX(jointFramePose.xyz[0]);
      setPosY(jointFramePose.xyz[1]);
      setPosZ(jointFramePose.xyz[2]);
      setRoll(radToDeg(jointFramePose.rpy[0]));
      setPitch(radToDeg(jointFramePose.rpy[1]));
      setYaw(radToDeg(jointFramePose.rpy[2]));
    },
    [robot]
  );

  const applyPresetProposal = useCallback(
    (nextPreset: CameraPresetId, overrideJoint?: string) => {
      const preset = CAMERA_PRESETS[nextPreset];
      const suggestedJoint =
        overrideJoint && availableJoints.includes(overrideJoint)
          ? overrideJoint
          : findPreferredJoint(availableJoints, nextPreset);

      setPresetId(nextPreset);
      setParentJoint(suggestedJoint);
      setWidth(preset.intrinsics.width);
      setHeight(preset.intrinsics.height);
      setFovDeg(preset.intrinsics.fovDeg);
      if (!nameTouched) {
        setName(buildUniqueName(preset.defaultName));
      }
      proposePose(suggestedJoint, nextPreset);
    },
    [availableJoints, buildUniqueName, nameTouched, proposePose]
  );

  useEffect(() => {
    if (!open) return;
    setAdvanced(false);
    setNameTouched(false);
    setName("");
    applyPresetProposal("gripper_top");
  }, [open, applyPresetProposal]);

  const handlePresetChange = (value: string) => {
    const nextPreset = value as CameraPresetId;
    applyPresetProposal(nextPreset);
  };

  const handleJointChange = (value: string) => {
    setParentJoint(value);
    proposePose(value, presetId);
  };

  const handleCreate = () => {
    const finalName = name.trim();
    if (!finalName || !parentJoint) {
      toast.error("Select a preset/joint and provide a camera name.");
      return;
    }
    if (width <= 0 || height <= 0 || fovDeg <= 0) {
      toast.error("Invalid camera intrinsics.");
      return;
    }

    addCamera({
      name: finalName,
      parent_joint: parentJoint,
      pose: {
        xyz: [posX, posY, posZ],
        rpy: [degToRad(roll), degToRad(pitch), degToRad(yaw)],
      },
      intrinsics: normalizeCameraIntrinsics({
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        fov_deg: Math.max(1, fovDeg),
      }),
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4] max-w-md max-h-[85vh] overflow-y-auto p-3">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-sm text-[#d4d4d4] font-normal">Create Camera</DialogTitle>
          <DialogDescription className="text-[11px] text-[#9d9d9d]">
            Start from a smart proposal, then tweak only if needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div>
            <Label htmlFor="camera-name" className="text-[10px] text-[#9d9d9d] mb-1 block">
              Name
            </Label>
            <Input
              id="camera-name"
              type="text"
              placeholder="Camera name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
            />
          </div>

          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Preset</Label>
            <Select value={presetId} onValueChange={handlePresetChange}>
              <SelectTrigger className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                {Object.entries(CAMERA_PRESETS).map(([id, preset]) => (
                  <SelectItem key={id} value={id} className="text-[11px] text-[#d4d4d4]">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-[#8b8b8b]">{currentPreset.description}</p>
          </div>

          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Attach To Joint</Label>
            <Select value={parentJoint} onValueChange={handleJointChange}>
              <SelectTrigger className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4]">
                <SelectValue placeholder="Select joint..." />
              </SelectTrigger>
              <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                {availableJoints.length === 0 ? (
                  <SelectItem value="no-joints" disabled className="text-[#9d9d9d]">
                    No joints available
                  </SelectItem>
                ) : (
                  availableJoints.map((jointName) => (
                    <SelectItem key={jointName} value={jointName} className="text-[11px] text-[#d4d4d4]">
                      {jointName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded border border-[#3d3d3d] bg-[#1e1e1e] p-2">
            <span className="text-[10px] text-[#9d9d9d]">
              Proposal: {width} x {height}, {fovDeg.toFixed(0)}deg
            </span>
            <Button
              onClick={() => {
                if (!parentJoint) {
                  toast.error("Select a joint first.");
                  return;
                }
                proposePose(parentJoint, presetId);
              }}
              disabled={!parentJoint || !robot}
              className="h-6 text-[10px] bg-[#3d3d3d] hover:bg-[#4d4d4d] text-[#d4d4d4] px-2"
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Refresh Proposal
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced((prev) => !prev)}
            className="text-[10px] text-[#9d9d9d] hover:text-[#d4d4d4] underline underline-offset-2"
          >
            {advanced ? "Hide advanced pose/intrinsics" : "Show advanced pose/intrinsics"}
          </button>

          {advanced && (
            <>
              <div>
                <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Position (m)</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  <Input
                    type="number"
                    step="0.01"
                    value={posX}
                    onChange={(e) => setPosX(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={posY}
                    onChange={(e) => setPosY(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={posZ}
                    onChange={(e) => setPosZ(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Rotation (deg)</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  <Input
                    type="number"
                    step="1"
                    value={roll}
                    onChange={(e) => setRoll(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                  <Input
                    type="number"
                    step="1"
                    value={pitch}
                    onChange={(e) => setPitch(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                  <Input
                    type="number"
                    step="1"
                    value={yaw}
                    onChange={(e) => setYaw(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Intrinsics</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  <Input
                    type="number"
                    step="1"
                    value={width}
                    onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                  <Input
                    type="number"
                    step="1"
                    value={height}
                    onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                  <Input
                    type="number"
                    step="1"
                    value={fovDeg}
                    onChange={(e) => setFovDeg(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-1.5 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#3d3d3d] px-3"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={availableJoints.length === 0}
            className="h-7 text-[11px] bg-[#3d3d3d] hover:bg-[#4d4d4d] text-[#d4d4d4] px-3 disabled:opacity-50"
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
