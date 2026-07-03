import { describe, expect, it } from "vitest";
import jsyaml from "js-yaml";
import {
  exportCamerasToJSON,
  exportCamerasToYAML,
} from "@/features/camera/cameraConfig";
import type { Camera } from "@/shared/types/camera";

const CAMERA_FIXTURE: Camera = {
  id: "camera-1",
  name: "wrist",
  parent_joint: "wrist_link",
  pose: {
    xyz: [0.1, 0.2, 0.3],
    rpy: [0.01, 0.02, 0.03],
  },
  intrinsics: {
    width: 640,
    height: 480,
    fov_deg: 70,
    fx: 500,
    fy: 501,
    cx: 320,
    cy: 240,
    distortion: {
      k1: 0.1,
      k2: -0.02,
    },
  },
};

describe("cameraConfig", () => {
  it("exports cameras to JSON and YAML using the same portable config shape", () => {
    const jsonConfig = JSON.parse(exportCamerasToJSON([CAMERA_FIXTURE]));
    const yamlConfig = jsyaml.load(exportCamerasToYAML([CAMERA_FIXTURE]));

    expect(jsonConfig).toEqual({
      cameras: [
        {
          name: "wrist",
          parent_joint: "wrist_link",
          pose: [0.1, 0.2, 0.3, 0.01, 0.02, 0.03],
          intrinsics: {
            width: 640,
            height: 480,
            fov_deg: 70,
            fx: 500,
            fy: 501,
            cx: 320,
            cy: 240,
            distortion: {
              k1: 0.1,
              k2: -0.02,
            },
          },
        },
      ],
    });
    expect(yamlConfig).toEqual(jsonConfig);
  });
});
