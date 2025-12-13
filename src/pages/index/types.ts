export interface MeshFiles {
  [key: string]: Blob;
}

export type RotationAxis = "x" | "y" | "z";
export type UrdfViewMode = "original" | "modified" | "split";
export type AngleUnit = "rad" | "deg";

export interface WindowWithViewerHandlers extends Window {
  viewer3dUploadMotionData?: (file: File) => void;
  viewer3dPlayAnimation?: () => void;
  viewer3dSetFrame?: (frame: number) => void;
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
  metadata?: unknown;
};

export type EpisodeSaveHandler = (
  episode: ViewerEpisode,
  saveAsNew: boolean,
  newName?: string
) => void;
