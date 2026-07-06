/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentValue,
  deriveLocalSourceLabel,
  deriveSourceLabel,
  readStoredJsonArray,
  readStoredString,
  removeRecentValue,
  writeStoredString,
} from "@/app/pages/index/coreFolderUploadScreenState";

const createFile = ({
  name,
  relativePath,
}: {
  name: string;
  relativePath?: string;
}): File => {
  const file = new File(["content"], name);
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

describe("deriveLocalSourceLabel", () => {
  it("uses the selected folder root from a browser relative path", () => {
    expect(
      deriveLocalSourceLabel([
        createFile({
          name: "robot.urdf",
          relativePath: "workspace\\robots\\robot.urdf",
        }),
        createFile({
          name: "mesh.stl",
          relativePath: "workspace\\meshes\\mesh.stl",
        }),
      ])
    ).toBe("workspace");
  });

  it("falls back to the file name for a single direct file", () => {
    expect(deriveLocalSourceLabel([createFile({ name: "robot.urdf" })])).toBe(
      "robot.urdf"
    );
  });
});

describe("deriveSourceLabel", () => {
  it("uses URL path basenames before hostnames", () => {
    expect(deriveSourceLabel("https://example.test/assets/robot.urdf", "fallback")).toBe(
      "robot.urdf"
    );
    expect(deriveSourceLabel("https://example.test/", "fallback")).toBe("example.test");
  });

  it("uses path basenames for non-URL values", () => {
    expect(deriveSourceLabel("workspace\\robots\\robot.xacro", "fallback")).toBe(
      "robot.xacro"
    );
    expect(deriveSourceLabel("   ", "fallback")).toBe("fallback");
  });
});

describe("core folder upload storage helpers", () => {
  const storageKey = "urdfstudio:test-storage-helper";

  beforeEach(() => {
    localStorage.clear();
  });

  it("reads only string values from stored JSON arrays", () => {
    localStorage.setItem(storageKey, JSON.stringify(["one", 2, "two", null]));

    expect(readStoredJsonArray(storageKey)).toEqual(["one", "two"]);
  });

  it("ignores malformed or missing stored JSON arrays", () => {
    expect(readStoredJsonArray(storageKey)).toEqual([]);

    localStorage.setItem(storageKey, "{not-json");

    expect(readStoredJsonArray(storageKey)).toEqual([]);
  });

  it("adds recent values with trimming, deduplication, and max length", () => {
    expect(addRecentValue(storageKey, " one ")).toEqual(["one"]);
    expect(addRecentValue(storageKey, "two")).toEqual(["two", "one"]);
    expect(addRecentValue(storageKey, "one", 2)).toEqual(["one", "two"]);
    expect(addRecentValue(storageKey, "three", 2)).toEqual(["three", "one"]);
    expect(addRecentValue(storageKey, "   ", 2)).toEqual(["three", "one"]);
  });

  it("removes recent values", () => {
    localStorage.setItem(storageKey, JSON.stringify(["one", "two"]));

    expect(removeRecentValue(storageKey, "one")).toEqual(["two"]);
    expect(readStoredJsonArray(storageKey)).toEqual(["two"]);
  });

  it("writes and clears stored strings", () => {
    writeStoredString(storageKey, "robot_pkg");

    expect(readStoredString(storageKey)).toBe("robot_pkg");

    writeStoredString(storageKey, null);

    expect(readStoredString(storageKey)).toBeNull();
  });
});
