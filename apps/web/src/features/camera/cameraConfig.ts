import { Camera, CameraConfig, CameraConfigFile } from "@/shared/types/camera";
import jsyaml from "js-yaml";

/**
 * Parse a camera configuration file (JSON or YAML)
 */
export function parseCameraConfig(content: string, filename: string): CameraConfig {
  let configFile: CameraConfigFile;

  try {
    // Try parsing as JSON first
    if (filename.endsWith(".json")) {
      configFile = JSON.parse(content);
    } else if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
      // Parse YAML
      configFile = jsyaml.load(content) as CameraConfigFile;
    } else {
      // Try JSON first, then YAML
      try {
        configFile = JSON.parse(content);
      } catch {
        configFile = jsyaml.load(content) as CameraConfigFile;
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse camera config: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  if (!configFile || !Array.isArray(configFile.cameras)) {
    throw new Error('Invalid camera config format: missing "cameras" array');
  }

  // Convert to internal format
  const cameras: Camera[] = configFile.cameras.map((cam, index) => {
    if (!cam.name || !cam.parent_link || !cam.pose || !cam.intrinsics) {
      throw new Error(`Invalid camera at index ${index}: missing required fields`);
    }

    if (!Array.isArray(cam.pose) || cam.pose.length !== 6) {
      throw new Error(
        `Invalid camera "${cam.name}": pose must be an array of 6 numbers [x, y, z, roll, pitch, yaw]`,
      );
    }

    return {
      id: `camera_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
      name: cam.name,
      parent_link: cam.parent_link,
      pose: {
        xyz: [cam.pose[0], cam.pose[1], cam.pose[2]],
        rpy: [cam.pose[3], cam.pose[4], cam.pose[5]], // Already in radians
      },
      intrinsics: {
        width: cam.intrinsics.width,
        height: cam.intrinsics.height,
        fov_deg: cam.intrinsics.fov_deg,
      },
    };
  });

  return { cameras };
}

/**
 * Export cameras to JSON format
 */
export function exportCamerasToJSON(cameras: Camera[]): string {
  const configFile: CameraConfigFile = {
    cameras: cameras.map((cam) => ({
      name: cam.name,
      parent_link: cam.parent_link,
      pose: [
        cam.pose.xyz[0],
        cam.pose.xyz[1],
        cam.pose.xyz[2],
        cam.pose.rpy[0],
        cam.pose.rpy[1],
        cam.pose.rpy[2],
      ],
      intrinsics: {
        width: cam.intrinsics.width,
        height: cam.intrinsics.height,
        fov_deg: cam.intrinsics.fov_deg,
      },
    })),
  };

  return JSON.stringify(configFile, null, 2);
}

/**
 * Export cameras to YAML format
 */
export function exportCamerasToYAML(cameras: Camera[]): string {
  const configFile: CameraConfigFile = {
    cameras: cameras.map((cam) => ({
      name: cam.name,
      parent_link: cam.parent_link,
      pose: [
        cam.pose.xyz[0],
        cam.pose.xyz[1],
        cam.pose.xyz[2],
        cam.pose.rpy[0],
        cam.pose.rpy[1],
        cam.pose.rpy[2],
      ],
      intrinsics: {
        width: cam.intrinsics.width,
        height: cam.intrinsics.height,
        fov_deg: cam.intrinsics.fov_deg,
      },
    })),
  };

  return jsyaml.dump(configFile, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
  });
}
