import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { CreatedObject } from "@/features/objects";
import {
  createRoverApproachGuideLineState,
  createRoverApproachRoutePreviewState,
  hideRoverApproachGuideLine,
  hideRoverApproachRoutePreview,
  resolveRoverApproachGuideSegment,
  updateRoverApproachGuideLine,
  updateRoverApproachGuideLineToTarget,
  updateRoverApproachRoutePreview,
  updateRoverApproachGuideLineFromSegment,
} from "@/features/viewer/roverApproachGuideState";
import { ROVER_APPROACH_GUIDE_PARAMS } from "@/features/viewer/roverApproachGuideParams";
import {
  resolveRoverApproachRoutePreviewPoints,
} from "@/features/viewer/roverApproachRoutePreviewMath";

const createTestObject = (): CreatedObject => ({
  id: "obj-1",
  type: "cube",
  position: new THREE.Vector3(0.5, 0.25, 0.75),
  size: new THREE.Vector3(0.1, 0.1, 0.1),
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
});

describe("roverApproachGuideState", () => {
  it("projects a segment to the floor plane and marks state visible", () => {
    const guideState = createRoverApproachGuideLineState();
    updateRoverApproachGuideLineFromSegment({
      guideState,
      segmentStartWorld: new THREE.Vector3(1, 2, 3),
      segmentEndWorld: new THREE.Vector3(4, 8, 9),
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });
    expect(guideState.visible).toBe(true);
    expect(guideState.basePlanarWorld).toEqual(new THREE.Vector3(1, 2, 0));
    expect(guideState.targetPlanarWorld).toEqual(new THREE.Vector3(4, 8, 0));
  });

  it("hides the guide state when segment length is near zero", () => {
    const guideState = createRoverApproachGuideLineState();
    updateRoverApproachGuideLineFromSegment({
      guideState,
      segmentStartWorld: new THREE.Vector3(0, 0, 0),
      segmentEndWorld: new THREE.Vector3(0, 0, 0),
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });
    expect(guideState.visible).toBe(false);
  });

  it("resolves fallback segment when tracking reference is unavailable", () => {
    const fallbackStart = new THREE.Vector3(1, 0, 0);
    const fallbackEnd = new THREE.Vector3(2, 0, 0);
    const segment = resolveRoverApproachGuideSegment({
      robot: {} as URDFRobot,
      object: createTestObject(),
      endEffectorLink: null,
      fallbackSegmentStartWorld: fallbackStart,
      fallbackSegmentEndWorld: fallbackEnd,
    });
    expect(segment.segmentStartWorld).toBe(fallbackStart);
    expect(segment.segmentEndWorld).toBe(fallbackEnd);
  });

  it("updates the guide line directly from a target fallback segment", () => {
    const guideState = createRoverApproachGuideLineState();
    updateRoverApproachGuideLine({
      guideState,
      robot: {} as URDFRobot,
      object: createTestObject(),
      endEffectorLink: null,
      fallbackSegmentStartWorld: new THREE.Vector3(0, 0, 0.4),
      fallbackSegmentEndWorld: new THREE.Vector3(2, 3, 1.2),
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(guideState.visible).toBe(true);
    expect(guideState.basePlanarWorld).toEqual(new THREE.Vector3(0, 0, 0));
    expect(guideState.targetPlanarWorld).toEqual(new THREE.Vector3(2, 3, 0));
  });

  it("keeps the blue guide line fixed to the supplied target world", () => {
    const guideState = createRoverApproachGuideLineState();
    updateRoverApproachGuideLineToTarget({
      guideState,
      robot: {} as URDFRobot,
      object: createTestObject(),
      endEffectorLink: null,
      fallbackSegmentStartWorld: new THREE.Vector3(0, 0, 0.2),
      targetWorld: new THREE.Vector3(3, 4, 1.6),
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(guideState.visible).toBe(true);
    expect(guideState.basePlanarWorld).toEqual(new THREE.Vector3(0, 0, 0));
    expect(guideState.targetPlanarWorld).toEqual(new THREE.Vector3(3, 4, 0));
  });

  it("projects a multi-point route preview onto the floor plane", () => {
    const routePreviewState = createRoverApproachRoutePreviewState();
    updateRoverApproachRoutePreview({
      routePreviewState,
      pointWorlds: [
        new THREE.Vector3(0, 0, 0.4),
        new THREE.Vector3(0.0001, 0, 1.2),
        new THREE.Vector3(1, 2, 0.8),
        new THREE.Vector3(3, 5, 1.5),
      ],
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(routePreviewState.visible).toBe(true);
    expect(routePreviewState.pointPlanarWorlds).toEqual([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 2, 0),
      new THREE.Vector3(3, 5, 0),
    ]);
  });

  it("renders the exact hard-angle executed route in the purple preview", () => {
    const lockedRoutePointWorlds = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 1, 0),
    ];
    const previewPointWorlds = resolveRoverApproachRoutePreviewPoints({
      pointWorlds: lockedRoutePointWorlds,
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(previewPointWorlds.length).toBe(lockedRoutePointWorlds.length);
    expect(previewPointWorlds[0]).toEqual(
      new THREE.Vector3(0, 0, ROVER_APPROACH_GUIDE_PARAMS.routeLiftMeters)
    );
    previewPointWorlds.forEach((previewPointWorld, index) => {
      const routePointWorld = lockedRoutePointWorlds[index];
      expect(previewPointWorld.x).toBeCloseTo(routePointWorld.x);
      expect(previewPointWorld.y).toBeCloseTo(routePointWorld.y);
      expect(previewPointWorld.z).toBeCloseTo(
        routePointWorld.z + ROVER_APPROACH_GUIDE_PARAMS.routeLiftMeters
      );
    });
  });

  it("lifts the preview curve along the configured up axis", () => {
    const smoothedPointWorlds = resolveRoverApproachRoutePreviewPoints({
      pointWorlds: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ],
      upAxisWorld: new THREE.Vector3(0, 1, 0),
    });

    expect(smoothedPointWorlds).toEqual([
      new THREE.Vector3(0, ROVER_APPROACH_GUIDE_PARAMS.routeLiftMeters, 0),
      new THREE.Vector3(1, ROVER_APPROACH_GUIDE_PARAMS.routeLiftMeters, 0),
    ]);
  });

  it("hides the route preview when fewer than two distinct points remain", () => {
    const routePreviewState = createRoverApproachRoutePreviewState();
    routePreviewState.visible = true;
    routePreviewState.pointPlanarWorlds = [new THREE.Vector3(1, 1, 0)];

    updateRoverApproachRoutePreview({
      routePreviewState,
      pointWorlds: [new THREE.Vector3(0, 0, 0.2)],
      upAxisWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(routePreviewState.visible).toBe(false);
    expect(routePreviewState.pointPlanarWorlds).toEqual([]);
  });

  it("can be explicitly hidden", () => {
    const guideState = createRoverApproachGuideLineState();
    guideState.visible = true;
    hideRoverApproachGuideLine(guideState);
    expect(guideState.visible).toBe(false);
  });

  it("can explicitly hide the route preview", () => {
    const routePreviewState = createRoverApproachRoutePreviewState();
    routePreviewState.visible = true;
    routePreviewState.pointPlanarWorlds = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)];

    hideRoverApproachRoutePreview(routePreviewState);

    expect(routePreviewState.visible).toBe(false);
    expect(routePreviewState.pointPlanarWorlds).toEqual([]);
  });
});
