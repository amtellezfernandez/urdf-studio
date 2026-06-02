import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { MeshFiles } from "@/shared/types/feature";
import {
  createUrdfMeshLoadCallback,
  loadMeshObjectForUrdfReference,
} from "./urdfMeshLoader";

const makeBlob = (label: string) => new Blob([label], { type: "application/octet-stream" });

describe("urdfMeshLoader", () => {
  it("returns missing when no mesh candidate resolves", async () => {
    const result = await loadMeshObjectForUrdfReference({
      ref: "package://missing_pkg/meshes/link.stl",
      meshFiles: {},
      gpuMode: "low",
    });

    expect(result).toEqual({ status: "missing" });
  });

  it("loads a mesh using extension fallback candidates", async () => {
    const meshFiles: MeshFiles = {
      "pkg/meshes/link.stl": makeBlob("mesh"),
    };
    const instantiateMeshObject = vi.fn(async () => new THREE.Group());

    const result = await loadMeshObjectForUrdfReference({
      ref: "package://pkg/meshes/link.obj",
      meshFiles,
      packageRoots: { pkg: ["pkg"] },
      urdfBasePath: "pkg/urdf",
      gpuMode: "high",
      instantiateMeshObject,
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error("Expected loaded result");
    }
    expect(result.resolvedPath).toBe("pkg/meshes/link.stl");
    expect(instantiateMeshObject).toHaveBeenCalledTimes(1);
  });

  it("loads a mesh using meshes-assets alias fallback", async () => {
    const meshFiles: MeshFiles = {
      "google_barkour_v0/assets/head.stl": makeBlob("mesh"),
    };
    const instantiateMeshObject = vi.fn(async () => new THREE.Group());

    const result = await loadMeshObjectForUrdfReference({
      ref: "meshes/head.stl",
      meshFiles,
      urdfBasePath: "google_barkour_v0",
      gpuMode: "high",
      instantiateMeshObject,
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error("Expected loaded result");
    }
    expect(result.resolvedPath).toBe("google_barkour_v0/assets/head.stl");
    expect(instantiateMeshObject).toHaveBeenCalledTimes(1);
  });

  it("uses missing fallback in URDF callback wrapper", async () => {
    const fallback = new THREE.Group();
    const loadMeshCb = createUrdfMeshLoadCallback({
      meshFiles: {},
      gpuMode: "low",
      onMissing: () => fallback,
    });

    await new Promise<void>((resolve, reject) => {
      loadMeshCb(
        "package://missing_pkg/meshes/link.stl",
        new THREE.LoadingManager(),
        (mesh, error) => {
          try {
            expect(mesh).toBe(fallback);
            expect(error).toBeUndefined();
            resolve();
          } catch (assertErr) {
            reject(assertErr);
          }
        }
      );
    });
  });

  it("propagates errors when callback fallback is not provided", async () => {
    const meshFiles: MeshFiles = {
      "pkg/meshes/link.stl": makeBlob("mesh"),
    };
    const instantiateMeshObject = vi.fn(async () => {
      throw new Error("decode failed");
    });
    const loadMeshCb = createUrdfMeshLoadCallback({
      meshFiles,
      urdfBasePath: "pkg/urdf",
      packageRoots: { pkg: ["pkg"] },
      gpuMode: "low",
      instantiateMeshObject,
    });

    await new Promise<void>((resolve, reject) => {
      loadMeshCb("package://pkg/meshes/link.stl", new THREE.LoadingManager(), (mesh, error) => {
        try {
          expect(mesh).toBeNull();
          expect(error).toBeInstanceOf(Error);
          expect(error?.message).toContain("decode failed");
          resolve();
        } catch (assertErr) {
          reject(assertErr);
        }
      });
    });
  });

  it("resolves gpu mode lazily via resolver function", async () => {
    const meshFiles: MeshFiles = {
      "pkg/meshes/link.stl": makeBlob("mesh"),
    };
    let currentMode: "low" | "high" = "low";
    const instantiateMeshObject = vi.fn(async () => new THREE.Group());

    currentMode = "high";
    await loadMeshObjectForUrdfReference({
      ref: "package://pkg/meshes/link.stl",
      meshFiles,
      packageRoots: { pkg: ["pkg"] },
      urdfBasePath: "pkg/urdf",
      gpuMode: () => currentMode,
      instantiateMeshObject,
    });

    expect(instantiateMeshObject).toHaveBeenCalledTimes(1);
    expect(instantiateMeshObject).toHaveBeenCalledWith(
      expect.objectContaining({ gpuMode: "high" })
    );
  });

  it("returns aborted and skips fallback when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const onMissing = vi.fn();
    const onError = vi.fn();
    const loadMeshCb = createUrdfMeshLoadCallback({
      meshFiles: {},
      gpuMode: "low",
      signal: controller.signal,
      onMissing,
      onError,
    });

    await new Promise<void>((resolve, reject) => {
      loadMeshCb("package://missing_pkg/meshes/link.stl", new THREE.LoadingManager(), (mesh, error) => {
        try {
          expect(mesh).toBeNull();
          expect(error).toBeUndefined();
          expect(onMissing).not.toHaveBeenCalled();
          expect(onError).not.toHaveBeenCalled();
          resolve();
        } catch (assertErr) {
          reject(assertErr);
        }
      });
    });
  });

  it("returns aborted when signal is aborted during mesh instantiate", async () => {
    const controller = new AbortController();
    const meshFiles: MeshFiles = {
      "pkg/meshes/link.stl": makeBlob("mesh"),
    };

    const result = await loadMeshObjectForUrdfReference({
      ref: "package://pkg/meshes/link.stl",
      meshFiles,
      packageRoots: { pkg: ["pkg"] },
      urdfBasePath: "pkg/urdf",
      gpuMode: "low",
      signal: controller.signal,
      instantiateMeshObject: async () => {
        controller.abort();
        return new THREE.Group();
      },
    });

    expect(result).toEqual({ status: "aborted" });
  });

  it("does not call onLoaded if signal aborts before callback resolves", async () => {
    const controller = new AbortController();
    const onLoaded = vi.fn();
    const meshFiles: MeshFiles = {
      "pkg/meshes/link.stl": makeBlob("mesh"),
    };
    const loadMeshCb = createUrdfMeshLoadCallback({
      meshFiles,
      urdfBasePath: "pkg/urdf",
      packageRoots: { pkg: ["pkg"] },
      gpuMode: "low",
      signal: controller.signal,
      instantiateMeshObject: () =>
        new Promise<THREE.Object3D>((resolve) => {
          setTimeout(() => {
            controller.abort();
            resolve(new THREE.Group());
          }, 5);
        }),
      onLoaded,
    });

    await new Promise<void>((resolve, reject) => {
      loadMeshCb("package://pkg/meshes/link.stl", new THREE.LoadingManager(), (mesh, error) => {
        try {
          expect(mesh).toBeNull();
          expect(error).toBeUndefined();
          expect(onLoaded).not.toHaveBeenCalled();
          resolve();
        } catch (assertErr) {
          reject(assertErr);
        }
      });
    });
  });
});
