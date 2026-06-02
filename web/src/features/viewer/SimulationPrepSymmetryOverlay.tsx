import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RepeatedInertiaSymmetryCenterMode } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";
import {
  SIMULATION_PREP_SYMMETRY_OVERLAY_AFFECTED_MARKER_COLOR,
  SIMULATION_PREP_SYMMETRY_OVERLAY_AFFECTED_MARKER_RADIUS_METERS,
  SIMULATION_PREP_SYMMETRY_OVERLAY_DIVERGENCE_MARKER_SCALE,
  SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS,
  SIMULATION_PREP_SYMMETRY_OVERLAY_MARKER_OPACITY,
  SIMULATION_PREP_SYMMETRY_OVERLAY_MISALIGNMENT_COLOR,
  SIMULATION_PREP_SYMMETRY_OVERLAY_MISALIGNMENT_OPACITY,
  SIMULATION_PREP_SYMMETRY_OVERLAY_MIN_SEGMENT_LENGTH_METERS,
  SIMULATION_PREP_SYMMETRY_OVERLAY_RENDER_ORDER,
  SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_GUIDE_COLOR,
  SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_GUIDE_OPACITY,
  SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_MIN_RADIUS_METERS,
  SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_RADIUS_SCALE,
  SIMULATION_PREP_SYMMETRY_OVERLAY_SPHERE_SEGMENTS,
} from "@/features/viewer/symmetryVisualizationParams";

type VectorAxis = "x" | "y" | "z";

const WORLD_UP = new THREE.Vector3(0, 0, 1);

const resolveMedian = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex] ?? 0;
  }
  return ((sortedValues[middleIndex - 1] ?? 0) + (sortedValues[middleIndex] ?? 0)) / 2;
};

const buildCenteredIdealPoint = ({
  idealRadiusMeters,
  idealPointMeters,
  originCenterMeters,
  targetCenterMeters,
}: {
  idealRadiusMeters: number | null;
  idealPointMeters: [number, number, number];
  originCenterMeters: THREE.Vector3;
  targetCenterMeters: THREE.Vector3;
}): THREE.Vector3 => {
  const idealOffset = new THREE.Vector3().fromArray(idealPointMeters).sub(originCenterMeters);
  const resolvedRadiusMeters =
    idealRadiusMeters != null && idealRadiusMeters > Number.EPSILON
      ? idealRadiusMeters
      : idealOffset.length();
  if (resolvedRadiusMeters <= Number.EPSILON) {
    return targetCenterMeters.clone();
  }
  return targetCenterMeters
    .clone()
    .addScaledVector(idealOffset.normalize(), resolvedRadiusMeters);
};

const buildTranslatedIdealPoint = ({
  idealPointMeters,
  originCenterMeters,
  targetCenterMeters,
}: {
  idealPointMeters: [number, number, number];
  originCenterMeters: THREE.Vector3;
  targetCenterMeters: THREE.Vector3;
}): THREE.Vector3 =>
  targetCenterMeters
    .clone()
    .add(new THREE.Vector3().fromArray(idealPointMeters).sub(originCenterMeters));

const normalizeAngleRadians = (angle: number): number => {
  const normalizedAngle = angle % (Math.PI * 2);
  return normalizedAngle < 0 ? normalizedAngle + Math.PI * 2 : normalizedAngle;
};

const wrapAngleDeltaRadians = (angle: number): number => {
  const normalizedAngle = normalizeAngleRadians(angle);
  return normalizedAngle > Math.PI ? normalizedAngle - Math.PI * 2 : normalizedAngle;
};

const resolveProjectionAxes = (
  vectors: readonly THREE.Vector3[]
): [VectorAxis, VectorAxis, VectorAxis] => {
  const spans = {
    x:
      Math.max(...vectors.map((vector) => vector.x)) -
      Math.min(...vectors.map((vector) => vector.x)),
    y:
      Math.max(...vectors.map((vector) => vector.y)) -
      Math.min(...vectors.map((vector) => vector.y)),
    z:
      Math.max(...vectors.map((vector) => vector.z)) -
      Math.min(...vectors.map((vector) => vector.z)),
  };
  const droppedAxis = [...(["x", "y", "z"] as const)].sort(
    (left, right) => spans[left] - spans[right]
  )[0];
  switch (droppedAxis) {
    case "x":
      return ["y", "z", "x"];
    case "y":
      return ["x", "z", "y"];
    case "z":
    default:
      return ["x", "y", "z"];
  }
};

const resolveBranchExpectedVector = ({
  chain,
  outlierVector,
  siblingVectors,
}: {
  chain: RepeatedInertiaSymmetryChain;
  outlierVector: THREE.Vector3;
  siblingVectors: readonly THREE.Vector3[];
}): THREE.Vector3 | null => {
  const branchVectors = [outlierVector, ...siblingVectors];
  if (branchVectors.length < 2) {
    return null;
  }

  const [firstAxis, secondAxis, droppedAxis] = resolveProjectionAxes(branchVectors);
  const siblingPlanarRadii = siblingVectors
    .map((vector) => Math.hypot(vector[firstAxis], vector[secondAxis]))
    .filter((radius) => radius > 0);
  const expectedPlanarRadius =
    siblingPlanarRadii.length > 0
      ? resolveMedian(siblingPlanarRadii)
      : Math.hypot(outlierVector[firstAxis], outlierVector[secondAxis]);
  const expectedDroppedCoordinate =
    siblingVectors.length > 0
      ? resolveMedian(siblingVectors.map((vector) => vector[droppedAxis]))
      : outlierVector[droppedAxis];

  if (chain.symmetryType === "mirror") {
    const siblingVector = siblingVectors[0] ?? null;
    if (!siblingVector) {
      return null;
    }
    const siblingAngleRadians = Math.atan2(
      siblingVector[secondAxis],
      siblingVector[firstAxis]
    );
    const expectedAngleRadians = normalizeAngleRadians(siblingAngleRadians + Math.PI);
    const expectedVector = new THREE.Vector3();
    expectedVector[firstAxis] = Math.cos(expectedAngleRadians) * expectedPlanarRadius;
    expectedVector[secondAxis] = Math.sin(expectedAngleRadians) * expectedPlanarRadius;
    expectedVector[droppedAxis] = expectedDroppedCoordinate;
    return expectedVector;
  }

  if (chain.symmetryType !== "radial") {
    return null;
  }
  const expectedVector = new THREE.Vector3();
  expectedVector[firstAxis] = outlierVector[firstAxis];
  expectedVector[secondAxis] = outlierVector[secondAxis];
  expectedVector[droppedAxis] = expectedDroppedCoordinate;
  return expectedVector;
};

const updateLineGeometry = ({
  geometry,
  points,
}: {
  geometry: THREE.BufferGeometry;
  points: readonly THREE.Vector3[];
}) => {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const positionValues = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const offset = index * 3;
    positionValues[offset] = point.x;
    positionValues[offset + 1] = point.y;
    positionValues[offset + 2] = point.z;
  });
  if (!attribute || attribute.array.length !== positionValues.length) {
    geometry.setAttribute("position", new THREE.BufferAttribute(positionValues, 3));
  } else {
    attribute.copyArray(positionValues);
    attribute.needsUpdate = true;
  }
  geometry.setDrawRange(0, points.length);
  geometry.computeBoundingSphere();
};

const hideLine = (lineObject: THREE.Line | THREE.LineSegments, geometry: THREE.BufferGeometry) => {
  lineObject.visible = false;
  geometry.setDrawRange(0, 0);
};

const sortGuidePointsAlongDominantDirection = (
  points: readonly THREE.Vector3[]
): THREE.Vector3[] => {
  if (points.length <= 2) {
    return [...points];
  }
  let dominantDirection = points[1]?.clone().sub(points[0] ?? new THREE.Vector3()) ?? new THREE.Vector3();
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const candidateDirection = points[rightIndex]!.clone().sub(points[leftIndex]!);
      if (candidateDirection.lengthSq() > dominantDirection.lengthSq()) {
        dominantDirection = candidateDirection;
      }
    }
  }
  if (dominantDirection.lengthSq() <= Number.EPSILON) {
    return [...points];
  }
  dominantDirection.normalize();
  return [...points].sort(
    (left, right) => left.dot(dominantDirection) - right.dot(dominantDirection)
  );
};

export const SimulationPrepSymmetryOverlay = ({
  centerMode,
  robot,
  chain,
}: {
  centerMode: RepeatedInertiaSymmetryCenterMode;
  robot: URDFRobot | null;
  chain: RepeatedInertiaSymmetryChain | null;
}) => {
  const resolveLinkObject = useMemo(() => createLinkObjectResolver(robot), [robot]);
  const radialSlotGuideGeometry = useMemo(() => new THREE.BufferGeometry(), []);
  const misalignmentLineGeometry = useMemo(() => new THREE.BufferGeometry(), []);
  const radialSlotGuideMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_GUIDE_COLOR,
        opacity: SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_GUIDE_OPACITY,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  );
  const misalignmentLineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: SIMULATION_PREP_SYMMETRY_OVERLAY_MISALIGNMENT_COLOR,
        opacity: SIMULATION_PREP_SYMMETRY_OVERLAY_MISALIGNMENT_OPACITY,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  );
  const radialSlotGuideObject = useMemo(() => {
    const line = new THREE.LineSegments(radialSlotGuideGeometry, radialSlotGuideMaterial);
    line.visible = false;
    line.renderOrder = SIMULATION_PREP_SYMMETRY_OVERLAY_RENDER_ORDER;
    line.raycast = () => null;
    return line;
  }, [radialSlotGuideGeometry, radialSlotGuideMaterial]);
  const misalignmentLineObject = useMemo(() => {
    const line = new THREE.Line(misalignmentLineGeometry, misalignmentLineMaterial);
    line.visible = false;
    line.renderOrder = SIMULATION_PREP_SYMMETRY_OVERLAY_RENDER_ORDER;
    line.raycast = () => null;
    return line;
  }, [misalignmentLineGeometry, misalignmentLineMaterial]);
  const outlierMarkersRef = useRef<THREE.InstancedMesh>(null);
  const rootWorldPositionRef = useRef(new THREE.Vector3());
  const outlierWorldPositionRef = useRef(new THREE.Vector3());
  const branchWorldPositionRef = useRef(new THREE.Vector3());
  const symmetryCenterWorldRef = useRef(new THREE.Vector3());
  const liftedOutlierWorldRef = useRef(new THREE.Vector3());
  const markerMatrixRef = useRef(new THREE.Matrix4());
  const markerQuaternionRef = useRef(new THREE.Quaternion());
  const markerScaleRef = useRef(new THREE.Vector3(1, 1, 1));

  useEffect(
    () => () => {
      radialSlotGuideGeometry.dispose();
      misalignmentLineGeometry.dispose();
      radialSlotGuideMaterial.dispose();
      misalignmentLineMaterial.dispose();
    },
    [
      radialSlotGuideGeometry,
      radialSlotGuideMaterial,
      misalignmentLineGeometry,
      misalignmentLineMaterial,
    ]
  );

  useFrame(() => {
    const outlierMarkers = outlierMarkersRef.current;
    if (!outlierMarkers || !robot || !chain) {
      hideLine(radialSlotGuideObject, radialSlotGuideGeometry);
      hideLine(misalignmentLineObject, misalignmentLineGeometry);
      outlierMarkers.visible = false;
      outlierMarkers.count = 0;
      return;
    }

    robot.updateMatrixWorld(true);

    const rootObject = resolveLinkObject(chain.symmetryRootLinkName);
    const outlierObject = resolveLinkObject(chain.outlierBranchRootLinkName);
    if (!rootObject || !outlierObject) {
      hideLine(radialSlotGuideObject, radialSlotGuideGeometry);
      hideLine(misalignmentLineObject, misalignmentLineGeometry);
      outlierMarkers.visible = false;
      outlierMarkers.count = 0;
      return;
    }

    rootObject.getWorldPosition(rootWorldPositionRef.current);
    symmetryCenterWorldRef.current.fromArray(
      centerMode === "root-mesh-center"
        ? chain.rootMeshCenterPositionMeters
        : chain.symmetryCenterPositionMeters
    );
    outlierObject.getWorldPosition(outlierWorldPositionRef.current);
    liftedOutlierWorldRef.current
      .copy(outlierWorldPositionRef.current)
      .addScaledVector(WORLD_UP, SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS);

    const outlierVector = outlierWorldPositionRef.current
      .clone()
      .sub(symmetryCenterWorldRef.current);
    const siblingVectors = chain.siblingBranchRootLinkNames
      .map((linkName) => {
        const branchObject = resolveLinkObject(linkName);
        if (!branchObject) {
          return null;
        }
        branchObject.getWorldPosition(branchWorldPositionRef.current);
        return branchWorldPositionRef.current.clone().sub(symmetryCenterWorldRef.current);
      })
      .filter((vector): vector is THREE.Vector3 => vector !== null);
    const robotCenterWorld = new THREE.Vector3().fromArray(chain.symmetryCenterPositionMeters);
    const guidePoints =
      chain.symmetryType === "radial"
        ? chain.branchRows
            .map((row) =>
              buildCenteredIdealPoint({
                idealRadiusMeters: row.idealRadialDistanceMeters,
                idealPointMeters: row.idealPositionMeters,
                originCenterMeters: robotCenterWorld,
                targetCenterMeters: symmetryCenterWorldRef.current,
              })
            )
            .filter((point) => point.lengthSq() > 0)
        : chain.symmetryType === "linear"
          ? sortGuidePointsAlongDominantDirection(
              chain.branchRows.map((row) =>
                buildTranslatedIdealPoint({
                  idealPointMeters: row.idealPositionMeters,
                  originCenterMeters: robotCenterWorld,
                  targetCenterMeters: symmetryCenterWorldRef.current,
                })
              )
            )
          : [];
    if (guidePoints.length > 0) {
      const liftedCenter = symmetryCenterWorldRef.current
        .clone()
        .addScaledVector(WORLD_UP, SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS);
      updateLineGeometry({
        geometry: radialSlotGuideGeometry,
        points:
          chain.symmetryType === "radial"
            ? guidePoints.flatMap((slotPoint) => [
                liftedCenter.clone(),
                slotPoint
                  .clone()
                  .addScaledVector(WORLD_UP, SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS),
              ])
            : guidePoints.slice(0, -1).flatMap((slotPoint, index) => [
                slotPoint.clone().addScaledVector(
                  WORLD_UP,
                  SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS
                ),
                guidePoints[index + 1]!.clone().addScaledVector(
                  WORLD_UP,
                  SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS
                ),
              ]),
      });
      radialSlotGuideObject.visible = true;
    } else {
      hideLine(radialSlotGuideObject, radialSlotGuideGeometry);
    }

    const outlierRow =
      chain.branchRows.find((row) => row.branchRootLinkName === chain.outlierBranchRootLinkName) ??
      null;
    const expectedWorldPoint =
      chain.symmetryType === "radial" && outlierRow
        ? buildCenteredIdealPoint({
            idealRadiusMeters: outlierRow.idealRadialDistanceMeters,
            idealPointMeters: outlierRow.idealPositionMeters,
            originCenterMeters: robotCenterWorld,
            targetCenterMeters: symmetryCenterWorldRef.current,
          })
        : chain.symmetryType === "linear" && outlierRow
          ? buildTranslatedIdealPoint({
              idealPointMeters: outlierRow.idealPositionMeters,
              originCenterMeters: robotCenterWorld,
              targetCenterMeters: symmetryCenterWorldRef.current,
            })
        : null;
    const expectedBranchVector =
      expectedWorldPoint?.clone().sub(symmetryCenterWorldRef.current) ??
      resolveBranchExpectedVector({
        chain,
        outlierVector,
        siblingVectors,
      });
    if (!expectedBranchVector) {
      hideLine(misalignmentLineObject, misalignmentLineGeometry);
    } else {
      const liftedExpectedWorld = (expectedWorldPoint ??
        symmetryCenterWorldRef.current.clone().add(expectedBranchVector)).addScaledVector(
        WORLD_UP,
        SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS
      );
      if (
        liftedOutlierWorldRef.current.distanceTo(liftedExpectedWorld) >
        SIMULATION_PREP_SYMMETRY_OVERLAY_MIN_SEGMENT_LENGTH_METERS
      ) {
        updateLineGeometry({
          geometry: misalignmentLineGeometry,
          points: [liftedOutlierWorldRef.current, liftedExpectedWorld],
        });
        misalignmentLineObject.visible = true;
      } else {
        hideLine(misalignmentLineObject, misalignmentLineGeometry);
      }
    }

    let outlierMarkerCount = 0;
    chain.branchLinkGroups.forEach((branchLinkGroup) => {
      branchLinkGroup.linkNames.forEach((linkName, index) => {
        const linkObject = resolveLinkObject(linkName);
        if (!linkObject) {
          return;
        }
        linkObject.getWorldPosition(branchWorldPositionRef.current);
        branchWorldPositionRef.current.addScaledVector(
          WORLD_UP,
          SIMULATION_PREP_SYMMETRY_OVERLAY_LIFT_METERS
        );
        markerScaleRef.current.setScalar(
          branchLinkGroup.status === "outlier" && index === 0
            ? SIMULATION_PREP_SYMMETRY_OVERLAY_DIVERGENCE_MARKER_SCALE
            : 1
        );
        markerMatrixRef.current.compose(
          branchWorldPositionRef.current,
          markerQuaternionRef.current,
          markerScaleRef.current
        );
        if (branchLinkGroup.status === "outlier") {
          outlierMarkers.setMatrixAt(outlierMarkerCount, markerMatrixRef.current);
          outlierMarkerCount += 1;
        }
      });
    });
    outlierMarkers.count = outlierMarkerCount;
    outlierMarkers.instanceMatrix.needsUpdate = true;
    outlierMarkers.visible = outlierMarkerCount > 0;
  });

  const outlierMarkerCapacity = Math.max(
    chain?.branchLinkGroups.find((branchLinkGroup) => branchLinkGroup.status === "outlier")
      ?.linkNames.length ?? 1,
    1
  );

  return (
    <>
      <primitive object={radialSlotGuideObject} />
      <primitive object={misalignmentLineObject} />
      <instancedMesh
        ref={outlierMarkersRef}
        args={[undefined, undefined, outlierMarkerCapacity]}
        visible={false}
        renderOrder={SIMULATION_PREP_SYMMETRY_OVERLAY_RENDER_ORDER}
        raycast={() => null}
      >
        <sphereGeometry
          args={[
            SIMULATION_PREP_SYMMETRY_OVERLAY_AFFECTED_MARKER_RADIUS_METERS,
            SIMULATION_PREP_SYMMETRY_OVERLAY_SPHERE_SEGMENTS,
            SIMULATION_PREP_SYMMETRY_OVERLAY_SPHERE_SEGMENTS,
          ]}
        />
        <meshBasicMaterial
          color={SIMULATION_PREP_SYMMETRY_OVERLAY_AFFECTED_MARKER_COLOR}
          opacity={SIMULATION_PREP_SYMMETRY_OVERLAY_MARKER_OPACITY}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  );
};
