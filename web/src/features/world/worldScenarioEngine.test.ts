import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildWorldScenarioLayout, buildWorldScenarioTimeline } from "./worldScenarioEngine";
import {
  WORLD_SCENARIO_LAYOUT_PARAMS,
  WORLD_SCENARIO_DURATION_MS,
  WORLD_SCENARIO_EVENTS,
  WORLD_SCENARIO_NUMERIC_TOLERANCES,
  WORLD_SCENARIO_SOURCES,
} from "./worldScenarioParams";

const params = {
  baseCenter: new THREE.Vector3(0, 0, 0),
  baseSize: new THREE.Vector3(0.5, 0.4, 0.3),
  baseZ: 0,
  ringRadius: 0.9,
  forwardOffset: 0.8,
};

describe("buildWorldScenarioLayout", () => {
  it("is deterministic for the same seed", () => {
    const first = buildWorldScenarioLayout({ ...params, seed: 42 });
    const second = buildWorldScenarioLayout({ ...params, seed: 42 });

    expect(first.objects).toHaveLength(second.objects.length);
    first.objects.forEach((obj, idx) => {
      const other = second.objects[idx];
      expect(other?.type).toBe(obj.type);
      expect(other?.color).toBe(obj.color);
      expect(other?.position.toArray()).toEqual(obj.position.toArray());
      expect(other?.size.toArray()).toEqual(obj.size.toArray());
    });
    expect(first.targetPosition.toArray()).toEqual(second.targetPosition.toArray());
  });

  it("changes world layout when seed changes", () => {
    const first = buildWorldScenarioLayout({ ...params, seed: 42 });
    const second = buildWorldScenarioLayout({ ...params, seed: 43 });

    const hasDifference = first.objects.some((obj, idx) => {
      const other = second.objects[idx];
      if (!other) return true;
      return !obj.position.equals(other.position);
    });

    expect(hasDifference).toBe(true);
  });

  it("keeps objects outside the robot keep-out planar distance", () => {
    const layout = buildWorldScenarioLayout({ ...params, seed: 7 });
    const minPlanarDistance = Math.max(
      WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.minPlanarDistance,
      Math.max(params.baseSize.x, params.baseSize.y) * WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.baseSizeScale +
        WORLD_SCENARIO_LAYOUT_PARAMS.keepOut.extraPadding
    );

    layout.objects.forEach((obj) => {
      const dx = obj.position.x - params.baseCenter.x;
      const dy = obj.position.y - params.baseCenter.y;
      const planar = Math.hypot(dx, dy);
      expect(planar).toBeGreaterThanOrEqual(
        minPlanarDistance - WORLD_SCENARIO_NUMERIC_TOLERANCES.assertionMargin
      );
    });
  });

  it("marks generated objects as world-scenario objects", () => {
    const layout = buildWorldScenarioLayout({ ...params, seed: 7 });
    layout.objects.forEach((obj) => {
      expect(obj.source).toBe(WORLD_SCENARIO_SOURCES.current);
    });
  });

  it("keeps generated objects above the floor plane", () => {
    const layout = buildWorldScenarioLayout({ ...params, seed: 99 });
    layout.objects.forEach((obj) => {
      const minZ = obj.position.z - obj.size.z * 0.5;
      expect(minZ).toBeGreaterThanOrEqual(
        params.baseZ - WORLD_SCENARIO_NUMERIC_TOLERANCES.assertionMargin
      );
    });
  });

  it("keeps non-pedestal objects with safe pairwise planar spacing", () => {
    const layout = buildWorldScenarioLayout({ ...params, seed: 11 });
    const sceneObjects = layout.objects.slice(1);

    for (let i = 0; i < sceneObjects.length; i++) {
      const first = sceneObjects[i];
      if (!first) continue;
      for (let j = i + 1; j < sceneObjects.length; j++) {
        const second = sceneObjects[j];
        if (!second) continue;
        const planar = Math.hypot(
          first.position.x - second.position.x,
          first.position.y - second.position.y
        );
        const firstHalfExtent = Math.max(first.size.x, first.size.y) * 0.5;
        const secondHalfExtent = Math.max(second.size.x, second.size.y) * 0.5;
        expect(planar).toBeGreaterThanOrEqual(
          firstHalfExtent +
            secondHalfExtent +
            WORLD_SCENARIO_NUMERIC_TOLERANCES.pairwiseSpacingMargin
        );
      }
    }
  });

  it("places the target above the pedestal top surface", () => {
    const layout = buildWorldScenarioLayout({ ...params, seed: 23 });
    const pedestal = layout.objects[0];
    expect(pedestal).toBeDefined();
    if (!pedestal) return;
    const pedestalTop = pedestal.position.z + pedestal.size.z * 0.5;
    expect(layout.targetPosition.z).toBeGreaterThan(pedestalTop);
  });

});

describe("buildWorldScenarioTimeline", () => {
  it("provides a long-horizon timeline with named events", () => {
    const timeline = buildWorldScenarioTimeline({ ...params, seed: 7 });
    expect(timeline.durationMs).toBeGreaterThanOrEqual(WORLD_SCENARIO_DURATION_MS);
    expect(timeline.events.map((event) => event.id)).toEqual(
      WORLD_SCENARIO_EVENTS.map((event) => event.id)
    );
  });

  it("keeps object key ordering stable across samples", () => {
    const timeline = buildWorldScenarioTimeline({ ...params, seed: 13 });
    const first = timeline.sampleAt(0);
    const second = timeline.sampleAt(3500);
    expect(first.objectKeys).toEqual(second.objectKeys);
    expect(first.objectKeys).toHaveLength(first.objects.length);
    expect(second.objectKeys).toHaveLength(second.objects.length);
  });

  it("activates scenario events in expected windows", () => {
    const timeline = buildWorldScenarioTimeline({ ...params, seed: 13 });
    const targetScan = WORLD_SCENARIO_EVENTS.find((event) => event.id === "target-scan");
    const laneShift = WORLD_SCENARIO_EVENTS.find((event) => event.id === "lane-shift");
    const rearProbe = WORLD_SCENARIO_EVENTS.find((event) => event.id === "rear-probe");
    expect(targetScan).toBeDefined();
    expect(laneShift).toBeDefined();
    expect(rearProbe).toBeDefined();
    if (!targetScan || !laneShift || !rearProbe) return;

    const targetScanMid = (targetScan.startMs + targetScan.endMs) * 0.5;
    const laneShiftBeforeStart = laneShift.startMs - 1;
    const laneShiftMid = (laneShift.startMs + laneShift.endMs) * 0.5;
    const rearProbeMid = (rearProbe.startMs + rearProbe.endMs) * 0.5;

    expect(timeline.sampleAt(targetScanMid).activeEventIds).toContain(targetScan.id);
    expect(timeline.sampleAt(laneShiftBeforeStart).activeEventIds).not.toContain(laneShift.id);
    expect(timeline.sampleAt(laneShiftMid).activeEventIds).toContain(laneShift.id);
    expect(timeline.sampleAt(rearProbeMid).activeEventIds).toContain(rearProbe.id);
  });

  it("can create a looping clock for scenario playback", () => {
    const timeline = buildWorldScenarioTimeline({ ...params, seed: 13 });
    const clock = timeline.createClock({ loop: true, initialTimeMs: timeline.durationMs - 150 });
    const t = clock.advance(300);
    expect(t).toBeLessThan(timeline.durationMs);
  });
});
