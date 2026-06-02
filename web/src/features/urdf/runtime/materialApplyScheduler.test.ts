import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { createUrdfVisualMaterialApplyScheduler } from "@/features/urdf/runtime/materialApplyScheduler";

describe("createUrdfVisualMaterialApplyScheduler", () => {
  it("coalesces repeated schedules into one material traversal", () => {
    const scheduledCallbacks: FrameRequestCallback[] = [];
    const root = new THREE.Group();
    const applyMaterials = vi.fn();
    const scheduler = createUrdfVisualMaterialApplyScheduler({
      applyMaterials,
      requestFrame: (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
      cancelFrame: vi.fn(),
    });

    scheduler.schedule(root);
    scheduler.schedule(root);

    expect(applyMaterials).not.toHaveBeenCalled();
    expect(scheduledCallbacks).toHaveLength(1);

    scheduledCallbacks[0]?.(performance.now());

    expect(applyMaterials).toHaveBeenCalledTimes(1);
    expect(applyMaterials).toHaveBeenCalledWith(root);
  });

  it("applies only the latest pending root", () => {
    const scheduledCallbacks: FrameRequestCallback[] = [];
    const firstRoot = new THREE.Group();
    const secondRoot = new THREE.Group();
    const applyMaterials = vi.fn();
    const scheduler = createUrdfVisualMaterialApplyScheduler({
      applyMaterials,
      requestFrame: (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
      cancelFrame: vi.fn(),
    });

    scheduler.schedule(firstRoot);
    scheduler.schedule(secondRoot);
    scheduledCallbacks[0]?.(performance.now());

    expect(applyMaterials).toHaveBeenCalledTimes(1);
    expect(applyMaterials).toHaveBeenCalledWith(secondRoot);
  });

  it("flushes immediately and cancels the pending frame", () => {
    const cancelFrame = vi.fn();
    const root = new THREE.Group();
    const applyMaterials = vi.fn();
    const scheduler = createUrdfVisualMaterialApplyScheduler({
      applyMaterials,
      requestFrame: () => 42,
      cancelFrame,
    });

    scheduler.schedule(root);
    scheduler.flush();

    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(applyMaterials).toHaveBeenCalledTimes(1);
    expect(applyMaterials).toHaveBeenCalledWith(root);
  });

  it("skips cancelled roots", () => {
    const scheduledCallbacks: FrameRequestCallback[] = [];
    const root = new THREE.Group();
    const applyMaterials = vi.fn();
    const scheduler = createUrdfVisualMaterialApplyScheduler({
      applyMaterials,
      requestFrame: (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
      cancelFrame: vi.fn(),
      shouldApply: () => false,
    });

    scheduler.schedule(root);
    scheduledCallbacks[0]?.(performance.now());

    expect(applyMaterials).not.toHaveBeenCalled();
  });
});
