import { describe, expect, it } from "vitest";
import { resolveAutoCameraLinks, resolveCameraPrefixLinks } from "./cameraAutoTargets";

describe("resolveCameraPrefixLinks", () => {
  it("returns links that start with camera (case-insensitive)", () => {
    const links = ["camera_front_link", "CameraTop", "base_link", "cam_link"];
    expect(resolveCameraPrefixLinks(links)).toEqual(["camera_front_link", "CameraTop"]);
  });

  it("handles URL-encoded link names and removes duplicates", () => {
    const links = ["camera%2Fhead", "camera/head", "camera%2Fhead"];
    expect(resolveCameraPrefixLinks(links)).toEqual(["camera/head", "camera%2Fhead"]);
  });
});

describe("resolveAutoCameraLinks", () => {
  it("prefers parsed camera sensors over prefix matching", () => {
    const links = ["camera_mount", "camera_model", "base_link"];
    const selected = resolveAutoCameraLinks({
      availableLinks: links,
      sensors: [
        { type: "camera", linkName: "camera_model" },
        { type: "imu", linkName: "imu_link" },
      ],
    });
    expect(selected).toEqual(["camera_model"]);
  });

  it("prunes camera ancestors when both parent and child links are camera-prefixed", () => {
    const links = ["camera_mount", "camera_model", "camera_rear"];
    const selected = resolveAutoCameraLinks({
      availableLinks: links,
      joints: [
        { parentLink: "camera_mount", childLink: "camera_model" },
        { parentLink: "base_link", childLink: "camera_rear" },
      ],
    });
    expect(selected).toEqual(["camera_model", "camera_rear"]);
  });
});
