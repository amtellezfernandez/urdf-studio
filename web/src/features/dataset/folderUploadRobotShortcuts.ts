export type FolderUploadRobotShortcutId = "openarm" | "so101";

export type FolderUploadRobotShortcut = {
  id: FolderUploadRobotShortcutId;
  manifestUrl: string;
  cameraConfigUrl?: string;
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
    cameraConfigUrl: undefined,
    displayName: "SO101",
    sourceLabel: "bundled SO101 starter",
    buttonLabel: "Try SO101",
  },
} as const satisfies Record<string, FolderUploadRobotShortcut>;

export const FOLDER_UPLOAD_ROBOT_SHORTCUT_LIST = [
  FOLDER_UPLOAD_ROBOT_SHORTCUTS.openArm,
  FOLDER_UPLOAD_ROBOT_SHORTCUTS.so101,
] as const;
