import { describe, expect, it } from "vitest";

import {
  OPERATOR_LEADER_ASSIGNMENTS_STORAGE_KEY,
  OPERATOR_PREVIOUS_OPENARM_LEADER_ASSIGNMENTS_STORAGE_KEY,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  assignOperatorLeaderSide,
  readOperatorLeaderAssignments,
  releaseOperatorLeaderAssignment,
  writeOperatorLeaderAssignments,
} from "@/features/teleop/transport/operatorLeaderAssignments";

describe("operatorLeaderAssignments", () => {
  it("persists leader side assignments by stable identity key", () => {
    const storage = new Map<string, string>();
    const storageAdapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as Storage;
    const leftLeader = "serial-by-id:1a86_USB_Single_Serial_LEFT";
    const rightLeader = "serial-by-id:1a86_USB_Single_Serial_RIGHT";

    const assignedLeft = assignOperatorLeaderSide({}, leftLeader, "left", {
      targetGroupId: "arm.left",
      targetJointNames: ["left_shoulder_pan"],
      controlPartId: "feetech:1-2-3-4-5-6",
      sourceMotorIds: [1, 2, 3, 4, 5, 6],
      sourceMotorModel: null,
      sourceActuatorCount: 6,
    });
    const assignedRight = assignOperatorLeaderSide(
      assignedLeft,
      rightLeader,
      "right",
      {
        targetGroupId: "arm.right",
        targetJointNames: ["right_shoulder_pan"],
      },
    );
    writeOperatorLeaderAssignments(assignedRight, storageAdapter);

    expect(storage.get(OPERATOR_LEADER_ASSIGNMENTS_STORAGE_KEY)).toBeTruthy();
    expect(readOperatorLeaderAssignments(storageAdapter)).toEqual({
      [leftLeader]: {
        side: "left",
        targetGroupId: "arm.left",
        targetJointNames: ["left_shoulder_pan"],
        targetEndEffectorJointNames: [],
        controlPartId: "feetech:1-2-3-4-5-6",
        sourceMotorIds: [1, 2, 3, 4, 5, 6],
        sourceMotorModel: null,
        sourceActuatorCount: 6,
      },
      [rightLeader]: {
        side: "right",
        targetGroupId: "arm.right",
        targetJointNames: ["right_shoulder_pan"],
        targetEndEffectorJointNames: [],
        controlPartId: "",
        sourceMotorIds: [],
        sourceMotorModel: null,
        sourceActuatorCount: 0,
      },
    });
  });

  it("moves a side assignment from the old leader to the latest leader", () => {
    const oldLeftLeader = "serial-by-id:old-left";
    const newLeftLeader = "serial-by-id:new-left";

    expect(
      assignOperatorLeaderSide(
        {
          [oldLeftLeader]: {
            side: "left",
            targetGroupId: "",
            targetJointNames: [],
            targetEndEffectorJointNames: [],
            controlPartId: "",
            sourceMotorIds: [],
            sourceMotorModel: null,
            sourceActuatorCount: 0,
          },
        },
        newLeftLeader,
        "left",
      ),
    ).toEqual({
      [newLeftLeader]: {
        side: "left",
        targetGroupId: "",
        targetJointNames: [],
        targetEndEffectorJointNames: [],
        controlPartId: "",
        sourceMotorIds: [],
        sourceMotorModel: null,
        sourceActuatorCount: 0,
      },
    });
  });

  it("uses a single leader for a single arm without exposing left or right", () => {
    expect(
      assignOperatorLeaderSide(
        {
          "serial-by-id:left": {
            side: "left",
            targetGroupId: "arm.left",
            targetJointNames: [],
            targetEndEffectorJointNames: [],
            controlPartId: "",
            sourceMotorIds: [],
            sourceMotorModel: null,
            sourceActuatorCount: 0,
          },
          "serial-by-id:right": {
            side: "right",
            targetGroupId: "arm.right",
            targetJointNames: [],
            targetEndEffectorJointNames: [],
            controlPartId: "",
            sourceMotorIds: [],
            sourceMotorModel: null,
            sourceActuatorCount: 0,
          },
        },
        "serial-by-id:so100",
        "both",
        { targetGroupId: "arm.primary" },
      ),
    ).toEqual({
      "serial-by-id:so100": {
        side: "both",
        targetGroupId: "arm.primary",
        targetJointNames: [],
        targetEndEffectorJointNames: [],
        controlPartId: "",
        sourceMotorIds: [],
        sourceMotorModel: null,
        sourceActuatorCount: 0,
      },
    });
  });

  it("releases an explicit leader side assignment", () => {
    expect(
      releaseOperatorLeaderAssignment(
        {
          "serial-by-id:left": {
            side: "left",
            targetGroupId: "",
            targetJointNames: [],
            targetEndEffectorJointNames: [],
            controlPartId: "",
            sourceMotorIds: [],
            sourceMotorModel: null,
            sourceActuatorCount: 0,
          },
          "serial-by-id:right": {
            side: "right",
            targetGroupId: "",
            targetJointNames: [],
            targetEndEffectorJointNames: [],
            controlPartId: "",
            sourceMotorIds: [],
            sourceMotorModel: null,
            sourceActuatorCount: 0,
          },
        },
        "serial-by-id:left",
      ),
    ).toEqual({
      "serial-by-id:right": {
        side: "right",
        targetGroupId: "",
        targetJointNames: [],
        targetEndEffectorJointNames: [],
        controlPartId: "",
        sourceMotorIds: [],
        sourceMotorModel: null,
        sourceActuatorCount: 0,
      },
    });
  });

  it("reads previous side-only assignments as empty target assignments", () => {
    const storage = new Map<string, string>();
    const storageAdapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as Storage;
    storage.set(
      OPERATOR_PREVIOUS_OPENARM_LEADER_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ "serial-by-id:previous": "both" }),
    );

    expect(readOperatorLeaderAssignments(storageAdapter)).toEqual({
      "serial-by-id:previous": {
        side: "both",
        targetGroupId: "",
        targetJointNames: [],
        targetEndEffectorJointNames: [],
        controlPartId: "",
        sourceMotorIds: [],
        sourceMotorModel: null,
        sourceActuatorCount: 0,
      },
    });
  });

  it("prefers generic assignments over previous OpenArm assignments", () => {
    const storage = new Map<string, string>();
    const storageAdapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as Storage;
    storage.set(
      OPERATOR_PREVIOUS_OPENARM_LEADER_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ "serial-by-id:previous": "both" }),
    );
    storage.set(
      OPERATOR_LEADER_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify({ "serial-by-id:generic": "left" }),
    );

    expect(readOperatorLeaderAssignments(storageAdapter)).toEqual({
      "serial-by-id:generic": {
        side: "left",
        targetGroupId: "",
        targetJointNames: [],
        targetEndEffectorJointNames: [],
        controlPartId: "",
        sourceMotorIds: [],
        sourceMotorModel: null,
        sourceActuatorCount: 0,
      },
    });
  });

  it("keeps assignments best-effort when storage writes are blocked", () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    expect(readOperatorLeaderAssignments(blockedStorage)).toEqual({});
    expect(() =>
      writeOperatorLeaderAssignments(
        assignOperatorLeaderSide({}, "serial-by-id:leader", "left"),
        blockedStorage,
      ),
    ).not.toThrow();
  });
});
