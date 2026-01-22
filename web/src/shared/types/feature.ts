// Central types shared across features to avoid circular imports
export interface MeshFiles {
  [key: string]: Blob;
}

export type RotationAxis = "x" | "y" | "z";
export type UrdfViewMode = "original" | "modified" | "split";
export type AngleUnit = "rad" | "deg";
export type JointLimitMode = "report" | "clamp" | "shift";

type DirectoryPickerOptions = FileSystemGetDirectoryOptions & {
  mode?: "read" | "readwrite";
};

export interface WindowWithViewerHandlers extends Window {
  viewer3dUploadMotionData?: (file: File) => void;
  viewer3dPlayAnimation?: (forceState?: boolean) => void;
  viewer3dSetFrame?: (frame: number) => void;
  viewer3dStopAnimation?: () => void;
  viewer3dClearAnimation?: () => void;
  viewer3dPlayEpisode?: (
    frames: Array<{ timestamp: number; joints: Record<string, number> }>,
    options?: { autoplay?: boolean; startFrame?: number }
  ) => void;
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

export type ViewerEpisode = {
  id: string;
  number: number;
  frames: Array<{ timestamp: number; jointPositions: Record<string, number> }>;
  createdAt: number;
  metadata?: Record<string, unknown>;
};

export type EpisodeSaveHandler = (
  episode: ViewerEpisode,
  saveAsNew: boolean,
  newName?: string
) => void;

export interface JointMapping {
  datasetJoint: string;
  urdfJoint: string;
  offset?: number;
  inverted?: boolean;
  limitMode?: JointLimitMode;
}

export interface SavedMapping {
  id: string;
  source: string;
  mappings: JointMapping[];
  degToRad: boolean;
  timestamp: number;
  jointRanges?: Record<string, { min: number; max: number }>;
}
