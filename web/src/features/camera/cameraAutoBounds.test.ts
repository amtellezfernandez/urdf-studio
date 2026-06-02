import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeOwnedLinkLocalVisualMeshAlignedForwardCue,
  computeOwnedLinkLocalVisualMeshAlignedUpCue,
  computeOwnedLinkLocalVisualBounds,
  computeOwnedLinkLocalVisualBoundsCenter,
  computeOwnedLinkLocalVisualCentroid,
  computeOwnedLinkLocalVisualDirectionCue,
  computeOwnedLinkLocalVisualFrameCue,
  computeOwnedLinkLocalVisualMeshAlignedFrameCue,
  computeOwnedLinkLocalVisualPrincipalAxis,
  computeOwnedLinkLocalVisualUpCue,
} from "./cameraAutoBounds";
import { CAMERA_AUTO_FRAME_CUE_CONFIDENCE_MIN } from "./cameraAutoGenerationParams";

const UNIT_BOX_SIZE = 0.02;
const DESCENDANT_BOX_SIZE = 0.2;
const LINK_OFFSET_X = 1.5;
const LINK_OFFSET_Y = -0.2;
const LINK_OFFSET_Z = 0.3;
const VISUAL_MESH_OFFSET_X = 0.04;
const VISUAL_MESH_OFFSET_Y = -0.01;
const VISUAL_MESH_OFFSET_Z = 0.015;
const DESCENDANT_MESH_OFFSET_X = 1.0;
const DESCENDANT_MESH_OFFSET_Y = 1.0;
const DESCENDANT_MESH_OFFSET_Z = 1.0;
const ASYMMETRIC_TRIANGLE_POSITIONS = new Float32Array([
  0, 0, 0,
  2, 0, 0,
  0, 2, 0,
]);
const ASYMMETRIC_TRIANGLE_CENTROID_X = 2 / 3;
const ASYMMETRIC_TRIANGLE_CENTROID_Y = 2 / 3;
const ASYMMETRIC_TRIANGLE_CENTROID_Z = 0;
const UNIT_TETRAHEDRON_VERTICES = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);
const UNIT_TETRAHEDRON_INDICES = new Uint16Array([
  0, 2, 1,
  0, 1, 3,
  0, 3, 2,
  1, 2, 3,
]);
const UNIT_TETRAHEDRON_COM_X = 0.25;
const UNIT_TETRAHEDRON_COM_Y = 0.25;
const UNIT_TETRAHEDRON_COM_Z = 0.25;
const DIRECTION_ALIGNMENT_THRESHOLD = 0.99;
const DIRECTION_DIAGONAL_ALIGNMENT_THRESHOLD = 0.985;
const PROTRUSION_BASE_SIZE = 0.1;
const PROTRUSION_FEATURE_SIZE = 0.04;
const PROTRUSION_OFFSET_X = 0.09;
const PROTRUSION_OFFSET_DIAGONAL_X = 0.08;
const PROTRUSION_OFFSET_DIAGONAL_Y = 0.05;
const ELONGATED_BOX_SIZE_X = 0.2;
const ELONGATED_BOX_SIZE_Y = 0.03;
const ELONGATED_BOX_SIZE_Z = 0.03;
const PRINCIPAL_AXIS_ALIGNMENT_THRESHOLD = 0.99;
const UP_CUE_ORTHOGONALITY_THRESHOLD = 0.99;
const MASS_BIASED_BODY_SIZE = 0.1;
const MASS_BIASED_SIDE_BALLAST_SIZE = 0.08;
const MASS_BIASED_LENS_SIZE_X = 0.12;
const MASS_BIASED_LENS_SIZE_Y = 0.02;
const MASS_BIASED_LENS_SIZE_Z = 0.02;
const MASS_BIASED_SIDE_BALLAST_OFFSET_Y = 0.07;
const MASS_BIASED_LENS_OFFSET_X = 0.1;
const LINK_WORLD_ROTATION_RAD_X = Math.PI / 2;
const UP_CUE_WORLD_UP_ALIGNMENT_THRESHOLD = 0.9;
const FRAME_AXIS_ALIGNMENT_THRESHOLD = 0.9;
const FRAME_ORTHOGONALITY_THRESHOLD = 0.999999;
const MESH_AXIS_ROTATION_RAD_X = Math.PI / 6;

const createBoxMesh = (size: number) => new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
const createAsymmetricTriangleMesh = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(ASYMMETRIC_TRIANGLE_POSITIONS, 3));
  return new THREE.Mesh(geometry);
};
const createUnitTetrahedronMesh = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(UNIT_TETRAHEDRON_VERTICES, 3));
  geometry.setIndex(new THREE.BufferAttribute(UNIT_TETRAHEDRON_INDICES, 1));
  return new THREE.Mesh(geometry);
};
const createProtrudingCameraLikeLink = (
  protrusionOffset: THREE.Vector3 = new THREE.Vector3(PROTRUSION_OFFSET_X, 0, 0)
) => {
  const link = new THREE.Group();
  const base = createBoxMesh(PROTRUSION_BASE_SIZE);
  const protrusion = createBoxMesh(PROTRUSION_FEATURE_SIZE);
  protrusion.position.copy(protrusionOffset);
  link.add(base, protrusion);
  return link;
};
const createElongatedAxisAlignedLink = () => {
  const link = new THREE.Group();
  link.add(new THREE.Mesh(new THREE.BoxGeometry(ELONGATED_BOX_SIZE_X, ELONGATED_BOX_SIZE_Y, ELONGATED_BOX_SIZE_Z)));
  return link;
};
const createMassBiasedLensLikeLink = () => {
  const link = new THREE.Group();
  const body = createBoxMesh(MASS_BIASED_BODY_SIZE);
  const sideBallast = createBoxMesh(MASS_BIASED_SIDE_BALLAST_SIZE);
  sideBallast.position.set(0, MASS_BIASED_SIDE_BALLAST_OFFSET_Y, 0);
  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(
      MASS_BIASED_LENS_SIZE_X,
      MASS_BIASED_LENS_SIZE_Y,
      MASS_BIASED_LENS_SIZE_Z
    )
  );
  lens.position.set(MASS_BIASED_LENS_OFFSET_X, 0, 0);
  link.add(body, sideBallast, lens);
  return link;
};

describe("computeOwnedLinkLocalVisualBounds", () => {
  it("includes mesh geometry nested under visual groups", () => {
    const link = new THREE.Group();
    const visual = new THREE.Group();
    (visual as THREE.Group & { isURDFVisual?: boolean }).isURDFVisual = true;
    const mesh = createBoxMesh(UNIT_BOX_SIZE);
    mesh.position.set(VISUAL_MESH_OFFSET_X, VISUAL_MESH_OFFSET_Y, VISUAL_MESH_OFFSET_Z);
    visual.add(mesh);
    link.add(visual);

    const bounds = computeOwnedLinkLocalVisualBounds(link);
    expect(bounds).not.toBeNull();
    const center = bounds!.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(VISUAL_MESH_OFFSET_X, 8);
    expect(center.y).toBeCloseTo(VISUAL_MESH_OFFSET_Y, 8);
    expect(center.z).toBeCloseTo(VISUAL_MESH_OFFSET_Z, 8);
  });

  it("excludes descendant URDF link meshes from current link bounds", () => {
    const link = new THREE.Group();
    const ownMesh = createBoxMesh(UNIT_BOX_SIZE);
    link.add(ownMesh);

    const childLink = new THREE.Group();
    (childLink as THREE.Group & { isURDFLink?: boolean }).isURDFLink = true;
    const descendantMesh = createBoxMesh(DESCENDANT_BOX_SIZE);
    descendantMesh.position.set(
      DESCENDANT_MESH_OFFSET_X,
      DESCENDANT_MESH_OFFSET_Y,
      DESCENDANT_MESH_OFFSET_Z
    );
    childLink.add(descendantMesh);
    link.add(childLink);

    const bounds = computeOwnedLinkLocalVisualBounds(link);
    expect(bounds).not.toBeNull();
    const size = bounds!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(UNIT_BOX_SIZE, 8);
    expect(size.y).toBeCloseTo(UNIT_BOX_SIZE, 8);
    expect(size.z).toBeCloseTo(UNIT_BOX_SIZE, 8);
  });

  it("returns bounds in link-local frame when link is transformed in world", () => {
    const link = new THREE.Group();
    link.position.set(LINK_OFFSET_X, LINK_OFFSET_Y, LINK_OFFSET_Z);
    const mesh = createBoxMesh(UNIT_BOX_SIZE);
    mesh.position.set(VISUAL_MESH_OFFSET_X, VISUAL_MESH_OFFSET_Y, VISUAL_MESH_OFFSET_Z);
    link.add(mesh);

    const bounds = computeOwnedLinkLocalVisualBounds(link);
    expect(bounds).not.toBeNull();
    const center = bounds!.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(VISUAL_MESH_OFFSET_X, 8);
    expect(center.y).toBeCloseTo(VISUAL_MESH_OFFSET_Y, 8);
    expect(center.z).toBeCloseTo(VISUAL_MESH_OFFSET_Z, 8);
  });
});

describe("computeOwnedLinkLocalVisualBoundsCenter", () => {
  it("returns the visual-bounds center in link-local frame", () => {
    const link = new THREE.Group();
    const leftMesh = createBoxMesh(UNIT_BOX_SIZE);
    leftMesh.position.set(-0.04, 0, 0);
    const rightMesh = createBoxMesh(UNIT_BOX_SIZE);
    rightMesh.position.set(0.08, 0, 0);
    link.add(leftMesh, rightMesh);

    const center = computeOwnedLinkLocalVisualBoundsCenter(link);

    expect(center).not.toBeNull();
    expect(center!.x).toBeCloseTo(0.02, 8);
    expect(center!.y).toBeCloseTo(0, 8);
    expect(center!.z).toBeCloseTo(0, 8);
  });
});

describe("computeOwnedLinkLocalVisualCentroid", () => {
  it("returns centroid for nested visual mesh in link-local frame", () => {
    const link = new THREE.Group();
    const visual = new THREE.Group();
    (visual as THREE.Group & { isURDFVisual?: boolean }).isURDFVisual = true;
    const mesh = createBoxMesh(UNIT_BOX_SIZE);
    mesh.position.set(VISUAL_MESH_OFFSET_X, VISUAL_MESH_OFFSET_Y, VISUAL_MESH_OFFSET_Z);
    visual.add(mesh);
    link.add(visual);

    const centroid = computeOwnedLinkLocalVisualCentroid(link);
    expect(centroid).not.toBeNull();
    expect(centroid!.x).toBeCloseTo(VISUAL_MESH_OFFSET_X, 8);
    expect(centroid!.y).toBeCloseTo(VISUAL_MESH_OFFSET_Y, 8);
    expect(centroid!.z).toBeCloseTo(VISUAL_MESH_OFFSET_Z, 8);
  });

  it("excludes descendant URDF link meshes from centroid", () => {
    const link = new THREE.Group();
    const ownMesh = createBoxMesh(UNIT_BOX_SIZE);
    link.add(ownMesh);

    const childLink = new THREE.Group();
    (childLink as THREE.Group & { isURDFLink?: boolean }).isURDFLink = true;
    const descendantMesh = createBoxMesh(DESCENDANT_BOX_SIZE);
    descendantMesh.position.set(
      DESCENDANT_MESH_OFFSET_X,
      DESCENDANT_MESH_OFFSET_Y,
      DESCENDANT_MESH_OFFSET_Z
    );
    childLink.add(descendantMesh);
    link.add(childLink);

    const centroid = computeOwnedLinkLocalVisualCentroid(link);
    expect(centroid).not.toBeNull();
    expect(centroid!.x).toBeCloseTo(0, 8);
    expect(centroid!.y).toBeCloseTo(0, 8);
    expect(centroid!.z).toBeCloseTo(0, 8);
  });

  it("returns area-weighted centroid for asymmetric triangle mesh", () => {
    const link = new THREE.Group();
    link.add(createAsymmetricTriangleMesh());

    const centroid = computeOwnedLinkLocalVisualCentroid(link);
    expect(centroid).not.toBeNull();
    expect(centroid!.x).toBeCloseTo(ASYMMETRIC_TRIANGLE_CENTROID_X, 8);
    expect(centroid!.y).toBeCloseTo(ASYMMETRIC_TRIANGLE_CENTROID_Y, 8);
    expect(centroid!.z).toBeCloseTo(ASYMMETRIC_TRIANGLE_CENTROID_Z, 8);
  });

  it("returns volume-weighted centroid for closed tetrahedron mesh", () => {
    const link = new THREE.Group();
    link.add(createUnitTetrahedronMesh());

    const centroid = computeOwnedLinkLocalVisualCentroid(link);
    expect(centroid).not.toBeNull();
    expect(centroid!.x).toBeCloseTo(UNIT_TETRAHEDRON_COM_X, 8);
    expect(centroid!.y).toBeCloseTo(UNIT_TETRAHEDRON_COM_Y, 8);
    expect(centroid!.z).toBeCloseTo(UNIT_TETRAHEDRON_COM_Z, 8);
  });
});

describe("computeOwnedLinkLocalVisualDirectionCue", () => {
  it("returns +X direction for a link with a clear +X protrusion", () => {
    const link = createProtrudingCameraLikeLink();
    const cue = computeOwnedLinkLocalVisualDirectionCue(link, new THREE.Vector3(0, 0, 0));
    expect(cue).not.toBeNull();
    expect(cue!.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(DIRECTION_ALIGNMENT_THRESHOLD);
  });

  it("returns angled direction for a diagonal protrusion", () => {
    const protrusionOffset = new THREE.Vector3(
      PROTRUSION_OFFSET_DIAGONAL_X,
      PROTRUSION_OFFSET_DIAGONAL_Y,
      0
    );
    const link = createProtrudingCameraLikeLink(protrusionOffset);
    const cue = computeOwnedLinkLocalVisualDirectionCue(link, new THREE.Vector3(0, 0, 0));
    expect(cue).not.toBeNull();
    const expectedDirection = protrusionOffset.clone().normalize();
    expect(cue!.dot(expectedDirection)).toBeGreaterThan(DIRECTION_DIAGONAL_ALIGNMENT_THRESHOLD);
  });

  it("returns null for symmetric geometry without directional asymmetry", () => {
    const link = new THREE.Group();
    link.add(createBoxMesh(PROTRUSION_BASE_SIZE));
    const cue = computeOwnedLinkLocalVisualDirectionCue(link, new THREE.Vector3(0, 0, 0));
    expect(cue).toBeNull();
  });

  it("ignores descendant link geometry for direction cue extraction", () => {
    const link = createProtrudingCameraLikeLink();

    const childLink = new THREE.Group();
    (childLink as THREE.Group & { isURDFLink?: boolean }).isURDFLink = true;
    const descendantFeature = createBoxMesh(PROTRUSION_FEATURE_SIZE * 2);
    descendantFeature.position.set(-PROTRUSION_OFFSET_X * 2, 0, 0);
    childLink.add(descendantFeature);
    link.add(childLink);

    const cue = computeOwnedLinkLocalVisualDirectionCue(link, new THREE.Vector3(0, 0, 0));
    expect(cue).not.toBeNull();
    expect(cue!.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(DIRECTION_ALIGNMENT_THRESHOLD);
  });

  it("prefers front lens-like protrusion direction over side-mass bias", () => {
    const link = createMassBiasedLensLikeLink();
    const cue = computeOwnedLinkLocalVisualDirectionCue(link, new THREE.Vector3(0, 0, 0));
    expect(cue).not.toBeNull();
    expect(cue!.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(DIRECTION_ALIGNMENT_THRESHOLD);
  });
});

describe("computeOwnedLinkLocalVisualPrincipalAxis", () => {
  it("returns principal axis for elongated mesh when cue is ambiguous", () => {
    const link = createElongatedAxisAlignedLink();
    const center = new THREE.Vector3(0, 0, 0);

    const directionCue = computeOwnedLinkLocalVisualDirectionCue(link, center);
    expect(directionCue).toBeNull();

    const principalAxis = computeOwnedLinkLocalVisualPrincipalAxis(link, center);
    expect(principalAxis).not.toBeNull();
    expect(
      Math.abs(principalAxis!.dot(new THREE.Vector3(1, 0, 0)))
    ).toBeGreaterThan(PRINCIPAL_AXIS_ALIGNMENT_THRESHOLD);
  });
});

describe("computeOwnedLinkLocalVisualUpCue", () => {
  it("returns a stable up cue orthogonal to forward direction", () => {
    const link = createMassBiasedLensLikeLink();
    const center = new THREE.Vector3(0, 0, 0);
    const forwardCue = computeOwnedLinkLocalVisualDirectionCue(link, center);
    expect(forwardCue).not.toBeNull();

    const upCue = computeOwnedLinkLocalVisualUpCue(link, center, forwardCue!);
    expect(upCue).not.toBeNull();
    expect(Math.abs(upCue!.dot(forwardCue!))).toBeLessThan(1 - UP_CUE_ORTHOGONALITY_THRESHOLD);
  });

  it("aligns up cue with world-up projected into link-local frame for rotated links", () => {
    const link = createMassBiasedLensLikeLink();
    link.rotation.x = LINK_WORLD_ROTATION_RAD_X;
    const center = new THREE.Vector3(0, 0, 0);
    const forwardCue = computeOwnedLinkLocalVisualDirectionCue(link, center);
    expect(forwardCue).not.toBeNull();

    const upCue = computeOwnedLinkLocalVisualUpCue(link, center, forwardCue!);
    expect(upCue).not.toBeNull();

    link.updateMatrixWorld(true);
    const worldQuaternion = new THREE.Quaternion();
    link.matrixWorld.decompose(
      new THREE.Vector3(),
      worldQuaternion,
      new THREE.Vector3()
    );
    const expectedLocalWorldUp = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(worldQuaternion.invert())
      .normalize();
    expect(upCue!.dot(expectedLocalWorldUp)).toBeGreaterThan(
      UP_CUE_WORLD_UP_ALIGNMENT_THRESHOLD
    );
  });
});

describe("computeOwnedLinkLocalVisualFrameCue", () => {
  it("extracts mesh-aligned right/up axes from camera-link geometry", () => {
    const link = createMassBiasedLensLikeLink();
    const center = new THREE.Vector3(0, 0, 0);
    const forwardCue = computeOwnedLinkLocalVisualDirectionCue(link, center);
    expect(forwardCue).not.toBeNull();

    const frameCue = computeOwnedLinkLocalVisualFrameCue(link, center, forwardCue!);
    expect(frameCue).not.toBeNull();
    expect(frameCue!.forward.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
    expect(Math.abs(frameCue!.right.dot(frameCue!.forward))).toBeLessThan(
      1 - FRAME_ORTHOGONALITY_THRESHOLD
    );
    expect(Math.abs(frameCue!.up.dot(frameCue!.forward))).toBeLessThan(
      1 - FRAME_ORTHOGONALITY_THRESHOLD
    );
    expect(frameCue!.up.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
    expect(frameCue!.confidence).toBeGreaterThanOrEqual(CAMERA_AUTO_FRAME_CUE_CONFIDENCE_MIN);
  });

  it("returns null for symmetric planar spread around forward axis", () => {
    const link = new THREE.Group();
    link.add(createBoxMesh(PROTRUSION_BASE_SIZE));
    const frameCue = computeOwnedLinkLocalVisualFrameCue(
      link,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0)
    );
    expect(frameCue).toBeNull();
  });

  it("keeps local frame cues stable when link is rotated in world", () => {
    const link = createMassBiasedLensLikeLink();
    link.rotation.set(LINK_WORLD_ROTATION_RAD_X, 0, 0);
    const center = new THREE.Vector3(0, 0, 0);
    const forwardCue = computeOwnedLinkLocalVisualDirectionCue(link, center);
    expect(forwardCue).not.toBeNull();

    const frameCue = computeOwnedLinkLocalVisualFrameCue(link, center, forwardCue!);
    expect(frameCue).not.toBeNull();
    expect(frameCue!.forward.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
    expect(frameCue!.up.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
    expect(frameCue!.right.dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
  });
});

describe("computeOwnedLinkLocalVisualMeshAlignedUpCue", () => {
  it("returns mesh-axis up cue aligned with rotated mesh local axis", () => {
    const link = new THREE.Group();
    const mesh = createBoxMesh(MASS_BIASED_BODY_SIZE);
    mesh.rotation.x = MESH_AXIS_ROTATION_RAD_X;
    link.add(mesh);

    const upCue = computeOwnedLinkLocalVisualMeshAlignedUpCue(
      link,
      new THREE.Vector3(1, 0, 0)
    );
    expect(upCue).not.toBeNull();
    const expectedUp = new THREE.Vector3(0, 0, 1)
      .applyEuler(new THREE.Euler(MESH_AXIS_ROTATION_RAD_X, 0, 0, "XYZ"))
      .normalize();
    expect(upCue!.dot(expectedUp)).toBeGreaterThan(FRAME_AXIS_ALIGNMENT_THRESHOLD);
  });
});

describe("computeOwnedLinkLocalVisualMeshAlignedForwardCue", () => {
  it("returns mesh-axis forward cue aligned with rotated mesh local axis", () => {
    const link = new THREE.Group();
    const mesh = createBoxMesh(MASS_BIASED_BODY_SIZE);
    mesh.rotation.y = MESH_AXIS_ROTATION_RAD_X;
    link.add(mesh);

    const desiredForward = new THREE.Vector3(1, 0, 0)
      .applyEuler(new THREE.Euler(0, MESH_AXIS_ROTATION_RAD_X, 0, "XYZ"))
      .normalize();
    const forwardCue = computeOwnedLinkLocalVisualMeshAlignedForwardCue(
      link,
      desiredForward
    );
    expect(forwardCue).not.toBeNull();
    expect(forwardCue!.dot(desiredForward)).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
  });
});

describe("computeOwnedLinkLocalVisualMeshAlignedFrameCue", () => {
  it("returns coherent forward/up axes from the same mesh basis", () => {
    const link = new THREE.Group();
    const mesh = createBoxMesh(MASS_BIASED_BODY_SIZE);
    mesh.rotation.x = MESH_AXIS_ROTATION_RAD_X;
    link.add(mesh);

    const desiredForward = new THREE.Vector3(1, 0, 0);
    const frameCue = computeOwnedLinkLocalVisualMeshAlignedFrameCue(
      link,
      desiredForward
    );
    expect(frameCue).not.toBeNull();

    const expectedUp = new THREE.Vector3(0, 0, 1)
      .applyEuler(new THREE.Euler(MESH_AXIS_ROTATION_RAD_X, 0, 0, "XYZ"))
      .normalize();
    const expectedRight = new THREE.Vector3()
      .crossVectors(expectedUp, desiredForward)
      .normalize();

    expect(frameCue!.forward.dot(desiredForward)).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
    expect(frameCue!.up.dot(expectedUp)).toBeGreaterThan(FRAME_AXIS_ALIGNMENT_THRESHOLD);
    expect(frameCue!.right.dot(expectedRight)).toBeGreaterThan(
      FRAME_AXIS_ALIGNMENT_THRESHOLD
    );
    expect(Math.abs(frameCue!.forward.dot(frameCue!.up))).toBeLessThan(
      1 - FRAME_ORTHOGONALITY_THRESHOLD
    );
  });
});
