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

  it("points SO101 to a bundled manifest with no GitHub dependency", () => {
    const shortcut = FOLDER_UPLOAD_ROBOT_SHORTCUTS.so101;
    const manifest = loadManifest(shortcut);
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    const urdfEntry = manifest.files[0];

    expect(shortcut.manifestUrl).toBe("/demo/so101/manifest.json");
    expect(shortcut.cameraConfigUrl).toBeUndefined();
    expect(manifest.label).toBe("SO101");
    expect(urdfEntry?.path).toBe("robot.urdf");

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
});
