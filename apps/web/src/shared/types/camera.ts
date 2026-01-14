/**
 * Camera configuration types for URDF Studio
 */

interface CameraIntrinsics {
  width: number;
  height: number;
  fov_deg: number;
}

interface CameraPose {
  xyz: [number, number, number];  // Position [x, y, z]
  rpy: [number, number, number];  // Rotation [roll, pitch, yaw] in radians
}

export interface Camera {
  id: string;                      // Unique identifier
  name: string;                    // Camera name
  parent_link: string;             // Parent link in URDF
  pose: CameraPose;                // Position and rotation
  intrinsics: CameraIntrinsics;    // Camera intrinsic parameters
}

export interface CameraConfig {
  cameras: Camera[];
}

/**
 * Format for loading/saving camera configs (supports both array formats)
 */
export interface CameraConfigFile {
  cameras: Array<{
    name: string;
    parent_link: string;
    pose: number[];  // [x, y, z, roll, pitch, yaw]
    intrinsics: {
      width: number;
      height: number;
      fov_deg: number;
    };
  }>;
}
