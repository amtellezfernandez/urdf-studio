/** @vitest-environment jsdom */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sanitizeMeshObject } from "./meshSanitizer";
import {
  MESH_SANITIZER_MAX_INERTIA_TRACE_CHANGE_RATIO,
  MESH_SANITIZER_MAX_MASS_LOSS_RATIO,
} from "./meshSanitizerParams";

const createBoxMesh = (size: number, position: [number, number, number]): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
  mesh.position.set(...position);
  return mesh;
};

const NEGLIGIBLE_DUST_SIZE = 0.04;
const NEGLIGIBLE_DUST_CENTERS: Array<[number, number, number]> = [
  [0.56, 0, 0],
  [-0.56, 0, 0],
  [0, 0.56, 0],
  [0, -0.56, 0],
  [0, 0, 0.56],
  [0, 0, -0.56],
  [0.56, 0.18, 0],
  [-0.56, -0.18, 0],
  [0, 0.56, 0.18],
  [0, -0.56, -0.18],
];

describe("meshSanitizer", () => {
  it("removes floating dust components while retaining nearly all volume", () => {
    const group = new THREE.Group();
    group.add(createBoxMesh(1, [0, 0, 0]));
    NEGLIGIBLE_DUST_CENTERS.forEach((center) => group.add(createBoxMesh(NEGLIGIBLE_DUST_SIZE, center)));

    const result = sanitizeMeshObject(group);

    expect(result.diagnostics.status).toBe("sanitized");
    expect(result.diagnostics.removedComponents).toBe(10);
    expect(result.diagnostics.volumeRetainedRatio).toBeGreaterThan(0.99);
    expect(result.diagnostics.deletionSafetyReport.status).toBe("safe");
    expect(result.diagnostics.deletionSafetyReport.metrics.normalizedComShiftRatio).toBeLessThan(1);
    expect(result.diagnostics.finalTriangleCount).toBeLessThan(result.diagnostics.originalTriangleCount);
  });

  it("preserves symmetric disconnected bodies with comparable volume", () => {
    const group = new THREE.Group();
    group.add(createBoxMesh(1, [-1, 0, 0]));
    group.add(createBoxMesh(1, [1, 0, 0]));

    const result = sanitizeMeshObject(group);

    expect(result.diagnostics.status).toBe("unchanged");
    expect(result.diagnostics.removedComponents).toBe(0);
    expect(result.diagnostics.volumeRetainedRatio).toBe(1);
    expect(result.diagnostics.deletionSafetyReport.status).toBe("not-applicable");
  });

  it("blocks cleanup when disconnected components exceed the deletion guardrail", () => {
    const group = new THREE.Group();
    group.add(createBoxMesh(1, [0, 0, 0]));
    group.add(createBoxMesh(0.34, [4, 0, 0]));
    group.add(createBoxMesh(0.34, [-4, 0, 0]));

    const result = sanitizeMeshObject(group);

    expect(result.diagnostics.status).toBe("excessive-deletion");
    expect(result.diagnostics.removedComponents).toBe(2);
    expect(result.diagnostics.volumeRetainedRatio).toBeLessThan(0.95);
  });

  it("blocks cleanup for manual review when deletion shifts the center of mass too much", () => {
    const group = new THREE.Group();
    group.add(createBoxMesh(1, [0, 0, 0]));
    group.add(createBoxMesh(0.09, [2.5, 0, 0]));

    const result = sanitizeMeshObject(group);

    expect(result.diagnostics.status).toBe("excessive-deletion");
    expect(result.diagnostics.deletionSafetyReport.status).toBe("manual-review");
    expect(result.diagnostics.deletionSafetyReport.reasons.length).toBeGreaterThan(0);
    expect(
      result.diagnostics.deletionSafetyReport.metrics.massLossRatio > MESH_SANITIZER_MAX_MASS_LOSS_RATIO ||
        result.diagnostics.deletionSafetyReport.metrics.inertiaTraceChangeRatio >
          MESH_SANITIZER_MAX_INERTIA_TRACE_CHANGE_RATIO
    ).toBe(true);
  });
});
