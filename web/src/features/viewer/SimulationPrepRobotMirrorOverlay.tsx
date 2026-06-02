import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  SIMULATION_PREP_ROBOT_MIRROR_PLANE_COLOR,
  SIMULATION_PREP_ROBOT_MIRROR_PLANE_OPACITY,
  SIMULATION_PREP_ROBOT_MIRROR_PLANE_SIZE_PADDING,
  SIMULATION_PREP_SYMMETRY_OVERLAY_RENDER_ORDER,
} from "@/features/viewer/symmetryVisualizationParams";

const PLANE_BASE_NORMAL = new THREE.Vector3(0, 0, 1);

export const SimulationPrepRobotMirrorOverlay = ({
  check,
  robot,
}: {
  check: RobotMirrorSymmetryCheck | null;
  robot: URDFRobot | null;
}) => {
  const planeRef = useRef<THREE.Mesh>(null);
  const robotBoundsRef = useRef(new THREE.Box3());
  const robotSizeRef = useRef(new THREE.Vector3());
  const planeNormalRef = useRef(new THREE.Vector3());
  const planePositionRef = useRef(new THREE.Vector3());
  const planeScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const planeQuaternionRef = useRef(new THREE.Quaternion());
  const planeGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const planeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SIMULATION_PREP_ROBOT_MIRROR_PLANE_COLOR,
        opacity: SIMULATION_PREP_ROBOT_MIRROR_PLANE_OPACITY,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );

  useEffect(
    () => () => {
      planeGeometry.dispose();
      planeMaterial.dispose();
    },
    [planeGeometry, planeMaterial]
  );

  useFrame(() => {
    const plane = planeRef.current;
    if (!plane || !robot || !check) {
      if (plane) {
        plane.visible = false;
      }
      return;
    }

    robot.updateMatrixWorld(true);
    robotBoundsRef.current.setFromObject(robot);
    if (robotBoundsRef.current.isEmpty()) {
      plane.visible = false;
      return;
    }

    planeNormalRef.current.fromArray(check.planeNormalWorld).normalize();
    planeQuaternionRef.current.setFromUnitVectors(
      PLANE_BASE_NORMAL,
      planeNormalRef.current
    );
    planePositionRef.current.fromArray(check.originMeters);
    robotBoundsRef.current.getSize(robotSizeRef.current);
    const planeSizeMeters =
      Math.max(robotSizeRef.current.x, robotSizeRef.current.y, robotSizeRef.current.z) *
      SIMULATION_PREP_ROBOT_MIRROR_PLANE_SIZE_PADDING;

    plane.position.copy(planePositionRef.current);
    plane.quaternion.copy(planeQuaternionRef.current);
    planeScaleRef.current.setScalar(Math.max(planeSizeMeters, Number.EPSILON));
    plane.scale.copy(planeScaleRef.current);
    plane.visible = true;
  });

  return (
    <mesh
      ref={planeRef}
      geometry={planeGeometry}
      material={planeMaterial}
      visible={false}
      renderOrder={SIMULATION_PREP_SYMMETRY_OVERLAY_RENDER_ORDER}
      raycast={() => null}
    />
  );
};
