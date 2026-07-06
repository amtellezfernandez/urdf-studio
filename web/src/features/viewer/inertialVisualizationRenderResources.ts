import * as THREE from "three";
import {
  INERTIA_CENTER_MARKER_COLOR,
  INERTIA_CENTER_MARKER_OPACITY,
  INERTIA_CENTER_OFFSET_LINE_RADIAL_SEGMENTS,
  INERTIA_DEEMPHASIZED_OUTLINE_COLOR,
  INERTIA_DEEMPHASIZED_OUTLINE_OPACITY,
  INERTIA_REFERENCE_BOX_COLOR,
  INERTIA_REFERENCE_BOX_OPACITY,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  INERTIA_SHAPE_FILL_COLOR_UNVERIFIED,
  INERTIA_SHAPE_FILL_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
  INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
  INERTIA_VOLUME_EDGE_COLOR_UNVERIFIED,
  INERTIA_VOLUME_EDGE_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_OPACITY,
} from "@/features/viewer/inertialVisualizationParams";
import type { InertiaVisualizationMetricGroupKey } from "@/features/viewer/inertialVisualizationGroups";

export type InertiaVisualizationMaterialGroup = Record<
  InertiaVisualizationMetricGroupKey,
  THREE.MeshBasicMaterial
>;

export const createInertiaCrossGeometry = (globalSize: number): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  const extent = globalSize * 1.44;
  const points = new Float32Array([
    -extent,
    0,
    0,
    extent,
    0,
    0,
    0,
    -extent,
    0,
    0,
    extent,
    0,
    0,
    0,
    -extent,
    0,
    0,
    extent,
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  return geometry;
};

export const createGlobalComGeometry = (globalSize: number): THREE.OctahedronGeometry =>
  new THREE.OctahedronGeometry(globalSize * 1.2, 0);

export const createLinkComGeometry = (linkSize: number): THREE.OctahedronGeometry =>
  new THREE.OctahedronGeometry(linkSize * 1.2, 0);

export const createInertiaCenterMarkerGeometry = (): THREE.CylinderGeometry =>
  new THREE.CylinderGeometry(1, 1, 1, INERTIA_CENTER_OFFSET_LINE_RADIAL_SEGMENTS);

export const createComLineMaterial = (color: number): THREE.LineBasicMaterial =>
  new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });

export const createGlobalComMaterial = (color: number): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });

export const createLinkComMaterial = (color: number): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });

export const createInertiaOverlayMaterial = ({
  color,
  opacity,
  wireframe,
}: {
  color: number;
  opacity: number;
  wireframe: boolean;
}): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    wireframe,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: wireframe ? -3 : -1,
    polygonOffsetUnits: wireframe ? -3 : -1,
  });

export const createInertiaFillMaterialsByGroup = (
  inertiaOpacity: number
): InertiaVisualizationMaterialGroup => ({
  healthy: createInertiaOverlayMaterial({
    color: INERTIA_SHAPE_FILL_COLOR_HEALTHY,
    opacity: inertiaOpacity,
    wireframe: false,
  }),
  warning: createInertiaOverlayMaterial({
    color: INERTIA_SHAPE_FILL_COLOR_WARNING,
    opacity: inertiaOpacity,
    wireframe: false,
  }),
  problematic: createInertiaOverlayMaterial({
    color: INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
    opacity: inertiaOpacity,
    wireframe: false,
  }),
  unverified: createInertiaOverlayMaterial({
    color: INERTIA_SHAPE_FILL_COLOR_UNVERIFIED,
    opacity: inertiaOpacity,
    wireframe: false,
  }),
});

export const createInertiaEdgeMaterialsByGroup = (): InertiaVisualizationMaterialGroup => ({
  healthy: createInertiaOverlayMaterial({
    color: INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
    opacity: INERTIA_VOLUME_EDGE_OPACITY,
    wireframe: true,
  }),
  warning: createInertiaOverlayMaterial({
    color: INERTIA_VOLUME_EDGE_COLOR_WARNING,
    opacity: INERTIA_VOLUME_EDGE_OPACITY,
    wireframe: true,
  }),
  problematic: createInertiaOverlayMaterial({
    color: INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
    opacity: INERTIA_VOLUME_EDGE_OPACITY,
    wireframe: true,
  }),
  unverified: createInertiaOverlayMaterial({
    color: INERTIA_VOLUME_EDGE_COLOR_UNVERIFIED,
    opacity: INERTIA_VOLUME_EDGE_OPACITY,
    wireframe: true,
  }),
});

export const createInertiaCenterMarkerMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: INERTIA_CENTER_MARKER_COLOR,
    transparent: true,
    opacity: INERTIA_CENTER_MARKER_OPACITY,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

export const createInertiaReferenceMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: INERTIA_REFERENCE_BOX_COLOR,
    transparent: true,
    opacity: INERTIA_REFERENCE_BOX_OPACITY,
    wireframe: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

export const createInertiaDeemphasizedOutlineMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: INERTIA_DEEMPHASIZED_OUTLINE_COLOR,
    transparent: true,
    opacity: INERTIA_DEEMPHASIZED_OUTLINE_OPACITY,
    wireframe: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
