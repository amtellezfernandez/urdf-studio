import { create } from "zustand";
import { Camera, CameraConfig } from "@/shared/types/camera";
import { normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";

interface CameraStore {
  cameras: Camera[];
  selectedCameraId: string | null;

  // Add a new camera
  addCamera: (camera: Omit<Camera, "id">) => void;

  // Add or update a camera with a stable external/session ID
  upsertCamera: (camera: Camera) => void;

  // Remove a camera by ID
  removeCamera: (id: string) => void;

  // Update camera properties
  updateCamera: (id: string, updates: Partial<Omit<Camera, "id">>) => void;

  // Select a camera
  selectCamera: (id: string | null) => void;

  // Load cameras from config
  loadCameras: (config: CameraConfig) => void;

  // Clear all cameras
  clearCameras: () => void;

  // Get camera by ID
  getCameraById: (id: string) => Camera | undefined;

  // Get cameras by parent joint
  getCamerasByParentJoint: (parentJoint: string) => Camera[];
}

export const useCameraStore = create<CameraStore>((set, get) => ({
  cameras: [],
  selectedCameraId: null,

  addCamera: (camera) => {
    const id = `camera_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newCamera: Camera = {
      ...camera,
      intrinsics: normalizeCameraIntrinsics(camera.intrinsics),
      id,
    };
    set((state) => ({
      cameras: [...state.cameras, newCamera],
    }));
  },

  upsertCamera: (camera) => {
    const nextCamera: Camera = {
      ...camera,
      intrinsics: normalizeCameraIntrinsics(camera.intrinsics),
    };
    set((state) => {
      const existingIndex = state.cameras.findIndex((item) => item.id === nextCamera.id);
      if (existingIndex < 0) {
        return { cameras: [...state.cameras, nextCamera] };
      }
      return {
        cameras: state.cameras.map((item, index) =>
          index === existingIndex ? nextCamera : item
        ),
      };
    });
  },

  removeCamera: (id) => {
    set((state) => ({
      cameras: state.cameras.filter((cam) => cam.id !== id),
      selectedCameraId: state.selectedCameraId === id ? null : state.selectedCameraId,
    }));
  },

  updateCamera: (id, updates) => {
    set((state) => ({
      cameras: state.cameras.map((cam) =>
        cam.id === id
          ? {
              ...cam,
              ...updates,
              intrinsics: normalizeCameraIntrinsics(updates.intrinsics ?? cam.intrinsics),
            }
          : cam
      ),
    }));
  },

  selectCamera: (id) => {
    set({ selectedCameraId: id });
  },

  loadCameras: (config) => {
    set({
      cameras: config.cameras.map((camera) => ({
        ...camera,
        intrinsics: normalizeCameraIntrinsics(camera.intrinsics),
      })),
      selectedCameraId: null,
    });
  },

  clearCameras: () => {
    set({
      cameras: [],
      selectedCameraId: null,
    });
  },

  getCameraById: (id) => {
    return get().cameras.find((cam) => cam.id === id);
  },

  getCamerasByParentJoint: (parentJoint) => {
    return get().cameras.filter((cam) => cam.parent_joint === parentJoint);
  },
}));
