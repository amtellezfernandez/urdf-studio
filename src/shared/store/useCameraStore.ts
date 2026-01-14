import { create } from 'zustand';
import { Camera, CameraConfig } from '@/shared/types/camera';

interface CameraStore {
  cameras: Camera[];
  selectedCameraId: string | null;

  // Add a new camera
  addCamera: (camera: Omit<Camera, 'id'>) => void;

  // Remove a camera by ID
  removeCamera: (id: string) => void;

  // Update camera properties
  updateCamera: (id: string, updates: Partial<Omit<Camera, 'id'>>) => void;

  // Select a camera
  selectCamera: (id: string | null) => void;

  // Load cameras from config
  loadCameras: (config: CameraConfig) => void;

  // Clear all cameras
  clearCameras: () => void;

  // Get camera by ID
  getCameraById: (id: string) => Camera | undefined;

  // Get cameras by parent link
  getCamerasByParentLink: (parentLink: string) => Camera[];
}

export const useCameraStore = create<CameraStore>((set, get) => ({
  cameras: [],
  selectedCameraId: null,

  addCamera: (camera) => {
    const id = `camera_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newCamera: Camera = {
      ...camera,
      id,
    };
    set((state) => ({
      cameras: [...state.cameras, newCamera],
    }));
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
        cam.id === id ? { ...cam, ...updates } : cam
      ),
    }));
  },

  selectCamera: (id) => {
    set({ selectedCameraId: id });
  },

  loadCameras: (config) => {
    set({
      cameras: config.cameras,
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

  getCamerasByParentLink: (parentLink) => {
    return get().cameras.filter((cam) => cam.parent_link === parentLink);
  },
}));
