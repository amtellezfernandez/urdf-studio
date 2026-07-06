import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createInertiaCrossGeometry,
  createInertiaEdgeMaterialsByGroup,
  createInertiaFillMaterialsByGroup,
  createInertiaOverlayMaterial,
  createInertiaReferenceMaterial,
} from "@/features/viewer/inertialVisualizationRenderResources";
import {
  INERTIA_REFERENCE_BOX_COLOR,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_VOLUME_EDGE_OPACITY,
} from "@/features/viewer/inertialVisualizationParams";

describe("inertialVisualizationRenderResources", () => {
  it("builds cross geometry with three centered line segments", () => {
    const geometry = createInertiaCrossGeometry(0.02);
    const positions = geometry.getAttribute("position");

    expect(positions.count).toBe(6);
    expect(positions.getX(0)).toBeCloseTo(-0.0288);
    expect(positions.getX(1)).toBeCloseTo(0.0288);
    expect(positions.getY(2)).toBeCloseTo(-0.0288);
    expect(positions.getY(3)).toBeCloseTo(0.0288);
    expect(positions.getZ(4)).toBeCloseTo(-0.0288);
    expect(positions.getZ(5)).toBeCloseTo(0.0288);

    geometry.dispose();
  });

  it("creates solid and wireframe inertia overlay materials with matching offsets", () => {
    const solid = createInertiaOverlayMaterial({
      color: 0x123456,
      opacity: 0.25,
      wireframe: false,
    });
    const wireframe = createInertiaOverlayMaterial({
      color: 0x654321,
      opacity: 0.5,
      wireframe: true,
    });

    expect(solid).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(solid.color.getHex()).toBe(0x123456);
    expect(solid.opacity).toBe(0.25);
    expect(solid.polygonOffsetFactor).toBe(-1);
    expect(wireframe.wireframe).toBe(true);
    expect(wireframe.polygonOffsetFactor).toBe(-3);
    expect(wireframe.polygonOffsetUnits).toBe(-3);

    solid.dispose();
    wireframe.dispose();
  });

  it("creates grouped fill and edge materials for inertia metrics", () => {
    const fillMaterials = createInertiaFillMaterialsByGroup(0.22);
    const edgeMaterials = createInertiaEdgeMaterialsByGroup();

    expect(fillMaterials.healthy.color.getHex()).toBe(INERTIA_SHAPE_FILL_COLOR_HEALTHY);
    expect(fillMaterials.healthy.opacity).toBe(0.22);
    expect(fillMaterials.healthy.wireframe).toBe(false);
    expect(edgeMaterials.healthy.opacity).toBe(INERTIA_VOLUME_EDGE_OPACITY);
    expect(edgeMaterials.healthy.wireframe).toBe(true);

    Object.values(fillMaterials).forEach((material) => material.dispose());
    Object.values(edgeMaterials).forEach((material) => material.dispose());
  });

  it("creates reference material with depth-tested wireframe styling", () => {
    const material = createInertiaReferenceMaterial();

    expect(material.color.getHex()).toBe(INERTIA_REFERENCE_BOX_COLOR);
    expect(material.wireframe).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.polygonOffsetFactor).toBe(-2);

    material.dispose();
  });
});
