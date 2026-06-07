import type { RobotBasePose } from "@/shared/types/feature";

export type FolderUploadRobotShortcutId = "openarm" | "so101" | "crane";

export type FolderUploadRobotShortcut = {
  id: FolderUploadRobotShortcutId;
  manifestUrl: string;
  cameraConfigUrl?: string;
  initialRobotPose?: RobotBasePose;
  displayName: string;
  sourceLabel: string;
  buttonLabel: string;
};

export const FOLDER_UPLOAD_ROBOT_SHORTCUTS = {
  openArm: {
    id: "openarm",
    manifestUrl: "/demo/openarm/manifest.json",
    cameraConfigUrl: "/demo/openarm/camera-config.json",
    displayName: "OpenArm",
    sourceLabel: "bundled OpenArm bimanual starter",
    buttonLabel: "Try OpenArm",
  },
  so101: {
    id: "so101",
    manifestUrl: "/demo/so101/manifest.json",
    cameraConfigUrl: "/demo/so101/camera-config.json",
    initialRobotPose: {
      position: { x: -0.1, y: 0.22, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    displayName: "SO101",
    sourceLabel: "bundled SO101 starter with cameras",
    buttonLabel: "Try SO101",
  },
  crane: {
    id: "crane",
    manifestUrl: "/demo/crane/manifest.json",
    cameraConfigUrl: "/demo/crane/camera-config.json",
    initialRobotPose: {
      position: { x: -0.45, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    displayName: "Crane",
    sourceLabel: "bundled crane starter with HK port background",
    buttonLabel: "Try Crane",
  },
} as const satisfies Record<string, FolderUploadRobotShortcut>;

export const FOLDER_UPLOAD_ROBOT_SHORTCUT_LIST = [
  FOLDER_UPLOAD_ROBOT_SHORTCUTS.openArm,
  FOLDER_UPLOAD_ROBOT_SHORTCUTS.so101,
  FOLDER_UPLOAD_ROBOT_SHORTCUTS.crane,
] as const;
