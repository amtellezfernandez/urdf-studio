import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { WORLD_OBJECT_GEOMETRY_PARAMS } from "@/features/objects/worldObjectGeometryParams";
import {
  WORLD_OBJECT_CUBE_CORNER_SIGNS,
  WORLD_OBJECT_CUBE_FACE_HANDLES,
  resolveCubeCornerOffset,
  resolveCubeFaceHandlePosition,
  resolveCubeResizeFromDraggedFace,
  resolveCubeUniformResize,
  resolveCubeCornerPosition,
  resolveCubeResizeFromDraggedCorner,
  resolveWorldCubeCornerPosition,
  resolveWorldCubeFaceHandlePosition,
  snapScalar,
  snapVector3,
  snapVector3OnAxes,
} from "@/features/objects/worldObjectEditMath";

describe("worldObjectEditMath", () => {
  it("resolves cube corner positions from center, size, and sign", () => {
    const center = new THREE.Vector3(1, 2, 3);
    const size = new THREE.Vector3(0.4, 0.6, 0.8);
    const sign = WORLD_OBJECT_CUBE_CORNER_SIGNS[7];

    const corner = resolveCubeCornerPosition(center, size, sign);

    expect(corner.x).toBe(1.2);
    expect(corner.y).toBe(2.3);
    expect(corner.z).toBe(3.4);
  });

  it("resolves world cube corner positions using object rotation", () => {
    const center = new THREE.Vector3(1, 2, 3);
    const size = new THREE.Vector3(2, 4, 6);
    const rotation = new THREE.Euler(0, 0, Math.PI / 2);

    const corner = resolveWorldCubeCornerPosition({
      center,
      size,
      rotation,
      sign: new THREE.Vector3(1, 1, 1),
    });

    expect(corner.x).toBeCloseTo(-1);
    expect(corner.y).toBeCloseTo(3);
    expect(corner.z).toBeCloseTo(6);
  });

  it("keeps the opposite corner fixed while resizing from a dragged corner", () => {
    const anchorCorner = new THREE.Vector3(-1, -1, -1);
    const draggedCorner = new THREE.Vector3(1, 2, 3);
    const handleSign = new THREE.Vector3(1, 1, 1);

    const result = resolveCubeResizeFromDraggedCorner({
      anchorCorner,
      draggedCorner,
      handleSign,
    });

    expect(result.position.x).toBe(0);
    expect(result.position.y).toBe(0.5);
    expect(result.position.z).toBe(1);
    expect(result.size.x).toBe(2);
    expect(result.size.y).toBe(3);
    expect(result.size.z).toBe(4);
  });

  it("clamps resize extents to the minimum cube size", () => {
    const anchorCorner = new THREE.Vector3(0, 0, 0);
    const draggedCorner = new THREE.Vector3(-1, -1, -1);
    const handleSign = new THREE.Vector3(1, 1, 1);

    const result = resolveCubeResizeFromDraggedCorner({
      anchorCorner,
      draggedCorner,
      handleSign,
    });

    expect(result.size.x).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(result.size.y).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(result.size.z).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(result.position.x).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM * 0.5);
    expect(result.position.y).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM * 0.5);
    expect(result.position.z).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM * 0.5);
  });

  it("resolves cube face handle positions from axis and direction", () => {
    const center = new THREE.Vector3(1, 2, 3);
    const size = new THREE.Vector3(0.4, 0.6, 0.8);
    const handle = WORLD_OBJECT_CUBE_FACE_HANDLES[1];

    const facePosition = resolveCubeFaceHandlePosition({
      center,
      size,
      axis: handle.axis,
      direction: handle.direction,
    });

    expect(facePosition.x).toBe(1.2);
    expect(facePosition.y).toBe(2);
    expect(facePosition.z).toBe(3);
  });

  it("resolves world cube face positions using object rotation", () => {
    const center = new THREE.Vector3(1, 2, 3);
    const size = new THREE.Vector3(2, 4, 6);
    const rotation = new THREE.Euler(0, 0, Math.PI / 2);

    const facePosition = resolveWorldCubeFaceHandlePosition({
      center,
      size,
      rotation,
      axis: "x",
      direction: 1,
    });

    expect(facePosition.x).toBeCloseTo(1);
    expect(facePosition.y).toBeCloseTo(3);
    expect(facePosition.z).toBeCloseTo(3);
  });

  it("keeps rotated opposite corners fixed when resizing in local space", () => {
    const center = new THREE.Vector3(5, 6, 7);
    const size = new THREE.Vector3(2, 2, 2);
    const rotation = new THREE.Euler(0, 0, Math.PI / 4);
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    const handleSign = new THREE.Vector3(1, 1, 1);
    const anchorLocal = resolveCubeCornerOffset(size, handleSign.clone().multiplyScalar(-1));
    const draggedLocal = new THREE.Vector3(3, 1, 1);

    const resized = resolveCubeResizeFromDraggedCorner({
      anchorCorner: anchorLocal,
      draggedCorner: draggedLocal,
      handleSign,
    });
    const nextCenter = center.clone().add(resized.position.clone().applyQuaternion(quaternion));
    const anchorWorldBefore = resolveWorldCubeCornerPosition({
      center,
      size,
      rotation,
      sign: handleSign.clone().multiplyScalar(-1),
    });
    const anchorWorldAfter = resolveWorldCubeCornerPosition({
      center: nextCenter,
      size: resized.size,
      rotation,
      sign: handleSign.clone().multiplyScalar(-1),
    });

    expect(anchorWorldAfter.x).toBeCloseTo(anchorWorldBefore.x);
    expect(anchorWorldAfter.y).toBeCloseTo(anchorWorldBefore.y);
    expect(anchorWorldAfter.z).toBeCloseTo(anchorWorldBefore.z);
  });

  it("resizes from a face handle on a single axis and shifts the center by half the delta", () => {
    const result = resolveCubeResizeFromDraggedFace({
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(1, 2, 3),
      axis: "x",
      direction: 1,
      axisDelta: 0.5,
    });

    expect(result.size.x).toBe(1.5);
    expect(result.size.y).toBe(2);
    expect(result.size.z).toBe(3);
    expect(result.position.x).toBe(0.25);
    expect(result.position.y).toBe(0);
    expect(result.position.z).toBe(0);
  });

  it("resizes uniformly around the center", () => {
    const result = resolveCubeUniformResize({
      position: new THREE.Vector3(1, 2, 3),
      size: new THREE.Vector3(1, 2, 3),
      sizeDelta: 0.5,
    });

    expect(result.position.x).toBe(1);
    expect(result.position.y).toBe(2);
    expect(result.position.z).toBe(3);
    expect(result.size.x).toBe(1.5);
    expect(result.size.y).toBe(2.5);
    expect(result.size.z).toBe(3.5);
  });

  it("clamps uniform resize to the minimum cube size", () => {
    const result = resolveCubeUniformResize({
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(0.2, 0.1, 0.3),
      sizeDelta: -0.5,
    });

    expect(result.size.x).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(result.size.y).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
    expect(result.size.z).toBe(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM);
  });

  it("snaps scalars to the nearest step", () => {
    expect(snapScalar(0.074, 0.05)).toBe(0.05);
    expect(snapScalar(0.076, 0.05)).toBe(0.1);
  });

  it("snaps vectors component-wise when enabled", () => {
    const result = snapVector3(new THREE.Vector3(0.074, 0.126, -0.024), 0.05);

    expect(result.x).toBe(0.05);
    expect(result.y).toBeCloseTo(0.15);
    expect(result.z).toBe(0);
  });

  it("snaps vectors only on the requested axes", () => {
    const result = snapVector3OnAxes(
      new THREE.Vector3(0.074, 0.126, -0.024),
      0.05,
      ["x", "z"]
    );

    expect(result.x).toBe(0.05);
    expect(result.y).toBe(0.126);
    expect(result.z).toBe(0);
  });
});
