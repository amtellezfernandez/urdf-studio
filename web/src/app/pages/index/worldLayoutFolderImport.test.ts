/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildWorldLayoutFolderAssetMap,
  splitWorldLayoutFolderFiles,
} from "@/app/pages/index/worldLayoutFolderImport";

const WORLD_LAYOUT_FOLDER_IMPORT_TEST_FIXTURES = {
  layoutFileName: "demo-world-layout.json",
  meshFileName: "crate.glb",
} as const;

const createFile = ({
  content = "asset",
  name,
  relativePath,
}: {
  content?: string;
  name: string;
  relativePath?: string;
}): File => {
  const file = new File([content], name);
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
  }
  return file;
};

describe("worldLayoutFolderImport", () => {
  const originalCreateObjectUrl = URL.createObjectURL;

  beforeEach(() => {
    let objectUrlIndex = 0;
    URL.createObjectURL = vi.fn(() => {
      objectUrlIndex += 1;
      return `blob:world-layout-asset-${objectUrlIndex}`;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
  });

  it("selects the hinted world layout JSON and leaves other files as assets", () => {
    const genericJsonFile = createFile({ name: "metadata.json" });
    const layoutFile = createFile({
      name: WORLD_LAYOUT_FOLDER_IMPORT_TEST_FIXTURES.layoutFileName,
    });
    const meshFile = createFile({
      name: WORLD_LAYOUT_FOLDER_IMPORT_TEST_FIXTURES.meshFileName,
    });

    const split = splitWorldLayoutFolderFiles([genericJsonFile, meshFile, layoutFile]);

    expect(split.layoutFile).toBe(layoutFile);
    expect(split.assetFiles).toEqual([genericJsonFile, meshFile]);
  });

  it("builds a mesh URI asset map with shared object URLs per indexed blob", async () => {
    const assetMapResult = await buildWorldLayoutFolderAssetMap([
      createFile({
        name: WORLD_LAYOUT_FOLDER_IMPORT_TEST_FIXTURES.meshFileName,
        relativePath: "worlds/demo/meshes/crate.glb",
      }),
    ]);

    expect(assetMapResult.objectUrls).toEqual(["blob:world-layout-asset-1"]);
    expect(assetMapResult.assetMap["crate.glb"]).toBe("blob:world-layout-asset-1");
    expect(assetMapResult.assetMap["meshes/crate.glb"]).toBe("blob:world-layout-asset-1");
    expect(assetMapResult.assetMap["worlds/demo/meshes/crate.glb"]).toBe(
      "blob:world-layout-asset-1"
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
