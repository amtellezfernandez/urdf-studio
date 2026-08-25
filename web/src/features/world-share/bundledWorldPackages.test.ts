import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseStaticWorldSceneLayerSnapshot,
  readWorldSceneManifestFromUnknown,
  validateLocalWorldSceneManifest,
} from "@/features/world-share/worldSceneManifest";
import { findWorldSplatArtifact } from "@/features/world-share/worldSceneRuntimeStore";
import { DEFAULT_WORLD_LAYOUT_URL } from "@/shared/config/scenes";

const readBundledJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;

describe("bundled world packages", () => {
  it("uses HK Port as the default bundled world", () => {
    expect(DEFAULT_WORLD_LAYOUT_URL).toBe("/world-layouts/world-labs-hk-port.world-package.json");
  });

  it("loads the HK Port package as a valid static world package", () => {
    const payload = readBundledJson(
      "../../../public/world-layouts/world-labs-hk-port.world-package.json"
    );
    const manifest = readWorldSceneManifestFromUnknown(payload);

    expect(manifest?.package_id).toBe("world-labs-hk-port");
    expect(validateLocalWorldSceneManifest(manifest!)).toEqual([]);
    expect(parseStaticWorldSceneLayerSnapshot(payload).errors).toEqual([]);
    expect(findWorldSplatArtifact(manifest!.artifacts)?.uri).toBe(
      "/world-layouts/world-labs-hk-port/0-world-500k.spz"
    );
  });
});
