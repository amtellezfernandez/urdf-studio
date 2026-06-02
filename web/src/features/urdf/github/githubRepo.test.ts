/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearRepoContentsCacheForTests,
  checkRepoVisibility,
  collectXacroSupportFilesForGitHub,
  convertGitHubFilesToFileList,
  extractMeshReferencesFromURDF,
  fetchRepoContents,
  findURDFCandidates,
  parseGitHubUrl,
  resolveMeshPathGeneric,
  type GitHubFile,
} from "./githubRepo";

const file = (path: string): GitHubFile => ({
  name: path.split("/").pop() || path,
  path,
  type: "file",
  download_url: null,
});

const dir = (path: string): GitHubFile => ({
  name: path.split("/").pop() || path,
  path,
  type: "dir",
  download_url: null,
});

beforeEach(() => {
  __clearRepoContentsCacheForTests();
});

describe("githubRepo mesh reference handling", () => {
  it("extracts raw mesh references", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="TestBot">
  <link name="base_link">
    <visual><geometry><mesh filename="package://pkg/meshes/a.stl"/></geometry></visual>
    <collision><geometry><mesh filename="file:///abs/b.stl"/></geometry></collision>
  </link>
</robot>`;
    const refs = extractMeshReferencesFromURDF(urdf);
    expect(refs).toEqual(
      expect.arrayContaining(["package://pkg/meshes/a.stl", "file:///abs/b.stl"])
    );
  });

  it("resolves package:// references relative to URDF directory", () => {
    const meshFile = file("robots/meshes/a.stl");
    const map = new Map<string, GitHubFile>([[meshFile.path.toLowerCase(), meshFile]]);
    const resolved = resolveMeshPathGeneric(
      "robots/robot.urdf",
      "package://pkg/meshes/a.stl",
      map,
      map,
      ""
    );
    expect(resolved).toEqual(meshFile);
  });

  it("resolves relative mesh references", () => {
    const meshFile = file("robots/meshes/a.stl");
    const map = new Map<string, GitHubFile>([[meshFile.path.toLowerCase(), meshFile]]);
    const resolved = resolveMeshPathGeneric("robots/robot.urdf", "meshes/a.stl", map, map, "");
    expect(resolved).toEqual(meshFile);
  });

  it("ignores absolute file:// references", () => {
    const meshFile = file("robots/meshes/a.stl");
    const map = new Map<string, GitHubFile>([[meshFile.path.toLowerCase(), meshFile]]);
    const resolved = resolveMeshPathGeneric("robots/robot.urdf", "file:///abs/a.stl", map, map, "");
    expect(resolved).toBeNull();
  });
});

describe("collectXacroSupportFilesForGitHub", () => {
  it("includes support files across packages for cross-package xacro includes", () => {
    const files: GitHubFile[] = [
      file("pkg_a/package.xml"),
      file("pkg_a/urdf/main.xacro"),
      file("pkg_b/package.xml"),
      file("pkg_b/urdf/shared.xacro"),
      file("pkg_b/config/params.yaml"),
      file("pkg_b/meshes/link.stl"),
    ];

    const support = collectXacroSupportFilesForGitHub(files, "pkg_a/urdf/main.xacro");
    const paths = new Set(support.map((item) => item.path));

    expect(paths.has("pkg_a/urdf/main.xacro")).toBe(true);
    expect(paths.has("pkg_b/urdf/shared.xacro")).toBe(true);
    expect(paths.has("pkg_b/package.xml")).toBe(true);
    expect(paths.has("pkg_b/meshes/link.stl")).toBe(false);
  });

  it("includes trans include files for xacro expansion", () => {
    const files: GitHubFile[] = [
      file("pkg_a/package.xml"),
      file("pkg_a/urdf/main.xacro"),
      file("pkg_a/urdf/main.trans"),
    ];

    const support = collectXacroSupportFilesForGitHub(files, "pkg_a/urdf/main.xacro");
    const paths = new Set(support.map((item) => item.path));

    expect(paths.has("pkg_a/urdf/main.trans")).toBe(true);
  });
});

describe("findURDFCandidates", () => {
  it("prioritizes likely top-level robot files over helper macros", () => {
    const files: GitHubFile[] = [
      file("my_robot_description/urdf/robot.urdf"),
      file("my_robot_description/urdf/common_macro.xacro"),
      dir("my_robot_description/meshes"),
    ];

    const candidates = findURDFCandidates(files);

    expect(candidates.length).toBe(2);
    expect(candidates[0]?.path).toBe("my_robot_description/urdf/robot.urdf");
  });

  it("prefers TIAGo-style robots wrappers over urdf support xacros", () => {
    const files: GitHubFile[] = [
      file("tiago_description/urdf/tiago_base.urdf.xacro"),
      file("tiago_description/urdf/tiago_sensors.xacro"),
      file("tiago_description/robots/tiago.urdf.xacro"),
      dir("tiago_description/meshes"),
    ];

    const candidates = findURDFCandidates(files);

    expect(candidates[0]?.path).toBe("tiago_description/robots/tiago.urdf.xacro");
    expect(candidates[1]?.path).toBe("tiago_description/urdf/tiago_base.urdf.xacro");
  });
});

describe("parseGitHubUrl", () => {
  it("parses branch and subpath from tree URLs", () => {
    expect(
      parseGitHubUrl("https://github.com/ros-industrial/universal_robot/tree/main/ur_description/urdf")
    ).toEqual({
      owner: "ros-industrial",
      repo: "universal_robot",
      branch: "main",
      path: "ur_description/urdf",
    });
  });

  it("decodes encoded branch and path segments from tree URLs", () => {
    expect(
      parseGitHubUrl(
        "https://github.com/acme/robots/tree/feature%2Fcamera-pass/robots/demo%20arm/urdf"
      )
    ).toEqual({
      owner: "acme",
      repo: "robots",
      branch: "feature/camera-pass",
      path: "robots/demo arm/urdf",
    });
  });
});

describe("convertGitHubFilesToFileList dependency resolution", () => {
  it("resolves .xacro requests to existing .urdf.xacro files before expansion", async () => {
    const expandedUrdf = `<?xml version="1.0"?>
<robot name="ur10">
  <link name="base_link">
    <visual><geometry><box size="1 1 1"/></geometry></visual>
  </link>
</robot>`;
    const backendPayloads: Array<{ target_path?: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/ilu/expand-github")) {
        backendPayloads.push(JSON.parse(String(init?.body ?? "{}")) as { target_path?: string });
        return new Response(JSON.stringify({ urdf: expandedUrdf }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    try {
      const files: GitHubFile[] = [
        {
          name: "ur10.urdf.xacro",
          path: "ur_description/urdf/ur10.urdf.xacro",
          type: "file",
          download_url: null,
          sha: "ur10-xacro-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "ur_description/urdf/ur10.xacro",
        "ros-industrial",
        "universal_robot"
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(backendPayloads[0]?.target_path).toBe("ur_description/urdf/ur10.urdf.xacro");
      expect(loadedPaths).toContain("ur_description/urdf/ur10.urdf");
      expect(fetchMock).not.toHaveBeenCalledWith(
        "https://api.github.com/repos/ros-industrial/universal_robot/git/blobs/ur10-xacro-sha",
        expect.anything()
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("resolves the reported ur10e.xacro path to ur10e.urdf.xacro before fetching", async () => {
    const expandedUrdf = `<?xml version="1.0"?>
<robot name="ur10e">
  <link name="base_link">
    <visual><geometry><box size="1 1 1"/></geometry></visual>
  </link>
</robot>`;
    const backendPayloads: Array<{ target_path?: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/ilu/expand-github")) {
        backendPayloads.push(JSON.parse(String(init?.body ?? "{}")) as { target_path?: string });
        return new Response(JSON.stringify({ urdf: expandedUrdf }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    try {
      const files: GitHubFile[] = [
        {
          name: "ur10e.urdf.xacro",
          path: "ur_description/urdf/ur10e.urdf.xacro",
          type: "file",
          download_url: null,
          sha: "ur10e-xacro-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "ur_description/urdf/ur10e.xacro",
        "ros-industrial",
        "universal_robot"
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(backendPayloads[0]?.target_path).toBe("ur_description/urdf/ur10e.urdf.xacro");
      expect(loadedPaths).toContain("ur_description/urdf/ur10e.urdf");
      expect(fetchMock).not.toHaveBeenCalledWith(
        "https://api.github.com/repos/ros-industrial/universal_robot/git/blobs/ur10e-xacro-sha",
        expect.anything()
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("falls back to browser xacro fetching when backend GitHub expansion fails", async () => {
    const xacroContent = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="ur10">
  <link name="base_link"/>
</robot>`;
    const expandedUrdf = `<?xml version="1.0"?>
<robot name="ur10">
  <link name="base_link">
    <visual><geometry><box size="1 1 1"/></geometry></visual>
  </link>
</robot>`;
    const encode = (value: string) => btoa(value);
    const backendPayloads: Array<{ target_path?: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/ilu/expand-github")) {
        return new Response(JSON.stringify({ detail: "backend failed" }), { status: 502 });
      }
      if (url.includes("/ilu/expand")) {
        backendPayloads.push(JSON.parse(String(init?.body ?? "{}")) as { target_path?: string });
        return new Response(JSON.stringify({ urdf: expandedUrdf }), { status: 200 });
      }
      if (url === "https://cdn.jsdelivr.net/gh/ros-industrial/universal_robot/ur_description/urdf/ur10.urdf.xacro") {
        return new Response("not found", { status: 404 });
      }
      if (url === "https://api.github.com/repos/ros-industrial/universal_robot/contents/ur_description/urdf/ur10.urdf.xacro") {
        return new Response(
          JSON.stringify({ content: encode(xacroContent), encoding: "base64" }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    try {
      const files: GitHubFile[] = [
        {
          name: "ur10.urdf.xacro",
          path: "ur_description/urdf/ur10.urdf.xacro",
          type: "file",
          download_url: "https://cdn.jsdelivr.net/gh/ros-industrial/universal_robot/ur_description/urdf/ur10.urdf.xacro",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "ur_description/urdf/ur10.xacro",
        "ros-industrial",
        "universal_robot"
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(backendPayloads[0]?.target_path).toBe("ur_description/urdf/ur10.urdf.xacro");
      expect(loadedPaths).toContain("ur_description/urdf/ur10.urdf");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/repos/ros-industrial/universal_robot/contents/ur_description/urdf/ur10.urdf.xacro",
        expect.any(Object)
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("fetches missing package dependencies from same owner repositories", async () => {
    const urdfContent = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base">
    <visual><geometry><mesh filename="package://franka_description/meshes/link.stl"/></geometry></visual>
  </link>
</robot>`;
    const packageXml = `<package><name>franka_description</name></package>`;
    const encode = (value: string) => btoa(value);

    const responses = new Map<string, Response>([
      [
        "https://api.github.com/repos/frankarobotics/franka_ros/git/blobs/main-urdf-sha",
        new Response(
          JSON.stringify({ content: encode(urdfContent), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/frankarobotics/franka_description",
        new Response(JSON.stringify({ default_branch: "main" }), { status: 200 }),
      ],
      [
        "https://api.github.com/repos/frankarobotics/franka_description/git/trees/main?recursive=1",
        new Response(
          JSON.stringify({
            tree: [
              { path: "package.xml", type: "blob", sha: "dep-pkg-xml-sha", size: 42 },
              { path: "meshes", type: "tree" },
              { path: "meshes/link.stl", type: "blob", sha: "dep-mesh-sha", size: 128 },
            ],
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/frankarobotics/franka_description/git/blobs/dep-pkg-xml-sha",
        new Response(
          JSON.stringify({ content: encode(packageXml), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/frankarobotics/franka_description/git/blobs/dep-mesh-sha",
        new Response(
          JSON.stringify({ content: encode("solid link"), encoding: "base64" }),
          { status: 200 }
        ),
      ],
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = responses.get(url);
      if (response) {
        return response.clone();
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    try {
      const files: GitHubFile[] = [
        {
          name: "robot.urdf",
          path: "robot.urdf",
          type: "file",
          download_url: null,
          sha: "main-urdf-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "robot.urdf",
        "frankarobotics",
        "franka_ros",
        "token"
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(loadedPaths).toContain("robot.urdf");
      expect(loadedPaths).toContain("__deps/franka_description/package.xml");
      expect(loadedPaths).toContain("__deps/franka_description/meshes/link.stl");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("recovers runtime-discovered xacro package dependencies on the same branch", async () => {
    const mainXacro = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="tiago">
  <xacro:include filename="$(find pal_urdf_utils)/urdf/arm_setup.xacro"/>
</robot>`;
    const palUtilsXacro = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="pal_utils">
  <xacro:include filename="$(find \${base_type}_description)/urdf/arm/arm.urdf.xacro"/>
</robot>`;
    const pmb2ArmXacro = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="pmb2_arm">
  <link name="arm_link"/>
</robot>`;
    const expandedUrdf = `<?xml version="1.0"?>
<robot name="tiago">
  <link name="base_link">
    <visual><geometry><box size="1 1 1"/></geometry></visual>
  </link>
</robot>`;
    const encode = (value: string) => btoa(value);
    const xacroPayloads: Array<{ target_path?: string; files?: Array<{ path?: string }> }> = [];

    const responses = new Map<string, Response>([
      [
        "https://api.github.com/repos/pal-robotics/tiago_robot/git/blobs/tiago-main-sha",
        new Response(
          JSON.stringify({ content: encode(mainXacro), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/pal-robotics/pal_urdf_utils/git/trees/humble-devel?recursive=1",
        new Response(
          JSON.stringify({
            tree: [
              { path: "package.xml", type: "blob", sha: "pal-utils-pkg-sha", size: 42 },
              { path: "urdf", type: "tree" },
              { path: "urdf/arm_setup.xacro", type: "blob", sha: "pal-utils-xacro-sha", size: 64 },
            ],
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/pal-robotics/pal_urdf_utils/git/blobs/pal-utils-pkg-sha",
        new Response(
          JSON.stringify({
            content: encode("<package><name>pal_urdf_utils</name></package>"),
            encoding: "base64",
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/pal-robotics/pal_urdf_utils/git/blobs/pal-utils-xacro-sha",
        new Response(
          JSON.stringify({ content: encode(palUtilsXacro), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/pal-robotics/pmb2_robot/git/trees/humble-devel?recursive=1",
        new Response(
          JSON.stringify({
            tree: [
              { path: "pmb2_description", type: "tree" },
              {
                path: "pmb2_description/package.xml",
                type: "blob",
                sha: "pmb2-pkg-sha",
                size: 48,
              },
              { path: "pmb2_description/urdf", type: "tree" },
              { path: "pmb2_description/urdf/arm", type: "tree" },
              {
                path: "pmb2_description/urdf/arm/arm.urdf.xacro",
                type: "blob",
                sha: "pmb2-arm-sha",
                size: 96,
              },
            ],
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/pal-robotics/pmb2_robot/git/blobs/pmb2-pkg-sha",
        new Response(
          JSON.stringify({
            content: encode("<package><name>pmb2_description</name></package>"),
            encoding: "base64",
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/pal-robotics/pmb2_robot/git/blobs/pmb2-arm-sha",
        new Response(
          JSON.stringify({ content: encode(pmb2ArmXacro), encoding: "base64" }),
          { status: 200 }
        ),
      ],
    ]);

    let expandAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/ilu/expand-github")) {
        return new Response(JSON.stringify({ detail: "backend failed" }), { status: 502 });
      }
      if (url.includes("/ilu/expand")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          target_path?: string;
          files?: Array<{ path?: string }>;
        };
        xacroPayloads.push(payload);
        expandAttempt += 1;
        if (expandAttempt === 1) {
          return new Response(
            JSON.stringify({
              detail: "Package 'pmb2_description' not found in uploaded files.",
            }),
            { status: 400 }
          );
        }
        return new Response(JSON.stringify({ urdf: expandedUrdf }), { status: 200 });
      }
      const response = responses.get(url);
      if (response) {
        return response.clone();
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    try {
      const files: GitHubFile[] = [
        {
          name: "tiago.urdf.xacro",
          path: "tiago_description/robots/tiago.urdf.xacro",
          type: "file",
          download_url: null,
          sha: "tiago-main-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "tiago_description/robots/tiago.urdf.xacro",
        "pal-robotics",
        "tiago_robot",
        "token",
        { branch: "humble-devel" }
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(expandAttempt).toBe(2);
      expect(
        xacroPayloads[1]?.files?.some(
          (file) => file.path?.endsWith("pmb2_description/urdf/arm/arm.urdf.xacro")
        )
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/repos/pal-robotics/pmb2_robot/git/trees/humble-devel?recursive=1",
        expect.any(Object)
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("retries local xacro packages without refetching the current repository tree", async () => {
    const mainXacro = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="xarm">
  <xacro:include filename="$(find xarm_description)/urdf/common.xacro"/>
  <xacro:common/>
</robot>`;
    const packageXml = `<package><name>xarm_description</name></package>`;
    const commonXacro = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="xarm_description">
  <xacro:macro name="common">
    <link name="base_link"/>
  </xacro:macro>
</robot>`;
    const expandedUrdf = `<?xml version="1.0"?>
<robot name="xarm">
  <link name="base_link">
    <visual><geometry><box size="1 1 1"/></geometry></visual>
  </link>
</robot>`;
    const encode = (value: string) => btoa(value);

    let expandAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/ilu/expand-github")) {
        return new Response(JSON.stringify({ detail: "backend failed" }), { status: 502 });
      }
      if (url.includes("/ilu/expand")) {
        expandAttempt += 1;
        if (expandAttempt === 1) {
          return new Response(
            JSON.stringify({
              detail: "Package 'xarm_description' not found in uploaded files.",
            }),
            { status: 400 }
          );
        }
        return new Response(JSON.stringify({ urdf: expandedUrdf }), { status: 200 });
      }
      if (url === "https://api.github.com/repos/xarm-developer/xarm_ros/git/blobs/main-xacro-sha") {
        return new Response(
          JSON.stringify({ content: encode(mainXacro), encoding: "base64" }),
          { status: 200 }
        );
      }
      if (url === "https://api.github.com/repos/xarm-developer/xarm_ros/git/blobs/xarm-package-sha") {
        return new Response(
          JSON.stringify({ content: encode(packageXml), encoding: "base64" }),
          { status: 200 }
        );
      }
      if (url === "https://api.github.com/repos/xarm-developer/xarm_ros/git/blobs/xarm-common-sha") {
        return new Response(
          JSON.stringify({ content: encode(commonXacro), encoding: "base64" }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);

    try {
      const files: GitHubFile[] = [
        {
          name: "robot.urdf.xacro",
          path: "xarm_description/robots/robot.urdf.xacro",
          type: "file",
          download_url: null,
          sha: "main-xacro-sha",
          encoding: "sha",
        },
        {
          name: "package.xml",
          path: "xarm_description/package.xml",
          type: "file",
          download_url: null,
          sha: "xarm-package-sha",
          encoding: "sha",
        },
        {
          name: "common.xacro",
          path: "xarm_description/urdf/common.xacro",
          type: "file",
          download_url: null,
          sha: "xarm-common-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "xarm_description/robots/robot.urdf.xacro",
        "xarm-developer",
        "xarm_ros",
        "token",
        { branch: "main" }
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(expandAttempt).toBe(2);
      expect(loadedPaths).toContain("xarm_description/robots/robot.urdf");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("https://api.github.com/repos/xarm-developer/xarm_ros/git/trees/")
        )
      ).toBe(false);
      expect(
        fetchMock.mock.calls.some(
          ([input]) => String(input) === "https://api.github.com/repos/xarm-developer/xarm_ros"
        )
      ).toBe(false);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("includes package texture resources for relative mesh references", async () => {
    const urdfContent = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base">
    <visual><geometry><mesh filename="../meshes/visual/base.dae"/></geometry></visual>
  </link>
</robot>`;
    const encode = (value: string) => btoa(value);

    const responses = new Map<string, Response>([
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/robot-urdf-dae-sha",
        new Response(
          JSON.stringify({ content: encode(urdfContent), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/base-dae-sha",
        new Response(
          JSON.stringify({
            content: encode(
              `<COLLADA>
  <library_images>
    <image id="base_texture">
      <init_from>../../textures/base.png</init_from>
    </image>
  </library_images>
</COLLADA>`
            ),
            encoding: "base64",
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/base-png-sha",
        new Response(
          JSON.stringify({ content: encode("pngdata"), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/unused-png-sha",
        new Response(
          JSON.stringify({ content: encode("unused-pngdata"), encoding: "base64" }),
          { status: 200 }
        ),
      ],
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = responses.get(url);
      if (response) {
        return response.clone();
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);

    try {
      const files: GitHubFile[] = [
        {
          name: "package.xml",
          path: "demo_robot/package.xml",
          type: "file",
          download_url: null,
          sha: "pkg-xml-sha",
          encoding: "sha",
        },
        {
          name: "robot.urdf",
          path: "demo_robot/urdf/robot.urdf",
          type: "file",
          download_url: null,
          sha: "robot-urdf-dae-sha",
          encoding: "sha",
        },
        {
          name: "base.dae",
          path: "demo_robot/meshes/visual/base.dae",
          type: "file",
          download_url: null,
          sha: "base-dae-sha",
          encoding: "sha",
        },
        {
          name: "base.png",
          path: "demo_robot/textures/base.png",
          type: "file",
          download_url: null,
          sha: "base-png-sha",
          encoding: "sha",
        },
        {
          name: "unused.png",
          path: "demo_robot/textures/unused.png",
          type: "file",
          download_url: null,
          sha: "unused-png-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "demo_robot/urdf/robot.urdf",
        "acme",
        "demo_robot"
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(loadedPaths).toContain("demo_robot/meshes/visual/base.dae");
      expect(loadedPaths).toContain("demo_robot/textures/base.png");
      expect(loadedPaths).not.toContain("demo_robot/textures/unused.png");
      expect(fetchMock).not.toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/demo_robot/git/blobs/unused-png-sha",
        expect.any(Object)
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("loads obj material textures without fetching unrelated package textures", async () => {
    const urdfContent = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base">
    <visual><geometry><mesh filename="../meshes/base.obj"/></geometry></visual>
  </link>
</robot>`;
    const encode = (value: string) => btoa(value);

    const responses = new Map<string, Response>([
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/robot-urdf-obj-sha",
        new Response(
          JSON.stringify({ content: encode(urdfContent), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/base-obj-sha",
        new Response(
          JSON.stringify({ content: encode("mtllib base.mtl\nusemtl base\n"), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/base-mtl-sha",
        new Response(
          JSON.stringify({
            content: encode("newmtl base\nmap_Kd -s 1 textures/base.png\n"),
            encoding: "base64",
          }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/base-texture-sha",
        new Response(
          JSON.stringify({ content: encode("pngdata"), encoding: "base64" }),
          { status: 200 }
        ),
      ],
      [
        "https://api.github.com/repos/acme/demo_robot/git/blobs/unused-texture-sha",
        new Response(
          JSON.stringify({ content: encode("unused-pngdata"), encoding: "base64" }),
          { status: 200 }
        ),
      ],
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = responses.get(url);
      if (response) {
        return response.clone();
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);

    try {
      const files: GitHubFile[] = [
        {
          name: "robot.urdf",
          path: "demo_robot/urdf/robot.urdf",
          type: "file",
          download_url: null,
          sha: "robot-urdf-obj-sha",
          encoding: "sha",
        },
        {
          name: "base.obj",
          path: "demo_robot/meshes/base.obj",
          type: "file",
          download_url: null,
          sha: "base-obj-sha",
          encoding: "sha",
        },
        {
          name: "base.mtl",
          path: "demo_robot/meshes/base.mtl",
          type: "file",
          download_url: null,
          sha: "base-mtl-sha",
          encoding: "sha",
        },
        {
          name: "base.png",
          path: "demo_robot/meshes/textures/base.png",
          type: "file",
          download_url: null,
          sha: "base-texture-sha",
          encoding: "sha",
        },
        {
          name: "unused.png",
          path: "demo_robot/meshes/textures/unused.png",
          type: "file",
          download_url: null,
          sha: "unused-texture-sha",
          encoding: "sha",
        },
      ];

      const fileList = await convertGitHubFilesToFileList(
        files,
        "demo_robot/urdf/robot.urdf",
        "acme",
        "demo_robot"
      );
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(loadedPaths).toContain("demo_robot/meshes/base.obj");
      expect(loadedPaths).toContain("demo_robot/meshes/base.mtl");
      expect(loadedPaths).toContain("demo_robot/meshes/textures/base.png");
      expect(loadedPaths).not.toContain("demo_robot/meshes/textures/unused.png");
      expect(fetchMock).not.toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/demo_robot/git/blobs/unused-texture-sha",
        expect.any(Object)
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });
});

describe("github auth fallback behavior", () => {
  it("falls back to anonymous requests for public repo tree fetch when token is invalid", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const branchUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const badCredsBody = JSON.stringify({ message: "Bad credentials" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers ?? {});
      const isAuthed = headers.has("Authorization");

      if (url === branchUrl) {
        return isAuthed
          ? new Response(badCredsBody, { status: 401 })
          : new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
      }
      if (url === treeUrl) {
        return isAuthed
          ? new Response(badCredsBody, { status: 401 })
          : new Response(
              JSON.stringify({
                tree: [{ path: "robot.urdf", type: "blob", sha: "sha-robot", size: 12 }],
              }),
              { status: 200 }
            );
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const files = await fetchRepoContents(owner, repo, "", "invalid-token");
      expect(files.some((f) => f.path === "robot.urdf" && f.type === "file")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("falls back to anonymous visibility check when token is invalid", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const badCredsBody = JSON.stringify({ message: "Bad credentials" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === "string" ? input : input.toString();
      if (requestUrl !== url) {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers(init?.headers ?? {});
      const isAuthed = headers.has("Authorization");
      return isAuthed
        ? new Response(badCredsBody, { status: 401 })
        : new Response(JSON.stringify({ private: false }), { status: 200 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const visibility = await checkRepoVisibility(owner, repo, "invalid-token");
      expect(visibility).toEqual({ isPublic: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("retries through local proxy when direct GitHub API requests fail in dev runtime", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const directBranchUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const directTreeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const proxyBranchUrl = `/__github_api/repos/${owner}/${repo}`;
    const proxyTreeUrl = `/__github_api/repos/${owner}/${repo}/git/trees/main?recursive=1`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === directBranchUrl || url === directTreeUrl) {
        throw new TypeError("Failed to fetch");
      }
      if (url === proxyBranchUrl) {
        return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
      }
      if (url === proxyTreeUrl) {
        return new Response(
          JSON.stringify({
            tree: [{ path: "robot.urdf", type: "blob", sha: "sha-robot", size: 12 }],
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const files = await fetchRepoContents(owner, repo, "", "token");
      expect(files.some((f) => f.path === "robot.urdf")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("surfaces actionable network errors when GitHub API is unreachable", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      await expect(fetchRepoContents("bulletphysics", "bullet3", "", "token")).rejects.toThrow(
        /Network error reaching GitHub source/
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("retries GitHub tree fetches after abuse detection throttles", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const branchUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const abuseBody = JSON.stringify({
      documentation_url: "https://developer.github.com/v3/#abuse-rate-limits",
      message: "You have triggered an abuse detection mechanism. Please wait a few minutes before you try again.",
    });

    const originalFetch = globalThis.fetch;
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    let treeAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === branchUrl) {
        return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
      }
      if (url === treeUrl) {
        treeAttempts += 1;
        if (treeAttempts === 1) {
          return new Response(abuseBody, {
            status: 403,
            headers: {
              "retry-after": "0.01",
            },
          });
        }
        return new Response(
          JSON.stringify({
            tree: [{ path: "robot.urdf", type: "blob", sha: "sha-robot", size: 12 }],
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const files = await fetchRepoContents(owner, repo, "", "token");
      expect(files.some((f) => f.path === "robot.urdf")).toBe(true);
      expect(treeAttempts).toBe(2);
    } finally {
      randomSpy.mockRestore();
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("falls back to the public mirror when GitHub API rate limit is exceeded", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const apiRepoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const backendUrl = `http://127.0.0.1:8000/ilu/repo-contents?owner=${owner}&repo=${repo}`;
    const jsDelivrFlatUrl = `https://data.jsdelivr.com/v1/package/gh/${owner}/${repo}/flat`;
    const jsDelivrFileUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}/robot.urdf`;
    const apiRateLimitHeaders = { "x-ratelimit-remaining": "0" };
    const robotUrdf = `<?xml version="1.0"?>
<robot name="archive_bot">
  <link name="base">
    <visual><geometry><box size="1 1 1"/></geometry></visual>
  </link>
</robot>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === apiRepoUrl) {
        return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: apiRateLimitHeaders,
        });
      }
      if (url === jsDelivrFlatUrl) {
        return new Response(
          JSON.stringify({
            files: [{ name: "/robot.urdf", size: robotUrdf.length }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url === jsDelivrFileUrl) {
        return new Response(robotUrdf, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      if (url === backendUrl) {
        return new Response("backend unavailable", { status: 502 });
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    const originalDataTransfer = (globalThis as typeof globalThis & { DataTransfer?: typeof DataTransfer }).DataTransfer;
    class DataTransferMock {
      private readonly _files: File[] = [];
      items = {
        add: (file: File) => {
          this._files.push(file);
        },
      };
      get files(): FileList {
        return this._files as unknown as FileList;
      }
    }

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    try {
      const files = await fetchRepoContents(owner, repo, "", "token");
      expect(
        files.some((item) => item.path === "robot.urdf" && item.download_url === jsDelivrFileUrl)
      ).toBe(true);

      const fileList = await convertGitHubFilesToFileList(files, "robot.urdf", owner, repo, "token");
      const loadedPaths = Array.from(fileList).map(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      );

      expect(loadedPaths).toContain("robot.urdf");
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      if (originalDataTransfer) {
        vi.stubGlobal("DataTransfer", originalDataTransfer);
      }
    }
  });

  it("loads public root repositories from the backend proxy first when no token is provided", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const backendUrl = `http://127.0.0.1:8000/ilu/repo-contents?owner=${owner}&repo=${repo}`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === backendUrl) {
        return new Response(
          JSON.stringify([
            {
              name: "robot.urdf",
              path: "robot.urdf",
              type: "file",
              download_url: "/ilu/file?owner=acme&repo=public_robot&path=robot.urdf&branch=main",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("unexpected api call", { status: 500 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const files = await fetchRepoContents(owner, repo);
      expect(files.some((item) => item.path === "robot.urdf")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(backendUrl);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("loads public scoped repository paths from the backend proxy first when no token is provided", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const path = "robots/demo";
    const backendUrl = `http://127.0.0.1:8000/ilu/repo-contents?owner=${owner}&repo=${repo}&path=robots%2Fdemo`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === backendUrl) {
        return new Response(
          JSON.stringify([
            {
              name: "demo.urdf",
              path: "robots/demo/demo.urdf",
              type: "file",
              download_url: "/ilu/file?owner=acme&repo=public_robot&path=robots%2Fdemo%2Fdemo.urdf&branch=main",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("unexpected api call", { status: 500 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const files = await fetchRepoContents(owner, repo, path);
      expect(files.some((item) => item.path === "robots/demo/demo.urdf")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(backendUrl);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("falls back to the public mirror when the backend proxy listing fails", async () => {
    const owner = "acme";
    const repo = "public_robot";
    const jsDelivrFlatUrl = `https://data.jsdelivr.com/v1/package/gh/${owner}/${repo}/flat`;
    const backendUrl = `http://127.0.0.1:8000/ilu/repo-contents?owner=${owner}&repo=${repo}`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === backendUrl) {
        return new Response("proxy unavailable", { status: 502 });
      }
      if (url === jsDelivrFlatUrl) {
        return new Response(
          JSON.stringify({
            files: [{ name: "/robot.urdf", size: 32 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("unexpected call", { status: 500 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const files = await fetchRepoContents(owner, repo);
      expect(files.some((item) => item.path === "robot.urdf")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(backendUrl);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(jsDelivrFlatUrl);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("reuses cached repository tree for repeated fetches in the same session", async () => {
    const owner = "acme";
    const repo = "cached_robot";
    const branchUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === branchUrl) {
        return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
      }
      if (url === treeUrl) {
        return new Response(
          JSON.stringify({
            tree: [{ path: "robot.urdf", type: "blob", sha: "sha-robot", size: 12 }],
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const first = await fetchRepoContents(owner, repo, "", "token-a");
      const second = await fetchRepoContents(owner, repo, "", "token-a");
      expect(first.some((f) => f.path === "robot.urdf")).toBe(true);
      expect(second.some((f) => f.path === "robot.urdf")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(window.localStorage.length).toBe(0);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
