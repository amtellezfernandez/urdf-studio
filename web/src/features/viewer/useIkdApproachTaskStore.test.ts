import { describe, expect, it } from "vitest";
import {
  reduceIkdApproachTaskEvent,
  type IkdApproachTaskStoreSnapshot,
} from "@/features/viewer/useIkdApproachTaskStore";
import type { IkdApproachTaskEvent } from "@/features/viewer/ikdApproachTaskTypes";

const INITIAL_STATE: IkdApproachTaskStoreSnapshot = {
  connectionStatus: "idle",
  lastError: null,
  sceneRevision: null,
  lastEventKind: null,
  activeTask: null,
};

const buildTaskEvent = (
  overrides: Partial<IkdApproachTaskEvent> = {}
): IkdApproachTaskEvent => ({
  schema_version: "1",
  event_kind: "task_started",
  scene_revision: 4,
  object_count: 1,
  emitted_at_ts_ns: 120,
  task: {
    schema_version: "1",
    task_id: 7,
    scene_revision: 4,
    object_id: "box-a",
    target_mode: "punctual",
    state: "locked",
    object: {
      id: "box-a",
      object_type: "cube",
      position_xyz_m: [1, 2, 3],
      rotation_rpy_rad: [0, 0, 0],
      size_xyz_m: [0.4, 0.2, 0.2],
      is_hidden: false,
    },
    object_target_position_xyz_m: [1, 2, 3],
    created_at_ts_ns: 100,
    updated_at_ts_ns: 120,
  },
  ...overrides,
});

describe("useIkdApproachTaskStore", () => {
  it("replaces the active task from streamed task events", () => {
    const next = reduceIkdApproachTaskEvent(INITIAL_STATE, buildTaskEvent());

    expect(next.sceneRevision).toBe(4);
    expect(next.lastEventKind).toBe("task_started");
    expect(next.activeTask?.task_id).toBe(7);
  });

  it("clears the active task when the stream snapshot reports no task", () => {
    const started = reduceIkdApproachTaskEvent(INITIAL_STATE, buildTaskEvent());

    const next = reduceIkdApproachTaskEvent(started, {
      schema_version: "1",
      event_kind: "snapshot",
      scene_revision: 9,
      object_count: 0,
      task: null,
      emitted_at_ts_ns: 200,
    });

    expect(next.sceneRevision).toBe(9);
    expect(next.lastEventKind).toBe("snapshot");
    expect(next.activeTask).toBeNull();
  });
});
