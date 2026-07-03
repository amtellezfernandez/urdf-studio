import { useCallback, useState } from "react";
import { Trash2 } from "lucide-react";
import type { URDFRobot } from "urdf-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import {
  normalizeCameraIntrinsics,
  scaleIntrinsicsToResolution,
  withIntrinsicsFocalLengths,
  withIntrinsicsFovDeg,
  withIntrinsicsPrincipalPoint,
} from "@/shared/lib/cameraIntrinsics";
import { useCameraStore } from "@/shared/store/useCameraStore";
import {
  buildCameraTransformDebugReport,
  remapCameraPoseBetweenParentJoints,
  type CameraTransformDebugReport,
} from "@/features/camera";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import {
  LabeledNumberField,
  type LabeledNumberFieldProps,
} from "@/features/layout/sidebarNumberField";

export interface CameraEditorPanelProps {
  cameraId: string;
  availableJoints: string[];
  robot?: URDFRobot | null;
  urdfSensors?: readonly unknown[];
}

const CAMERA_SECTION_LABEL_CLASS = JOINT_LIST_SIDEBAR_PARAMS.classNames.cameraSectionLabel;
const CAMERA_FIELD_LABEL_CLASS = JOINT_LIST_SIDEBAR_PARAMS.classNames.cameraFieldLabel;
const CAMERA_EDITOR_CLASS_NAMES = JOINT_LIST_SIDEBAR_PARAMS.classNames;

const radToDeg = (rad: number) => (rad * 180) / Math.PI;
const degToRad = (deg: number) => (deg * Math.PI) / 180;

const updatePoseAxis = (
  values: [number, number, number],
  axisIndex: 0 | 1 | 2,
  nextValue: number
): [number, number, number] => {
  const nextValues = [...values] as [number, number, number];
  nextValues[axisIndex] = nextValue;
  return nextValues;
};

const CameraNumberField = (
  props: Omit<LabeledNumberFieldProps, "labelClassName">
) => <LabeledNumberField {...props} labelClassName={CAMERA_FIELD_LABEL_CLASS} />;

export const CameraEditorPanel = ({
  cameraId,
  availableJoints,
  robot,
  urdfSensors = [],
}: CameraEditorPanelProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const updateCamera = useCameraStore((state) => state.updateCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const [debugReport, setDebugReport] = useState<CameraTransformDebugReport | null>(null);

  const camera = cameras.find((candidateCamera) => candidateCamera.id === cameraId);
  const updateCameraPose = (
    id: string,
    pose: { xyz: [number, number, number]; rpy: [number, number, number] },
    field: "xyz" | "rpy",
    axisIndex: 0 | 1 | 2,
    nextValue: number
  ) => {
    updateCamera(id, {
      pose: {
        ...pose,
        [field]: updatePoseAxis(pose[field], axisIndex, nextValue),
      },
    });
  };
  const refreshCameraDebugReport = useCallback(
    (poseOverride?: { xyz: [number, number, number]; rpy: [number, number, number] }) => {
      if (!camera) {
        return;
      }
      setDebugReport(
        buildCameraTransformDebugReport(
          robot ?? null,
          {
            id: camera.id,
            name: camera.name,
            parent_joint: camera.parent_joint,
            pose: poseOverride ?? camera.pose,
          },
          urdfSensors
        )
      );
    },
    [camera, robot, urdfSensors]
  );
  const applyCameraSensorPose = useCallback(() => {
    if (!camera || !debugReport?.sensor_pose_joint_frame) {
      return;
    }
    updateCamera(camera.id, { pose: debugReport.sensor_pose_joint_frame });
    refreshCameraDebugReport(debugReport.sensor_pose_joint_frame);
  }, [camera, debugReport, refreshCameraDebugReport, updateCamera]);
  const deleteEditedCamera = useCallback(() => {
    if (!camera) {
      return;
    }
    removeCamera(camera.id);
  }, [camera, removeCamera]);

  if (!camera) return null;

  const intrinsics = normalizeCameraIntrinsics(camera.intrinsics);

  return (
    <div className="p-0.5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <BlenderPanel title={null} alwaysExpanded={true}>
        <div className="space-y-1">
          <BlenderPropertyRow label="Camera" labelWidth="w-14">
            <span className="truncate text-[10px] text-foreground/90">{camera.name}</span>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Joint" labelWidth="w-14">
            <Select
              value={camera.parent_joint}
              onValueChange={(value) => {
                const remappedPose = remapCameraPoseBetweenParentJoints(
                  robot ?? null,
                  camera.parent_joint,
                  value,
                  camera.pose
                );
                updateCamera(camera.id, { parent_joint: value, pose: remappedPose });
              }}
            >
              <SelectTrigger className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactSelectTrigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactSelectContent}>
                {availableJoints.map((jointName) => (
                  <SelectItem key={jointName} value={jointName} className="text-[10px]">
                    {jointName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BlenderPropertyRow>

          <div className={CAMERA_SECTION_LABEL_CLASS}>Pose</div>

          <BlenderPropertyRow label="Position" labelWidth="w-14" className="items-start">
            <div className="grid grid-cols-3 gap-0.5">
              <CameraNumberField
                label="X (m)"
                value={camera.pose.xyz[0]}
                onValueChange={(positionMeters) =>
                  updateCameraPose(camera.id, camera.pose, "xyz", 0, positionMeters)
                }
                step={0.01}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="Y (m)"
                value={camera.pose.xyz[1]}
                onValueChange={(positionMeters) =>
                  updateCameraPose(camera.id, camera.pose, "xyz", 1, positionMeters)
                }
                step={0.01}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="Z (m)"
                value={camera.pose.xyz[2]}
                onValueChange={(positionMeters) =>
                  updateCameraPose(camera.id, camera.pose, "xyz", 2, positionMeters)
                }
                step={0.01}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Rotation" labelWidth="w-14" className="items-start">
            <div className="grid grid-cols-3 gap-0.5">
              <CameraNumberField
                label="Roll X"
                value={radToDeg(camera.pose.rpy[0])}
                onValueChange={(angleDegrees) =>
                  updateCameraPose(camera.id, camera.pose, "rpy", 0, degToRad(angleDegrees))
                }
                step={1}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="Pitch Y"
                value={radToDeg(camera.pose.rpy[1])}
                onValueChange={(angleDegrees) =>
                  updateCameraPose(camera.id, camera.pose, "rpy", 1, degToRad(angleDegrees))
                }
                step={1}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="Yaw Z"
                value={radToDeg(camera.pose.rpy[2])}
                onValueChange={(angleDegrees) =>
                  updateCameraPose(camera.id, camera.pose, "rpy", 2, degToRad(angleDegrees))
                }
                step={1}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
            </div>
          </BlenderPropertyRow>

          <div className={CAMERA_SECTION_LABEL_CLASS}>Intrinsics</div>

          <BlenderPropertyRow label="Res/FOV" labelWidth="w-14" className="items-start">
            <div className="grid grid-cols-3 gap-0.5">
              <CameraNumberField
                label="W"
                value={intrinsics.width}
                onValueChange={(widthPixels) => {
                  updateCamera(camera.id, {
                    intrinsics: scaleIntrinsicsToResolution(
                      camera.intrinsics,
                      Math.round(widthPixels),
                      intrinsics.height
                    ),
                  });
                }}
                step={1}
                min={1}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="H"
                value={intrinsics.height}
                onValueChange={(heightPixels) => {
                  updateCamera(camera.id, {
                    intrinsics: scaleIntrinsicsToResolution(
                      camera.intrinsics,
                      intrinsics.width,
                      Math.round(heightPixels)
                    ),
                  });
                }}
                step={1}
                min={1}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="FOV"
                value={intrinsics.fov_deg}
                onValueChange={(fovDegrees) => {
                  updateCamera(camera.id, {
                    intrinsics: withIntrinsicsFovDeg(camera.intrinsics, fovDegrees),
                  });
                }}
                step={1}
                min={1}
                max={179}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Focal" labelWidth="w-14" className="items-start">
            <div className="grid grid-cols-2 gap-0.5">
              <CameraNumberField
                label="fx"
                value={intrinsics.fx ?? 0}
                onValueChange={(focalLengthPixels) => {
                  updateCamera(camera.id, {
                    intrinsics: withIntrinsicsFocalLengths(
                      camera.intrinsics,
                      Math.max(1e-3, focalLengthPixels),
                      intrinsics.fy ?? focalLengthPixels
                    ),
                  });
                }}
                step={1}
                min={1e-3}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="fy"
                value={intrinsics.fy ?? 0}
                onValueChange={(focalLengthPixels) => {
                  updateCamera(camera.id, {
                    intrinsics: withIntrinsicsFocalLengths(
                      camera.intrinsics,
                      intrinsics.fx ?? focalLengthPixels,
                      Math.max(1e-3, focalLengthPixels)
                    ),
                  });
                }}
                step={1}
                min={1e-3}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label="Center" labelWidth="w-14" className="items-start">
            <div className="grid grid-cols-2 gap-0.5">
              <CameraNumberField
                label="cx"
                value={intrinsics.cx ?? intrinsics.width * 0.5}
                onValueChange={(principalPointPixels) => {
                  updateCamera(camera.id, {
                    intrinsics: withIntrinsicsPrincipalPoint(
                      camera.intrinsics,
                      principalPointPixels,
                      intrinsics.cy ?? intrinsics.height * 0.5
                    ),
                  });
                }}
                step={0.5}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
              <CameraNumberField
                label="cy"
                value={intrinsics.cy ?? intrinsics.height * 0.5}
                onValueChange={(principalPointPixels) => {
                  updateCamera(camera.id, {
                    intrinsics: withIntrinsicsPrincipalPoint(
                      camera.intrinsics,
                      intrinsics.cx ?? intrinsics.width * 0.5,
                      principalPointPixels
                    ),
                  });
                }}
                step={0.5}
                className={CAMERA_EDITOR_CLASS_NAMES.cameraEditorCompactInput}
              />
            </div>
          </BlenderPropertyRow>

          <div className="pt-0.5 border-t border-border/30">
            <button
              type="button"
              onClick={() => refreshCameraDebugReport()}
              className="h-5 px-0.5 text-[10px] text-blue-300 transition-colors hover:text-blue-200"
            >
              Dump transform
            </button>
            {debugReport ? (
              <div className="mt-1 rounded border border-border/40 bg-muted/10 p-1">
                <div className="text-[8px] text-muted-foreground">
                  Alignment:{" "}
                  {debugReport.within_tolerance === null
                    ? "N/A"
                    : debugReport.within_tolerance
                      ? "OK"
                      : "Mismatch"}{" "}
                  · Δpos: {debugReport.position_delta_m ?? "n/a"} m · Δang:{" "}
                  {debugReport.angle_delta_deg ?? "n/a"} deg
                </div>
                <pre className="mt-0.5 max-h-40 overflow-auto text-[8px] leading-tight text-muted-foreground">
                  {JSON.stringify(debugReport, null, 2)}
                </pre>
                {debugReport.sensor_pose_joint_frame ? (
                  <button
                    type="button"
                    onClick={applyCameraSensorPose}
                    className="mt-1 h-5 px-1 text-[9px] text-emerald-300 transition-colors hover:text-emerald-200"
                  >
                    Apply sensor pose
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="pt-0.5 border-t border-border/30">
            <button
              type="button"
              onClick={deleteEditedCamera}
              className="h-5 px-0.5 text-[10px] text-red-400 transition-colors hover:text-red-300"
            >
              <Trash2 className="mr-1 inline h-3 w-3" />
              Delete camera
            </button>
          </div>
        </div>
      </BlenderPanel>
    </div>
  );
};
