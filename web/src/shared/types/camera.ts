/**
 * Camera configuration types for URDF Studio
 */

export interface CameraDistortion {
  k1?: number;
  k2?: number;
  p1?: number;
  p2?: number;
  k3?: number;
}

export interface CameraIntrinsics {
  width: number;
  height: number;
  fov_deg: number;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  distortion?: CameraDistortion;
}

interface CameraPose {
  xyz: [number, number, number];  // Position [x, y, z]
  rpy: [number, number, number];  // Rotation [roll, pitch, yaw] in radians
}

export interface Camera {
  id: string;                      // Unique identifier
  name: string;                    // Camera name
  parent_joint: string;            // Parent joint in URDF
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
    parent_joint: string;
    pose: number[];  // [x, y, z, roll, pitch, yaw]
    intrinsics: {
      width: number;
      height: number;
      fov_deg?: number;
      fx?: number;
      fy?: number;
      cx?: number;
      cy?: number;
      distortion?: CameraDistortion;
    };
  }>;
}
