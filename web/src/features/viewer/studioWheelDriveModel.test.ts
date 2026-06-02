import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFJoint } from "urdf-loader";

import {
  buildStudioWheelRoleEntries,
  getPreferredStudioDriveWheels,
  getStudioWheelTravelForBodyMotion,
  type StudioWheelDriveModel,
  type StudioWheelJointMeta,
} from "@/features/viewer/studioWheelDriveModel";

const TRACK_WIDTH_METERS = 0.6;
const LINEAR_TRAVEL_METERS = 1;
const ANGULAR_TRAVEL_RADIANS = 2;
const ACTIVE_ACTIVITY_MPS = 0.1;
const FOLLOWER_ACTIVITY_MPS = 0.09;
const LOW_ACTIVITY_MPS = 0.01;

const createWheel = (
  jointName: string,
  side: StudioWheelJointMeta["side"],
  overrides: Partial<StudioWheelJointMeta> = {}
): StudioWheelJointMeta => ({
  jointName,
  joint: { name: jointName } as URDFJoint,
  side,
  lateralOffset: 0,
  radius: 0.3,
  axisLocal: new THREE.Vector3(0, 1, 0),
  directionSign: 1,
  drivePreferred: false,
  ...overrides,
});

const createModel = (wheels: StudioWheelJointMeta[]): StudioWheelDriveModel => ({
  wheels,
  trackWidth: TRACK_WIDTH_METERS,
  forwardLocal: new THREE.Vector3(1, 0, 0),
});

describe("studioWheelDriveModel", () => {
  it("builds sorted wheel role entries from dynamic activity thresholds", () => {
    const model = createModel([
      createWheel("right_drive", "right"),
      createWheel("unknown_idle", "unknown"),
      createWheel("left_drive", "left"),
    ]);

    const entries = buildStudioWheelRoleEntries(
      model,
      {
        left_drive: ACTIVE_ACTIVITY_MPS,
        right_drive: FOLLOWER_ACTIVITY_MPS,
        unknown_idle: LOW_ACTIVITY_MPS,
      },
      new Set(["left_drive"])
    );

    expect(entries).toEqual([
      {
        jointName: "left_drive",
        side: "left",
        role: "drive",
        activityMps: ACTIVE_ACTIVITY_MPS,
        driveEnabled: true,
      },
      {
        jointName: "right_drive",
        side: "right",
        role: "follower",
        activityMps: FOLLOWER_ACTIVITY_MPS,
        driveEnabled: false,
      },
      {
        jointName: "unknown_idle",
        side: "unknown",
        role: "unknown",
        activityMps: LOW_ACTIVITY_MPS,
        driveEnabled: false,
      },
    ]);
  });

  it("resolves preferred drive wheels from defaults plus explicit overrides", () => {
    const model = createModel([
      createWheel("front_left", "left", { drivePreferred: true }),
      createWheel("front_right", "right", { drivePreferred: false }),
      createWheel("rear_left", "left", { drivePreferred: true }),
    ]);

    const preferredWheels = getPreferredStudioDriveWheels(model, {
      front_left: false,
      front_right: true,
    });

    expect(preferredWheels.map((wheel) => wheel.jointName)).toEqual([
      "front_right",
      "rear_left",
    ]);
  });

  it("uses explicit lateral offsets before side-based track-width fallback", () => {
    expect(
      getStudioWheelTravelForBodyMotion(
        createWheel("left_drive", "left", { lateralOffset: 0 }),
        LINEAR_TRAVEL_METERS,
        ANGULAR_TRAVEL_RADIANS,
        TRACK_WIDTH_METERS
      )
    ).toBeCloseTo(0.4, 8);

    expect(
      getStudioWheelTravelForBodyMotion(
        createWheel("right_drive", "right", { lateralOffset: 0.2 }),
        LINEAR_TRAVEL_METERS,
        ANGULAR_TRAVEL_RADIANS,
        TRACK_WIDTH_METERS
      )
    ).toBeCloseTo(1.4, 8);
  });
});
