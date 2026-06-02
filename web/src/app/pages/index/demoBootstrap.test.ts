import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadDemoFileListFromManifestUrl,
  loadDemoFileListFromManifestUrls,
  loadDemoFileListProgressivelyFromManifestUrl,
  loadDemoFileListProgressivelyFromManifestUrls,
} from "@/app/pages/index/demoBootstrap";

class DataTransferMock {
  private readonly filesInternal: File[] = [];

  readonly items = {
    add: (file: File) => {
      this.filesInternal.push(file);
    },
  };

  get files(): FileList {
    return this.filesInternal as unknown as FileList;
  }
}

const MANIFEST_URL = "https://example.com/demo/manifest.json";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadDemoFileListFromManifestUrl", () => {
  it("loads manifest assets and preserves webkitRelativePath", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const requestedUrls: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === MANIFEST_URL) {
        return new Response(
          JSON.stringify({
            label: "Demo Robot",
            files: [
              { path: "robot.urdf", url: "robot.urdf", mime: "application/xml" },
              { path: "assets/base.stl", url: "assets/base.stl" },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url.endsWith("/robot.urdf")) {
        return new Response("<robot name='demo'/>", {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      if (url.endsWith("/assets/base.stl")) {
        return new Response("solid base", {
          status: 200,
          headers: { "Content-Type": "model/stl" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const fileList = await loadDemoFileListFromManifestUrl(MANIFEST_URL, fetchMock);
    const files = Array.from(fileList);

    expect(requestedUrls).toEqual([
      MANIFEST_URL,
      "https://example.com/demo/robot.urdf",
      "https://example.com/demo/assets/base.stl",
    ]);
    expect(files.map((file) => file.name)).toEqual(["robot.urdf", "base.stl"]);
    expect(
      files.map(
        (file) =>
          (file as File & { webkitRelativePath?: string }).webkitRelativePath
      )
    ).toEqual(["robot.urdf", "assets/base.stl"]);
  });

  it("loads large assets even when Response.blob would fail", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);

    const largeBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === MANIFEST_URL) {
        return new Response(
          JSON.stringify({
            files: [{ path: "meshes/base.stl", url: "meshes/base.stl", mime: "model/stl" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url.endsWith("/meshes/base.stl")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "model/stl" }),
          arrayBuffer: vi.fn(async () => largeBuffer),
          blob: vi.fn(async () => {
            throw new TypeError("Failed to fetch");
          }),
        } as unknown as Response;
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const fileList = await loadDemoFileListFromManifestUrl(MANIFEST_URL, fetchMock);
    const files = Array.from(fileList);

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("base.stl");
    expect(files[0]?.type).toBe("model/stl");
    await expect(files[0]?.arrayBuffer()).resolves.toEqual(largeBuffer);
  });

  it("reuses duplicate manifest asset URLs without refetching", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const requestedUrls: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === MANIFEST_URL) {
        return new Response(
          JSON.stringify({
            files: [
              { path: "meshes/wheel-left.stl", url: "meshes/wheel.stl", mime: "model/stl" },
              { path: "meshes/wheel-right.stl", url: "meshes/wheel.stl", mime: "model/stl" },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url.endsWith("/meshes/wheel.stl")) {
        return new Response("solid wheel", {
          status: 200,
          headers: { "Content-Type": "model/stl" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const fileList = await loadDemoFileListFromManifestUrl(MANIFEST_URL, fetchMock);
    const files = Array.from(fileList);

    expect(requestedUrls).toEqual([
      MANIFEST_URL,
      "https://example.com/demo/meshes/wheel.stl",
    ]);
    expect(files.map((file) => file.name)).toEqual(["wheel-left.stl", "wheel-right.stl"]);
    expect(
      files.map(
        (file) =>
          (file as File & { webkitRelativePath?: string }).webkitRelativePath
      )
    ).toEqual(["meshes/wheel-left.stl", "meshes/wheel-right.stl"]);
  });

  it("rejects invalid manifest payloads", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const fetchMock: typeof fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ label: "missing-files" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(loadDemoFileListFromManifestUrl(MANIFEST_URL, fetchMock)).rejects.toThrow(
      "Demo manifest does not include files."
    );
  });

  it("resolves relative manifest URLs against window.location", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/demo/",
      },
    });
    const requestedUrls: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "https://example.com/demo/manifest.json") {
        return new Response(
          JSON.stringify({
            files: [{ path: "robot.urdf", url: "robot.urdf", mime: "application/xml" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url === "https://example.com/demo/robot.urdf") {
        return new Response("<robot name='demo'/>", {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await loadDemoFileListFromManifestUrl("manifest.json", fetchMock);
    expect(requestedUrls).toEqual([
      "https://example.com/demo/manifest.json",
      "https://example.com/demo/robot.urdf",
    ]);
  });

  it("falls back to next manifest URL when primary source fails", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const requestedUrls: string[] = [];
    const primaryManifest = "https://bad.example.com/demo/manifest.json";
    const fallbackManifest = "https://example.com/demo/manifest.json";

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === primaryManifest) {
        throw new Error("Failed to fetch");
      }
      if (url === fallbackManifest) {
        return new Response(
          JSON.stringify({
            files: [{ path: "robot.urdf", url: "robot.urdf", mime: "application/xml" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url === "https://example.com/demo/robot.urdf") {
        return new Response("<robot name='demo'/>", {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const fileList = await loadDemoFileListFromManifestUrls(
      [primaryManifest, fallbackManifest],
      fetchMock
    );
    const files = Array.from(fileList);

    expect(files.map((file) => file.name)).toEqual(["robot.urdf"]);
    expect(requestedUrls).toEqual([
      primaryManifest,
      fallbackManifest,
      "https://example.com/demo/robot.urdf",
    ]);
  });

  it("loads the primary URDF before progressive asset hydration is requested", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const requestedUrls: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === MANIFEST_URL) {
        return new Response(
          JSON.stringify({
            files: [
              { path: "robots/lekiwi.urdf", url: "robots/lekiwi.urdf", mime: "application/xml" },
              { path: "meshes/base.stl", url: "meshes/base.stl", mime: "model/stl" },
              { path: "meshes/wheel.stl", url: "meshes/wheel.stl", mime: "model/stl" },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url === "https://example.com/demo/robots/lekiwi.urdf") {
        return new Response("<robot name='lekiwi'/>", {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      if (url === "https://example.com/demo/meshes/base.stl") {
        return new Response("solid base", {
          status: 200,
          headers: { "Content-Type": "model/stl" },
        });
      }
      if (url === "https://example.com/demo/meshes/wheel.stl") {
        return new Response("solid wheel", {
          status: 200,
          headers: { "Content-Type": "model/stl" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const progressiveFileList = await loadDemoFileListProgressivelyFromManifestUrl(
      MANIFEST_URL,
      fetchMock
    );

    expect(requestedUrls).toEqual([
      MANIFEST_URL,
      "https://example.com/demo/robots/lekiwi.urdf",
    ]);
    expect(Array.from(progressiveFileList.initialFileList).map((file) => file.name)).toEqual([
      "lekiwi.urdf",
    ]);

    const remainingFiles = Array.from(await progressiveFileList.loadRemainingFileList());

    expect(requestedUrls).toEqual([
      MANIFEST_URL,
      "https://example.com/demo/robots/lekiwi.urdf",
      "https://example.com/demo/meshes/base.stl",
      "https://example.com/demo/meshes/wheel.stl",
    ]);
    expect(remainingFiles.map((file) => file.name)).toEqual(["base.stl", "wheel.stl"]);
    expect(
      remainingFiles.map(
        (file) =>
          (file as File & { webkitRelativePath?: string }).webkitRelativePath
      )
    ).toEqual(["meshes/base.stl", "meshes/wheel.stl"]);
  });

  it("falls back to the next progressive manifest URL when the primary cannot provide a URDF", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const primaryManifest = "https://bad.example.com/demo/manifest.json";
    const fallbackManifest = "https://example.com/demo/manifest.json";
    const requestedUrls: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === primaryManifest) {
        return new Response(
          JSON.stringify({
            files: [{ path: "meshes/base.stl", url: "meshes/base.stl", mime: "model/stl" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url === fallbackManifest) {
        return new Response(
          JSON.stringify({
            files: [{ path: "lekiwi.urdf", url: "lekiwi.urdf", mime: "application/xml" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url === "https://example.com/demo/lekiwi.urdf") {
        return new Response("<robot name='lekiwi'/>", {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const progressiveFileList = await loadDemoFileListProgressivelyFromManifestUrls(
      [primaryManifest, fallbackManifest],
      fetchMock
    );

    expect(Array.from(progressiveFileList.initialFileList).map((file) => file.name)).toEqual([
      "lekiwi.urdf",
    ]);
    expect(requestedUrls).toEqual([
      primaryManifest,
      fallbackManifest,
      "https://example.com/demo/lekiwi.urdf",
    ]);
  });

  it("fails with detailed reasons when all manifest sources fail", async () => {
    vi.stubGlobal("DataTransfer", DataTransferMock as unknown as typeof DataTransfer);
    const fetchMock: typeof fetch = vi.fn(async () => {
      throw new Error("Failed to fetch");
    }) as typeof fetch;

    await expect(
      loadDemoFileListFromManifestUrls(
        [
          "https://bad.example.com/demo/manifest.json",
          "https://other.example.com/demo/manifest.json",
        ],
        fetchMock
      )
    ).rejects.toThrow("Demo bootstrap failed for all manifest sources.");
  });
});
