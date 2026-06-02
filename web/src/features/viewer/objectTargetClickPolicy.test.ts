import { describe, expect, it } from "vitest";
import {
  isObjectTargetInteractionActive,
  shouldShowRoverApproachGuideForSelectedObject,
  shouldMoveToObjectOnSingleClick,
  shouldMoveToObjectOnRepeatedClick,
  shouldToggleObjectSelectionOnSingleClick,
} from "@/features/viewer/objectTargetClickPolicy";
import { OBJECT_TARGET_CLICK_PARAMS } from "@/features/viewer/objectTargetClickParams";

describe("objectTargetClickPolicy", () => {
  it("treats rover approach, IK apply, and orbit follow as active target interactions", () => {
    expect(
      isObjectTargetInteractionActive({
        isIkRunning: true,
        isIkTrajectoryApplying: false,
        isFollowingOrbit: false,
      })
    ).toBe(true);
    expect(
      isObjectTargetInteractionActive({
        isIkRunning: false,
        isIkTrajectoryApplying: true,
        isFollowingOrbit: false,
      })
    ).toBe(true);
    expect(
      isObjectTargetInteractionActive({
        isIkRunning: false,
        isIkTrajectoryApplying: false,
        isFollowingOrbit: true,
      })
    ).toBe(true);
    expect(
      isObjectTargetInteractionActive({
        isIkRunning: false,
        isIkTrajectoryApplying: false,
        isFollowingOrbit: false,
      })
    ).toBe(false);
  });

  it("shows the rover guide only for an active runtime target selection", () => {
    expect(
      shouldShowRoverApproachGuideForSelectedObject({
        hasActiveObjectTargetInteraction: true,
        selectedObject: {
          source: "runtime-demo",
        },
      })
    ).toBe(true);
    expect(
      shouldShowRoverApproachGuideForSelectedObject({
        hasActiveObjectTargetInteraction: false,
        selectedObject: {
          source: "runtime-demo",
        },
      })
    ).toBe(false);
    expect(
      shouldShowRoverApproachGuideForSelectedObject({
        hasActiveObjectTargetInteraction: true,
        selectedObject: {
          source: "runtime-detection",
          isHidden: true,
        },
      })
    ).toBe(false);
    expect(
      shouldShowRoverApproachGuideForSelectedObject({
        hasActiveObjectTargetInteraction: true,
        selectedObject: {
          source: "manual",
        },
      })
    ).toBe(false);
  });

  it("allows retargeting on single click while editable interaction is already active", () => {
    expect(
      shouldMoveToObjectOnSingleClick({
        hasIkTargetClickHandler: true,
        editable: true,
        enableObjectActionsInReadOnly: false,
        allowRetargetOnClick: true,
      })
    ).toBe(true);
  });

  it("keeps single click as selection when editable retargeting is not active", () => {
    expect(
      shouldMoveToObjectOnSingleClick({
        hasIkTargetClickHandler: true,
        editable: true,
        enableObjectActionsInReadOnly: false,
        allowRetargetOnClick: false,
      })
    ).toBe(false);
  });

  it("allows single click movement in read-only action mode", () => {
    expect(
      shouldMoveToObjectOnSingleClick({
        hasIkTargetClickHandler: true,
        editable: false,
        enableObjectActionsInReadOnly: true,
        allowRetargetOnClick: false,
      })
    ).toBe(true);
  });

  it("keeps selection stable when clicking the already selected IK target", () => {
    expect(
      shouldToggleObjectSelectionOnSingleClick({
        hasIkTargetClickHandler: true,
        selectedObjectId: "object-7",
        clickedObjectId: "object-7",
      })
    ).toBe(false);
  });

  it("still toggles selection for repeated clicks when no IK target handler exists", () => {
    expect(
      shouldToggleObjectSelectionOnSingleClick({
        hasIkTargetClickHandler: false,
        selectedObjectId: "object-7",
        clickedObjectId: "object-7",
      })
    ).toBe(true);
  });

  it("treats the second click on the selected IK target as a move request", () => {
    expect(
      shouldMoveToObjectOnRepeatedClick({
        hasIkTargetClickHandler: true,
        selectedObjectId: "object-7",
        clickedObjectId: "object-7",
        clickDetail: 2,
        previousClickedObjectId: "object-7",
        previousClickTimeMs: 1000,
        clickTimeMs: 1200,
      })
    ).toBe(true);
  });

  it("treats a quick second tap on the same selected target as a move request", () => {
    expect(
      shouldMoveToObjectOnRepeatedClick({
        hasIkTargetClickHandler: true,
        selectedObjectId: "object-7",
        clickedObjectId: "object-7",
        clickDetail: 1,
        previousClickedObjectId: "object-7",
        previousClickTimeMs: 1000,
        clickTimeMs: 1000 + OBJECT_TARGET_CLICK_PARAMS.repeatedTouchWindowMs - 1,
      })
    ).toBe(true);
  });

  it("does not treat a delayed second tap as a move request", () => {
    expect(
      shouldMoveToObjectOnRepeatedClick({
        hasIkTargetClickHandler: true,
        selectedObjectId: "object-7",
        clickedObjectId: "object-7",
        clickDetail: 1,
        previousClickedObjectId: "object-7",
        previousClickTimeMs: 1000,
        clickTimeMs: 1000 + OBJECT_TARGET_CLICK_PARAMS.repeatedTouchWindowMs + 1,
      })
    ).toBe(false);
  });

  it("does not force move on the first click", () => {
    expect(
      shouldMoveToObjectOnRepeatedClick({
        hasIkTargetClickHandler: true,
        selectedObjectId: "object-7",
        clickedObjectId: "object-7",
        clickDetail: 1,
        previousClickedObjectId: null,
        previousClickTimeMs: null,
        clickTimeMs: 1000,
      })
    ).toBe(false);
  });
});
