import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { OPERATOR_POINT_CLOUD_DEFAULT_POINT_SIZE_M } from "@/features/teleop/params/operatorTeleopParams";
import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import { applyOperatorPointCloudGeometryFrame } from "@/features/teleop/perception/operatorPointCloud";
import {
  applyOperatorPointCloudFloorCalibrationToTransform,
  type OperatorPointCloudFloorCalibration,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

type OperatorPointCloudOverlayProps = {
  frame: OperatorPointCloudFrame | null;
  floorCalibration?: OperatorPointCloudFloorCalibration | null;
  visible: boolean;
};

export const OperatorPointCloudOverlay = ({
  frame,
  floorCalibration,
  visible,
}: OperatorPointCloudOverlayProps) => {
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: OPERATOR_POINT_CLOUD_DEFAULT_POINT_SIZE_M,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    if (!frame) {
      geometry.setDrawRange(0, 0);
      return;
    }
    applyOperatorPointCloudGeometryFrame(geometry, frame);
  }, [frame, geometry]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (!visible || !frame) return null;

  const basePoseTransform = frame.cameraPose
    ? buildOperatorPointCloudPoseTransform(frame.cameraPose)
    : null;
  const poseTransform = basePoseTransform
    ? applyOperatorPointCloudFloorCalibrationToTransform(
        basePoseTransform,
        floorCalibration ?? null,
      )
    : null;

  if (!poseTransform) {
    return (
      <points geometry={geometry} material={material} frustumCulled={false} />
    );
  }

  return (
    <group
      position={poseTransform.position}
      quaternion={poseTransform.quaternion}
    >
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        scale={poseTransform.pointScale}
      />
    </group>
  );
};
