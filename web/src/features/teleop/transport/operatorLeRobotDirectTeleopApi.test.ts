import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPERATOR_HELPER_COLLABORATION_SESSION_HEADER,
  OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
} from "@/features/teleop/transport/operatorHelperApi";
import {
  fetchOperatorLeRobotDirectTeleopStatus,
  startOperatorLeRobotDirectTeleop,
  stopOperatorLeRobotDirectTeleop,
} from "@/features/teleop/transport/operatorLeRobotDirectTeleopApi";
import { OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS } from "@/features/teleop/params/operatorTeleopParams";

describe("operatorLeRobotDirectTeleopApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts polls and stops LeRobot direct teleop", async () => {
    const fixture = {
      baseUrl: "http://127.0.0.1:8091",
      browserToken: "token-123",
      sessionId: "collab",
      teleopToken: "teleop-token",
      operatorId: "browser-operator",
      sessionStatusId: "lerobot-direct-1",
      fps: 60,
      pid: 4200,
      startedAtMs: 1234,
    } as const;
    const directStatusPayload = {
      state: "running",
      running: true,
      session_id: fixture.sessionStatusId,
      fps: fixture.fps,
      pid: fixture.pid,
      command: ["lerobot-teleoperate", "--robot.type=so100_follower"],
      display_command: "lerobot-teleoperate --robot.type=so100_follower",
      leader_profile: "so100_leader",
      leader_id: "blue",
      follower_robot_type: "so100_follower",
      started_at_ms: fixture.startedAtMs,
      stopped_at_ms: null,
      return_code: null,
      last_error: null,
    };
    const authorization = {
      sessionId: fixture.sessionId,
      teleopCapabilityToken: fixture.teleopToken,
    };
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(directStatusPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const startStatus = await startOperatorLeRobotDirectTeleop(
      {
        operatorId: fixture.operatorId,
        leader: {
          port: "/dev/serial/by-id/so100-leader",
          calibrationCategory: "teleoperators",
          calibrationProfile: "so100_leader",
          calibrationId: "blue",
          calibrationGroup: "all",
        },
      },
      fixture.baseUrl,
      fixture.browserToken,
      authorization,
    );
    const status = await fetchOperatorLeRobotDirectTeleopStatus(
      fixture.baseUrl,
      fixture.browserToken,
      authorization,
    );
    await stopOperatorLeRobotDirectTeleop(
      fixture.baseUrl,
      fixture.browserToken,
      authorization,
    );

    expect(startStatus).toEqual({
      state: "running",
      running: true,
      sessionId: fixture.sessionStatusId,
      fps: fixture.fps,
      pid: fixture.pid,
      command: ["lerobot-teleoperate", "--robot.type=so100_follower"],
      displayCommand: "lerobot-teleoperate --robot.type=so100_follower",
      leaderProfile: "so100_leader",
      leaderId: "blue",
      followerRobotType: "so100_follower",
      startedAtMs: fixture.startedAtMs,
      stoppedAtMs: null,
      returnCode: null,
      lastError: null,
    });
    expect(status.sessionId).toBe(fixture.sessionStatusId);

    const [startUrl, startInit] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(startUrl)).toBe(
      `${fixture.baseUrl}${OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS.start}`,
    );
    expect(startInit?.method).toBe("POST");
    expect((startInit?.headers as Headers).get("X-Operator-Helper-Token")).toBe(
      fixture.browserToken,
    );
    expect(
      (startInit?.headers as Headers).get(OPERATOR_HELPER_COLLABORATION_SESSION_HEADER),
    ).toBe(fixture.sessionId);
    expect(
      (startInit?.headers as Headers).get(
        OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
      ),
    ).toBe(fixture.teleopToken);
    expect(JSON.parse(String(startInit?.body))).toEqual({
      operator_id: fixture.operatorId,
      leader: {
        port: "/dev/serial/by-id/so100-leader",
        calibration_category: "teleoperators",
        calibration_profile: "so100_leader",
        calibration_id: "blue",
        calibration_group: "all",
      },
    });

    const [statusUrl, statusInit] = vi.mocked(fetchMock).mock.calls[1];
    expect(String(statusUrl)).toBe(
      `${fixture.baseUrl}${OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS.status}`,
    );
    expect(statusInit?.method).toBeUndefined();
    expect((statusInit?.headers as Headers).get("X-Operator-Helper-Token")).toBe(
      fixture.browserToken,
    );

    const [stopUrl, stopInit] = vi.mocked(fetchMock).mock.calls[2];
    expect(String(stopUrl)).toBe(
      `${fixture.baseUrl}${OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS.stop}`,
    );
    expect(stopInit?.method).toBe("POST");
    expect((stopInit?.headers as Headers).get("X-Operator-Helper-Token")).toBe(
      fixture.browserToken,
    );
  });
});
