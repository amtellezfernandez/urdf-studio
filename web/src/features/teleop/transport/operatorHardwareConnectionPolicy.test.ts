import { describe, expect, it } from "vitest";

import {
  buildOperatorHardwareConnectionReadinessItem,
  resolveOperatorHardwareConnectionState,
  resolveOperatorHardwareRoleConflict,
} from "@/features/teleop/transport/operatorHardwareConnectionPolicy";

describe("operatorHardwareConnectionPolicy", () => {
  it("builds shared readiness rows with consistent detail selection", () => {
    expect(
      buildOperatorHardwareConnectionReadinessItem({
        id: "permission",
        label: "Teleop permission",
        ready: false,
        readyDetail: "Permission granted.",
        blockedDetail: "Permission required.",
      }),
    ).toEqual({
      id: "permission",
      label: "Teleop permission",
      ready: false,
      detail: "Permission required.",
    });
  });

  it("resolves role conflicts without treating missing passive selections as conflicts", () => {
    expect(
      resolveOperatorHardwareRoleConflict({
        assignments: {},
        deviceKey: null,
        requestedRole: "leader",
      }),
    ).toBeNull();

    expect(
      resolveOperatorHardwareRoleConflict({
        assignments: { "serial-by-id:device": "follower" },
        deviceKey: ["/dev/ttyACM0", "serial-by-id:device"],
        requestedRole: "leader",
      }),
    ).toBe(
      "Disconnect this device as follower before selecting it as leader.",
    );
  });

  it("returns a complete connection gate so callers do not recombine primitives", () => {
    expect(
      resolveOperatorHardwareConnectionState({
        deviceAvailable: true,
        operationBusy: false,
        alreadyConnected: true,
        connectionPrerequisitesReady: false,
        roleConflict:
          "Disconnect this device as leader before selecting it as follower.",
      }),
    ).toEqual({
      status: "connected",
      connectDisabled: false,
      connectBlockReason: null,
      targetSelectionBlocked: true,
      targetSelectionBlockReason: "role_conflict",
    });

    expect(
      resolveOperatorHardwareConnectionState({
        deviceAvailable: false,
        operationBusy: false,
        alreadyConnected: false,
        connectionPrerequisitesReady: true,
        roleConflict: null,
      }),
    ).toEqual({
      status: "blocked",
      connectDisabled: true,
      connectBlockReason: "device_unavailable",
      targetSelectionBlocked: true,
      targetSelectionBlockReason: "device_unavailable",
    });

    expect(
      resolveOperatorHardwareConnectionState({
        deviceAvailable: true,
        operationBusy: false,
        alreadyConnected: false,
        connectionPrerequisitesReady: true,
        roleConflict: null,
      }),
    ).toEqual({
      status: "ready",
      connectDisabled: false,
      connectBlockReason: null,
      targetSelectionBlocked: false,
      targetSelectionBlockReason: null,
    });

    expect(
      resolveOperatorHardwareConnectionState({
        deviceAvailable: true,
        operationBusy: false,
        alreadyConnected: false,
        connectionPrerequisitesReady: true,
        roleConflict:
          "Disconnect this device as leader before selecting it as follower.",
      }),
    ).toEqual({
      status: "blocked",
      connectDisabled: true,
      connectBlockReason: "role_conflict",
      targetSelectionBlocked: true,
      targetSelectionBlockReason: "role_conflict",
    });
  });
});
