import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const { guardedFetchMock } = vi.hoisted(() => ({
  guardedFetchMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: guardedFetchMock,
}));

vi.mock("@/shared/config/runtime", () => ({
  IKD_BASE_URL: "http://localhost:8088",
  IKD_RUNTIME_CONFIG: {
    enabled: true,
  },
}));

import type { CreatedObject } from "@/features/objects";
import {
  cancelIkdApproachTask,
  lockIkdApproachTask,
} from "@/features/viewer/ikdApproachTask";

const createObject = (overrides: Partial<CreatedObject> = {}): CreatedObject => ({
  id: "object-0",
  type: "cube",
  position: new THREE.Vector3(1, 2, 3),
  rotation: new THREE.Euler(0, 0, 0, "XYZ"),
  size: new THREE.Vector3(0.4, 0.2, 0.2),
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
  ikTargetType: "punctual",
  ...overrides,
});

const ORBIT_DEFAULTS = {
  radius: 0.5,
  inclinationDeg: 45,
  phaseDeg: 0,
  secondaryOffsetDeg: 180,
};

describe("ikdApproachTask", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("falls back to a local locked task when IKD scene publish throws", async () => {
    guardedFetchMock.mockRejectedValueOnce(new Error("network down"));

    const object = createObject();
    const result = await lockIkdApproachTask({
      object,
      objects: [object],
      orbitDefaults: ORBIT_DEFAULTS,
    });

    expect(result.taskId).toBe(0);
    expect(result.lockedObject.id).toBe(object.id);
    expect(result.objectTargetPositionWorld).toEqual([1, 2, 3]);
    expect(result.isOrbitTarget).toBe(false);
  });

  it("falls back to a local locked task when IKD task start rejects", async () => {
    guardedFetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500, statusText: "Server Error" }));

    const object = createObject();
    const result = await lockIkdApproachTask({
      object,
      objects: [object],
      orbitDefaults: ORBIT_DEFAULTS,
    });

    expect(result.taskId).toBe(0);
    expect(result.lockedObject.id).toBe(object.id);
    expect(result.objectTargetPositionWorld).toEqual([1, 2, 3]);
  });

  it("does not call IKD cancel for local-only task ids", async () => {
    const cancelled = await cancelIkdApproachTask(0);

    expect(cancelled).toBe(false);
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it("posts IKD task cancellation for active backend task ids", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, task_id: 42 }), { status: 200 })
    );

    const cancelled = await cancelIkdApproachTask(42);

    expect(cancelled).toBe(true);
    expect(guardedFetchMock).toHaveBeenCalledWith(
      "http://localhost:8088/approach/task/cancel",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      expect.objectContaining({
        context: "IKD approach task cancel",
      })
    );
    const requestInit = guardedFetchMock.mock.calls[0]?.[1];
    expect(requestInit).toBeDefined();
    expect(JSON.parse((requestInit as RequestInit).body as string)).toEqual({
      schema_version: "1",
      task_id: 42,
    });
  });
});
