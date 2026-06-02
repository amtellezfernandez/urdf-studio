import { beforeEach, describe, expect, it } from "vitest";
import { useAssemblyStore } from "./useAssemblyStore";

describe("useAssemblyStore", () => {
  beforeEach(() => {
    useAssemblyStore.getState().clear();
  });

  it("deduplicates repeated URDF paths when setting selected robots", () => {
    const store = useAssemblyStore.getState();
    store.setSelectedUrdfPaths([
      "repo/robot_a.urdf",
      "repo/robot_a.urdf",
      "repo/robot_b.urdf",
      "repo/robot_a.urdf",
    ]);

    const state = useAssemblyStore.getState();
    expect(state.selectedUrdfPaths).toEqual(["repo/robot_a.urdf", "repo/robot_b.urdf"]);
    expect(state.selectedRobots).toHaveLength(2);
    expect(state.selectedRobots[0]?.urdfPath).toBe("repo/robot_a.urdf");
    expect(state.selectedRobots[1]?.urdfPath).toBe("repo/robot_b.urdf");
    expect(state.selectedRobots[0]?.isPrimary).toBe(true);
    expect(state.selectedRobots[1]?.isPrimary).toBe(false);
  });

  it("keeps explicit duplicate robots when user duplicates from the UI action", () => {
    const store = useAssemblyStore.getState();
    store.setSelectedUrdfPaths(["repo/robot_a.urdf", "repo/robot_b.urdf"]);
    const sourceId = useAssemblyStore.getState().selectedRobots[0]?.instanceId;
    expect(sourceId).toBeTruthy();
    if (!sourceId) {
      throw new Error("Missing source robot id for duplicate test.");
    }

    store.duplicateRobot(sourceId);

    const state = useAssemblyStore.getState();
    expect(state.selectedUrdfPaths).toEqual([
      "repo/robot_a.urdf",
      "repo/robot_a.urdf",
      "repo/robot_b.urdf",
    ]);
    expect(state.selectedRobots).toHaveLength(3);
    expect(state.selectedRobots[0]?.isPrimary).toBe(true);
    expect(state.selectedRobots[1]?.isPrimary).toBe(false);
  });

  it("preserves substitution roles when seeding selected robots", () => {
    const store = useAssemblyStore.getState();
    store.setSelectedUrdfPaths(
      ["repo/host.urdf", "repo/tool.urdf"],
      {
        "repo/host.urdf": "Host",
        "repo/tool.urdf": "Tool",
      },
      {},
      {
        "repo/host.urdf": "host",
        "repo/tool.urdf": "replacement",
      }
    );

    const state = useAssemblyStore.getState();
    expect(state.selectedRobots).toMatchObject([
      { urdfPath: "repo/host.urdf", role: "host", isPrimary: true },
      { urdfPath: "repo/tool.urdf", role: "replacement", isPrimary: false },
    ]);
  });

  it("clears special role when duplicating a staged substitution robot", () => {
    const store = useAssemblyStore.getState();
    store.setSelectedUrdfPaths(
      ["repo/host.urdf"],
      { "repo/host.urdf": "Host" },
      {},
      { "repo/host.urdf": "host" }
    );
    const sourceId = useAssemblyStore.getState().selectedRobots[0]?.instanceId;
    expect(sourceId).toBeTruthy();
    if (!sourceId) {
      throw new Error("Missing source robot id for duplicate role test.");
    }

    store.duplicateRobot(sourceId);

    const state = useAssemblyStore.getState();
    expect(state.selectedRobots[0]?.role).toBe("host");
    expect(state.selectedRobots[1]?.role).toBeUndefined();
  });
});
