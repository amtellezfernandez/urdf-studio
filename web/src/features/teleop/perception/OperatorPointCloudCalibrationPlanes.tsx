import * as THREE from "three";
import {
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_COLOR,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_OPACITY,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_POLYGON_OFFSET_FACTOR,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_POLYGON_OFFSET_UNITS,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_RENDER_ORDER,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudSurfacePlane } from "@/features/teleop/perception/operatorPointCloudFloorCalibration";

export type OperatorPointCloudCalibrationPlaneOverlay = OperatorPointCloudSurfacePlane & {
  cameraId: string;
};

type OperatorPointCloudCalibrationPlanesProps = {
  planes: readonly OperatorPointCloudCalibrationPlaneOverlay[];
  visible: boolean;
};

export const OperatorPointCloudCalibrationPlanes = ({
  planes,
  visible,
}: OperatorPointCloudCalibrationPlanesProps) => {
  if (!visible || planes.length === 0) return null;

  return (
    <group>
      {planes.map((plane) => (
        <mesh
          key={plane.cameraId}
          position={plane.center}
          quaternion={plane.quaternion}
          renderOrder={OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_RENDER_ORDER}
        >
          <planeGeometry args={plane.size} />
          <meshBasicMaterial
            color={OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_COLOR}
            depthWrite={false}
            opacity={OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_OPACITY}
            polygonOffset
            polygonOffsetFactor={
              OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_POLYGON_OFFSET_FACTOR
            }
            polygonOffsetUnits={
              OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_POLYGON_OFFSET_UNITS
            }
            side={THREE.DoubleSide}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
};
