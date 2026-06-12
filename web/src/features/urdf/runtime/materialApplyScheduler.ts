import type * as THREE from "three";

import { applyUrdfVisualMaterials } from "@/features/urdf/runtime/materialApply";
import { URDF_VISUAL_MATERIAL_APPLY_FRAMELESS_DELAY_MS } from "@/features/urdf/runtime/materialApplySchedulerParams";

type FrameRequest = (callback: FrameRequestCallback) => number;
type FrameCancel = (frameId: number) => void;

type UrdfVisualMaterialApplySchedulerOptions = {
  applyMaterials?: (root: THREE.Object3D) => void;
  cancelFrame?: FrameCancel;
  requestFrame?: FrameRequest;
  shouldApply?: (root: THREE.Object3D) => boolean;
};

export type UrdfVisualMaterialApplyScheduler = {
  cancel: () => void;
  flush: (root?: THREE.Object3D | null) => void;
  schedule: (root: THREE.Object3D | null | undefined) => void;
};

const defaultRequestFrame: FrameRequest = (callback) => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return window.setTimeout(
    () => callback(typeof performance !== "undefined" ? performance.now() : Date.now()),
    URDF_VISUAL_MATERIAL_APPLY_FRAMELESS_DELAY_MS
  );
};

const defaultCancelFrame: FrameCancel = (frameId) => {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameId);
    return;
  }
  window.clearTimeout(frameId);
};

export const createUrdfVisualMaterialApplyScheduler = ({
  applyMaterials = applyUrdfVisualMaterials,
  cancelFrame = defaultCancelFrame,
  requestFrame = defaultRequestFrame,
  shouldApply,
}: UrdfVisualMaterialApplySchedulerOptions = {}): UrdfVisualMaterialApplyScheduler => {
  let scheduledFrameId: number | null = null;
  let pendingRoot: THREE.Object3D | null = null;

  const applyPendingRoot = (root: THREE.Object3D | null) => {
    if (!root) return;
    if (shouldApply && !shouldApply(root)) return;
    applyMaterials(root);
  };

  const cancel = () => {
    if (scheduledFrameId !== null) {
      cancelFrame(scheduledFrameId);
      scheduledFrameId = null;
    }
    pendingRoot = null;
  };

  const flush = (root?: THREE.Object3D | null) => {
    const targetRoot = root ?? pendingRoot;
    cancel();
    applyPendingRoot(targetRoot);
  };

  const schedule = (root: THREE.Object3D | null | undefined) => {
    if (!root) return;
    pendingRoot = root;
    if (scheduledFrameId !== null) return;
    scheduledFrameId = requestFrame(() => {
      scheduledFrameId = null;
      const targetRoot = pendingRoot;
      pendingRoot = null;
      applyPendingRoot(targetRoot);
    });
  };

  return {
    cancel,
    flush,
    schedule,
  };
};
