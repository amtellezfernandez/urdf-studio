import { describe, expect, it } from "vitest";

import {
  assignOperatorDeviceRole,
  assignOperatorDeviceRoleForKeys,
  buildOperatorProfileDeviceKey,
  buildOperatorProfileDeviceKeys,
  normalizeOperatorDeviceRoleKeys,
  readOperatorDeviceRoleAssignments,
  releaseOperatorDeviceRole,
  releaseOperatorDeviceRoleForKeys,
  resolveOperatorDeviceRoleConflict,
  resolveOperatorDeviceRoleConflictForKeys,
  writeOperatorDeviceRoleAssignments,
} from "@/features/teleop/transport/operatorDeviceRoleAssignments";
import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";

describe("operatorDeviceRoleAssignments", () => {
  it("rejects selecting one physical device as leader and follower at the same time", () => {
    const deviceKey = "serial-by-id:usb-1a86_USB_Single_Serial_58FA095368";
    const leaderResult = assignOperatorDeviceRole({}, deviceKey, "leader");

    expect(leaderResult.accepted).toBe(true);
    if (!leaderResult.accepted) throw new Error("leader assignment rejected");

    expect(
      resolveOperatorDeviceRoleConflict(
        leaderResult.assignments,
        deviceKey,
        "follower",
      ),
    ).toBe(
      "Disconnect this device as leader before selecting it as follower.",
    );
    expect(
      assignOperatorDeviceRole(leaderResult.assignments, deviceKey, "follower"),
    ).toMatchObject({
      accepted: false,
      conflict: "Disconnect this device as leader before selecting it as follower.",
    });
  });

  it("allows a role switch after the previous role is disconnected", () => {
    const deviceKey = "serial-by-id:leader";
    const leaderResult = assignOperatorDeviceRole({}, deviceKey, "leader");
    if (!leaderResult.accepted) throw new Error("leader assignment rejected");

    const released = releaseOperatorDeviceRole(
      leaderResult.assignments,
      deviceKey,
      "leader",
    );
    const followerResult = assignOperatorDeviceRole(released, deviceKey, "follower");

    expect(followerResult).toMatchObject({
      accepted: true,
      assignments: { [deviceKey]: "follower" },
    });
  });

  it("treats aliases for the same hardware device as one role lock", () => {
    const aliases = [
      "serial-by-id:1a86_USB_Single_Serial_58FA095368",
      "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
      "/dev/ttyACM0",
      "/dev/ttyACM0",
      "",
    ];
    const leaderResult = assignOperatorDeviceRoleForKeys({}, aliases, "leader");
    expect(leaderResult.accepted).toBe(true);
    if (!leaderResult.accepted) throw new Error("leader aliases rejected");

    expect(normalizeOperatorDeviceRoleKeys(aliases)).toEqual([
      "serial-by-id:1a86_USB_Single_Serial_58FA095368",
      "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
      "/dev/ttyACM0",
    ]);
    expect(
      resolveOperatorDeviceRoleConflictForKeys(
        leaderResult.assignments,
        ["/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00"],
        "follower",
      ),
    ).toBe(
      "Disconnect this device as leader before selecting it as follower.",
    );
    expect(
      releaseOperatorDeviceRoleForKeys(
        leaderResult.assignments,
        aliases,
        "leader",
      ),
    ).toEqual({});
  });

  it("persists valid role assignments best-effort", () => {
    const storage = new Map<string, string>();
    const storageAdapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as Storage;

    writeOperatorDeviceRoleAssignments(
      {
        "serial-by-id:leader": "leader",
        "serial-by-id:follower": "follower",
      },
      storageAdapter,
    );

    expect(readOperatorDeviceRoleAssignments(storageAdapter)).toEqual({
      "serial-by-id:leader": "leader",
      "serial-by-id:follower": "follower",
    });
  });

  it("prefers provider-reported hardware identity over profile identity", () => {
    const profile = {
      id: "real_hardware",
      adapterId: "so100",
      robotId: "lekiwi",
      hardwareDeviceKey: "serial-by-id:usb-1a86_USB_Single_Serial_58FA095368",
    } as OperatorTeleopProfile;

    expect(buildOperatorProfileDeviceKey({ providerId: "lerobot", profile })).toBe(
      "serial-by-id:usb-1a86_USB_Single_Serial_58FA095368",
    );
  });

  it("keeps provider-reported alias keys with the primary profile key", () => {
    const profile = {
      id: "openarm_left",
      adapterId: "openarm_native",
      robotId: "openarm",
      hardwareDeviceKey: "openarm:left_arm",
      hardwareDeviceKeys: ["/dev/serial/by-id/openarm-can0", "openarm:left_arm"],
    } as OperatorTeleopProfile;

    expect(buildOperatorProfileDeviceKeys({ providerId: "gateway", profile })).toEqual([
      "openarm:left_arm",
      "/dev/serial/by-id/openarm-can0",
    ]);
  });
});
