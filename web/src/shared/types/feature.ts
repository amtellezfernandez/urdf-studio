// Central types shared across features to avoid circular imports
export interface MeshFiles {
  [key: string]: Blob;
}

export type RotationAxis = "x" | "y" | "z";
export type UrdfViewMode = "original" | "modified" | "split";
export type AngleUnit = "rad" | "deg";
export type JointLimitMode = "report" | "clamp" | "shift";

export type InertialVisualizationSettings = {
  showGlobalCOM: boolean;
  showLinkCOM: boolean;
  showInertia: boolean;
  showReferenceGeometry: boolean;
  scopedLinkNames: string[] | null;
};

export type RobotBasePose = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
};

type DirectoryPickerOptions = FileSystemGetDirectoryOptions & {
  mode?: "read" | "readwrite";
};

export interface WindowWithViewerHandlers extends Window {
  viewer3dUploadMotionData?: (file: File) => void;
  viewer3dPlayAnimation?: (forceState?: boolean) => void;
  viewer3dSetFrame?: (frame: number) => void;
  viewer3dStopAnimation?: () => void;
  viewer3dClearAnimation?: () => void;
  viewer3dSetPlaybackSpeed?: (speed: number) => void;
  viewer3dGetPlaybackSpeed?: () => number;
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}

export interface DebugMeshInfo {
  filename: string;
  webkitRelativePath: string;
  found: boolean;
  urdfReference?: string;
  registeredPaths: string[];
}
