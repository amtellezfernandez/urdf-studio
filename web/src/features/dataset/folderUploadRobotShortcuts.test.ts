import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FOLDER_UPLOAD_ROBOT_SHORTCUTS,
  type FolderUploadRobotShortcut,
} from "@/features/dataset/folderUploadRobotShortcuts";

type ShortcutManifest = {
  label?: string;
  files: Array<{ path: string; url: string }>;
};

type ShortcutCameraConfig = {
  cameras: Array<{ name: string; parent_joint: string; pose: number[] }>;
};

const PUBLIC_DEMO_ROOT = fileURLToPath(new URL("../../../public/demo/", import.meta.url));

const loadManifest = (shortcut: FolderUploadRobotShortcut): ShortcutManifest => {
  const manifestFilePath = path.join(
    PUBLIC_DEMO_ROOT,
    shortcut.manifestUrl.replace(/^\/demo\//, "")
  );
  return JSON.parse(readFileSync(manifestFilePath, "utf8")) as ShortcutManifest;
};

const resolveManifestFilePath = (
  shortcut: FolderUploadRobotShortcut,
  fileUrl: string
): string => {
  const manifestDir = path.dirname(
    path.join(PUBLIC_DEMO_ROOT, shortcut.manifestUrl.replace(/^\/demo\//, ""))
  );
  return path.resolve(manifestDir, fileUrl);
};

const loadCameraConfig = (shortcut: FolderUploadRobotShortcut): ShortcutCameraConfig => {
  const cameraConfigUrl = shortcut.cameraConfigUrl;
  if (!cameraConfigUrl) return { cameras: [] };
  const cameraConfigFilePath = path.join(
    PUBLIC_DEMO_ROOT,
    cameraConfigUrl.replace(/^\/demo\//, "")
  );
  return JSON.parse(readFileSync(cameraConfigFilePath, "utf8")) as ShortcutCameraConfig;
};

describe("FOLDER_UPLOAD_ROBOT_SHORTCUTS", () => {
  it("points OpenArm to a bundled fast manifest with camera config and local mesh coverage", () => {
    const shortcut = FOLDER_UPLOAD_ROBOT_SHORTCUTS.openArm;
    const manifest = loadManifest(shortcut);
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    const urdfEntry = manifest.files[0];

    expect(shortcut.manifestUrl).toBe("/demo/openarm/manifest.json");
    expect(shortcut.cameraConfigUrl).toBe("/demo/openarm/camera-config.json");
    expect(manifest.label).toBe("OpenArm Bimanual");
    expect(
      existsSync(path.join(PUBLIC_DEMO_ROOT, "openarm/camera-config.json"))
    ).toBe(true);
    expect(urdfEntry?.path).toBe("openarm_description/openarm.urdf");
    expect(manifestPaths.has("openarm_description/package.xml")).toBe(true);

    manifest.files.forEach((file) => {
      expect(file.path).not.toContain(".xacro");
      expect(file.path).not.toContain(".dae");
      expect(existsSync(resolveManifestFilePath(shortcut, file.url))).toBe(true);
    });

    const urdfText = readFileSync(resolveManifestFilePath(shortcut, urdfEntry?.url ?? ""), "utf8");
    expect(urdfText).toContain('<link name="openarm_body_link0"');
    expect(urdfText).toContain('<link name="openarm_left_link7"');
    expect(urdfText).toContain('<link name="openarm_right_link7"');
    expect(urdfText).toContain('<link name="openarm_left_hand"');
    expect(urdfText).toContain('<link name="openarm_right_hand"');
    expect(urdfText).not.toContain('<link name="openarm_link7"');

    const referencedMeshPaths = Array.from(
      urdfText.matchAll(/filename="package:\/\/openarm_description\/([^"]+)"/g),
      (match) => `openarm_description/${match[1]}`
    );

    expect(referencedMeshPaths.length).toBeGreaterThan(0);
    referencedMeshPaths.forEach((meshPath) => {
      expect(manifestPaths.has(meshPath)).toBe(true);
    });
  });

  it("points SO101 to a bundled manifest with camera config and no GitHub dependency", () => {
    const shortcut = FOLDER_UPLOAD_ROBOT_SHORTCUTS.so101;
    const manifest = loadManifest(shortcut);
    const cameraConfig = loadCameraConfig(shortcut);
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    const urdfEntry = manifest.files[0];

    expect(shortcut.manifestUrl).toBe("/demo/so101/manifest.json");
    expect(shortcut.cameraConfigUrl).toBe("/demo/so101/camera-config.json");
    expect(shortcut.initialRobotPose).toEqual({
      position: { x: -0.1, y: 0.22, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(manifest.label).toBe("SO101");
    expect(existsSync(path.join(PUBLIC_DEMO_ROOT, "so101/camera-config.json"))).toBe(true);
    expect(urdfEntry?.path).toBe("robot.urdf");
    expect(cameraConfig.cameras.map((camera) => camera.name)).toEqual([
      "so101_overhead_scene",
      "so101_gripper_down",
      "so101_port_oblique",
    ]);
    expect(cameraConfig.cameras.every((camera) => camera.pose.length === 6)).toBe(true);
    expect(cameraConfig.cameras.find((camera) => camera.name === "so101_port_oblique"))
      .toMatchObject({
        parent_joint: "base_link",
      });

    manifest.files.forEach((file) => {
      expect(file.path).not.toContain(".xacro");
      expect(file.path).not.toContain(".dae");
      expect(existsSync(resolveManifestFilePath(shortcut, file.url))).toBe(true);
    });

    const urdfText = readFileSync(resolveManifestFilePath(shortcut, urdfEntry?.url ?? ""), "utf8");
    expect(urdfText).toContain('<robot name="so101_new_calib">');
    expect(urdfText).toContain('<joint name="shoulder_pan"');
    expect(urdfText).toContain('<joint name="gripper"');

    const referencedMeshPaths = Array.from(
      urdfText.matchAll(/filename="([^"]+\.stl)"/g),
      (match) => match[1] ?? ""
    );

    expect(referencedMeshPaths.length).toBeGreaterThan(0);
    referencedMeshPaths.forEach((meshPath) => {
      expect(manifestPaths.has(meshPath)).toBe(true);
    });
  });

  it("points Crane to a bundled manifest without changing the SO101 starter", () => {
    const shortcut = FOLDER_UPLOAD_ROBOT_SHORTCUTS.crane;
    const manifest = loadManifest(shortcut);
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    const urdfEntry = manifest.files[0];

    expect(shortcut.manifestUrl).toBe("/demo/crane/manifest.json");
    const cameraConfig = loadCameraConfig(shortcut);

    expect(shortcut.cameraConfigUrl).toBe("/demo/crane/camera-config.json");
    expect(shortcut.initialRobotPose).toEqual({
      position: { x: -0.45, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(shortcut.buttonLabel).toBe("Try Crane");
    expect(manifest.label).toBe("Crane");
    expect(urdfEntry?.path).toBe("ship_crane.urdf");
    expect(cameraConfig.cameras.map((camera) => camera.name)).toEqual([
      "crane_overhead_scene",
      "crane_boom_gripper",
      "crane_port_oblique",
    ]);
    expect(cameraConfig.cameras.every((camera) => camera.pose.length === 6)).toBe(true);
    expect(cameraConfig.cameras.map((camera) => camera.parent_joint)).toEqual([
      "base_yaw",
      "finger_slide",
      "base_yaw",
    ]);

    manifest.files.forEach((file) => {
      expect(file.path).not.toContain(".xacro");
      expect(file.path).not.toContain(".dae");
      expect(existsSync(resolveManifestFilePath(shortcut, file.url))).toBe(true);
    });

    const urdfText = readFileSync(resolveManifestFilePath(shortcut, urdfEntry?.url ?? ""), "utf8");
    expect(urdfText).toContain('<robot name="ship_crane">');
    expect(urdfText).toContain('<origin xyz="0 0 0.51" rpy="1.5707963 0 0"/>');
    expect(urdfText).toContain('<joint name="base_yaw"');
    expect(urdfText).toContain('<joint name="boom_luff"');
    expect(urdfText).toContain('<joint name="finger_slide"');

    const referencedMeshPaths = Array.from(
      urdfText.matchAll(/filename="([^"]+\.glb)"/g),
      (match) => match[1] ?? ""
    );

    expect(referencedMeshPaths).toEqual([
      "meshes/tower.glb",
      "meshes/tower.glb",
      "meshes/boom.glb",
      "meshes/boom.glb",
    ]);
    referencedMeshPaths.forEach((meshPath) => {
      expect(manifestPaths.has(meshPath)).toBe(true);
    });
  });
});
