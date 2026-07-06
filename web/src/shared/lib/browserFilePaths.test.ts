/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { getBrowserFileRelativePath } from "@/shared/lib/browserFilePaths";

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

describe("getBrowserFileRelativePath", () => {
  it("falls back to the file name when the browser relative path is unavailable", () => {
    expect(getBrowserFileRelativePath(createFile({ name: "robot.urdf" }))).toBe(
      "robot.urdf"
    );
  });

  it("normalizes browser folder relative paths", () => {
    expect(
      getBrowserFileRelativePath(
        createFile({
          name: "robot.urdf",
          relativePath: "workspace\\robots\\robot.urdf",
        })
      )
    ).toBe("workspace/robots/robot.urdf");
  });
});
