import { describe, expect, it } from "vitest";

import {
  OPERATOR_CALIBRATION_UI_COPY,
  beginOperatorCalibrationUi,
  createOperatorCalibrationUiState,
  failOperatorCalibrationUi,
  finishOperatorCalibrationUi,
  isOperatorCalibrationUiActive,
  readOperatorCalibrationUiEntry,
} from "@/features/teleop/panel/operatorCalibrationUi";

describe("operatorCalibrationUi", () => {
  it("tracks one calibration lifecycle by key", () => {
    const pending = beginOperatorCalibrationUi(
      createOperatorCalibrationUiState(),
      "leader:path:ttyACM0",
      OPERATOR_CALIBRATION_UI_COPY.leader,
    );

    expect(isOperatorCalibrationUiActive(pending, "leader:path:ttyACM0")).toBe(
      true,
    );
    expect(
      readOperatorCalibrationUiEntry(pending, "leader:path:ttyACM0"),
    ).toEqual({
      command: null,
      message: "Opening LeRobot calibration...",
    });

    const finished = finishOperatorCalibrationUi(
      pending,
      "leader:path:ttyACM0",
      {
        started: true,
        command: ["lerobot-calibrate", "--teleop.type=so100_leader"],
        displayCommand: "lerobot-calibrate --teleop.type=so100_leader",
        message: "Opened.",
      },
      OPERATOR_CALIBRATION_UI_COPY.leader,
    );

    expect(isOperatorCalibrationUiActive(finished, "leader:path:ttyACM0")).toBe(
      false,
    );
    expect(
      readOperatorCalibrationUiEntry(finished, "leader:path:ttyACM0"),
    ).toEqual({
      command: "lerobot-calibrate --teleop.type=so100_leader",
      message: "LeRobot calibration opened. Use its prompt, then rescan.",
    });
  });

  it("keeps the previous command when calibration start fails", () => {
    const finished = finishOperatorCalibrationUi(
      beginOperatorCalibrationUi(
        createOperatorCalibrationUiState(),
        "follower",
        OPERATOR_CALIBRATION_UI_COPY.follower,
      ),
      "follower",
      {
        started: false,
        command: ["lerobot-calibrate", "--robot.type=so100_follower"],
        displayCommand: "lerobot-calibrate --robot.type=so100_follower",
        message: "Open a terminal.",
      },
      OPERATOR_CALIBRATION_UI_COPY.follower,
    );
    const failed = failOperatorCalibrationUi(
      finished,
      "follower",
      new Error("Port is in use"),
      OPERATOR_CALIBRATION_UI_COPY.follower,
    );

    expect(readOperatorCalibrationUiEntry(failed, "follower")).toEqual({
      command: "lerobot-calibrate --robot.type=so100_follower",
      message: "Port is in use",
    });
  });
});
