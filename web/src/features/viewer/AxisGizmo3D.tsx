import { useRef, useMemo } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Billboard, Text } from "@react-three/drei";
import { AXIS_GIZMO_3D_PARAMS } from "@/features/viewer/axisGizmo3DParams";

type AxisViewDirection = "front" | "back" | "top" | "bottom" | "left" | "right";
type AxisName = "x" | "y" | "z";
type VectorTuple = [number, number, number];
type AxisMaterialSet = {
  solid: Record<AxisName, THREE.MeshBasicMaterial>;
  transparent: Record<AxisName, THREE.MeshBasicMaterial>;
};

interface AxisGizmo3DProps {
  onViewChange?: (direction: AxisViewDirection) => void;
}

const {
  colors: AXIS_COLORS,
  geometry: AXIS_GEOMETRY,
  renderOrder: AXIS_RENDER_ORDER,
  screenScale: GIZMO_SCREEN_SCALE,
} = AXIS_GIZMO_3D_PARAMS;

type AxisConfig = {
  axis: AxisName;
  label: string;
  shaftPosition: VectorTuple;
  arrowPosition: VectorTuple;
  labelPosition: VectorTuple;
  positiveEndpointPosition: VectorTuple;
  negativeEndpointPosition: VectorTuple;
  positiveView: AxisViewDirection;
  negativeView: AxisViewDirection;
  rotation?: VectorTuple;
};

const AXIS_CONFIGS: AxisConfig[] = [
  {
    axis: "x",
    label: "X",
    shaftPosition: [AXIS_GEOMETRY.axisLength / 2, 0, 0],
    arrowPosition: [AXIS_GEOMETRY.axisLength, 0, 0],
    labelPosition: [AXIS_GEOMETRY.labelDistance, 0, 0],
    positiveEndpointPosition: [AXIS_GEOMETRY.labelDistance, 0, 0],
    negativeEndpointPosition: [-AXIS_GEOMETRY.axisLength, 0, 0],
    positiveView: "front",
    negativeView: "back",
    rotation: [0, 0, -Math.PI / 2],
  },
  {
    axis: "y",
    label: "Y",
    shaftPosition: [0, AXIS_GEOMETRY.axisLength / 2, 0],
    arrowPosition: [
      0,
      AXIS_GEOMETRY.axisLength + AXIS_GEOMETRY.arrowLength / 2,
      0,
    ],
    labelPosition: [0, AXIS_GEOMETRY.labelDistance, 0],
    positiveEndpointPosition: [0, AXIS_GEOMETRY.labelDistance, 0],
    negativeEndpointPosition: [0, -AXIS_GEOMETRY.axisLength, 0],
    positiveView: "left",
    negativeView: "right",
  },
  {
    axis: "z",
    label: "Z",
    shaftPosition: [0, 0, AXIS_GEOMETRY.axisLength / 2],
    arrowPosition: [
      0,
      0,
      AXIS_GEOMETRY.axisLength + AXIS_GEOMETRY.arrowLength / 2,
    ],
    labelPosition: [0, 0, AXIS_GEOMETRY.labelDistance],
    positiveEndpointPosition: [0, 0, AXIS_GEOMETRY.labelDistance],
    negativeEndpointPosition: [0, 0, -AXIS_GEOMETRY.axisLength],
    positiveView: "top",
    negativeView: "bottom",
    rotation: [Math.PI / 2, 0, 0],
  },
];

const createGizmoMaterial = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
  });

const createAxisMaterialSet = (): AxisMaterialSet => ({
  solid: {
    x: createGizmoMaterial(AXIS_COLORS.x),
    y: createGizmoMaterial(AXIS_COLORS.y),
    z: createGizmoMaterial(AXIS_COLORS.z),
  },
  transparent: {
    x: createGizmoMaterial(AXIS_COLORS.x, 0.3),
    y: createGizmoMaterial(AXIS_COLORS.y, 0.3),
    z: createGizmoMaterial(AXIS_COLORS.z, 0.3),
  },
});

const setBodyCursor = (cursor: "default" | "pointer") => {
  document.body.style.cursor = cursor;
};

const stopGizmoPointerEvent = (event: ThreeEvent<PointerEvent>) => {
  event.stopPropagation();
};

type AxisEndpointProps = {
  position: VectorTuple;
  material: THREE.Material;
  view: AxisViewDirection;
  onViewChange?: (direction: AxisViewDirection) => void;
  renderOrder?: number;
};

const AxisEndpoint = ({
  position,
  material,
  view,
  onViewChange,
  renderOrder,
}: AxisEndpointProps) => (
  <mesh
    position={position}
    renderOrder={renderOrder}
    material={material}
    onPointerDown={(event) => {
      stopGizmoPointerEvent(event);
      onViewChange?.(view);
    }}
    onPointerOver={(event) => {
      stopGizmoPointerEvent(event);
      setBodyCursor("pointer");
    }}
    onPointerOut={(event) => {
      stopGizmoPointerEvent(event);
      setBodyCursor("default");
    }}
  >
    <sphereGeometry
      args={[
        AXIS_GEOMETRY.ballRadius,
        AXIS_GEOMETRY.radialSegments,
        AXIS_GEOMETRY.radialSegments,
      ]}
    />
  </mesh>
);

const AxisLabel = ({
  position,
  children,
}: {
  position: VectorTuple;
  children: string;
}) => (
  <group renderOrder={AXIS_RENDER_ORDER.label}>
    <Billboard position={position}>
      <Text
        fontSize={0.13}
        color="#FFFFFF"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor="#000000"
      >
        {children}
      </Text>
    </Billboard>
  </group>
);

const AxisVisual = ({
  config,
  materials,
  onViewChange,
}: {
  config: AxisConfig;
  materials: AxisMaterialSet;
  onViewChange?: (direction: AxisViewDirection) => void;
}) => {
  const solidMaterial = materials.solid[config.axis];
  const transparentMaterial = materials.transparent[config.axis];

  return (
    <group>
      <mesh
        position={config.shaftPosition}
        rotation={config.rotation}
        material={solidMaterial}
      >
        <cylinderGeometry
          args={[
            AXIS_GEOMETRY.axisRadius,
            AXIS_GEOMETRY.axisRadius,
            AXIS_GEOMETRY.axisLength,
            AXIS_GEOMETRY.radialSegments,
          ]}
        />
      </mesh>
      <mesh
        position={config.arrowPosition}
        rotation={config.rotation}
        material={solidMaterial}
      >
        <coneGeometry
          args={[
            AXIS_GEOMETRY.arrowRadius,
            AXIS_GEOMETRY.arrowLength,
            AXIS_GEOMETRY.radialSegments,
          ]}
        />
      </mesh>
      <AxisEndpoint
        position={config.positiveEndpointPosition}
        renderOrder={AXIS_RENDER_ORDER.endpoint}
        material={solidMaterial}
        view={config.positiveView}
        onViewChange={onViewChange}
      />
      <AxisEndpoint
        position={config.negativeEndpointPosition}
        material={transparentMaterial}
        view={config.negativeView}
        onViewChange={onViewChange}
      />
      <AxisLabel position={config.labelPosition}>{config.label}</AxisLabel>
    </group>
  );
};

/**
 * Blender-style 3D axis gizmo showing X (coral), Y (mint), Z (sky blue) axes
 * Positioned on the right side of the viewport (to the right of the lateral bar)
 * Shows the exact same orientation as axesHelper (world axes)
 * Clicking on the balls changes the camera view
 */
export const AxisGizmo3D = ({ onViewChange }: AxisGizmo3DProps = {}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const tempVectors = useMemo(
    () => ({
      cameraDirection: new THREE.Vector3(),
      cameraRight: new THREE.Vector3(),
      cameraUp: new THREE.Vector3(),
      gizmoPosition: new THREE.Vector3(),
    }),
    [],
  );

  // Position gizmo relative to camera in a fixed position
  // This ensures it always stays visible and doesn't disappear when camera moves
  useFrame(() => {
    if (!groupRef.current) return;

    // Get camera's local coordinate system from world matrix
    const { cameraDirection, cameraRight, cameraUp, gizmoPosition } =
      tempVectors;
    camera.getWorldDirection(cameraDirection);

    // Extract right (X) and up (Y) vectors from camera's world matrix
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);

    // Calculate gizmo position: top-right corner of viewport (where Selected Joint popup was)
    // Position it at a fixed distance from camera, offset to top-right
    // Calculate position: start from camera, move forward, then offset
    gizmoPosition
      .copy(camera.position)
      .addScaledVector(cameraDirection, GIZMO_SCREEN_SCALE.viewDistance)
      .addScaledVector(cameraRight, GIZMO_SCREEN_SCALE.screenOffsetX)
      .addScaledVector(cameraUp, GIZMO_SCREEN_SCALE.screenOffsetY);

    groupRef.current.position.copy(gizmoPosition);

    // CRITICAL: No rotation - gizmo shows world axes exactly like axesHelper
    groupRef.current.rotation.set(0, 0, 0);

    // Scale based on distance to camera to maintain consistent screen size
    const distanceToCamera = camera.position.distanceTo(gizmoPosition);
    const screenHeight =
      camera instanceof THREE.PerspectiveCamera
        ? 2 * Math.tan((camera.fov * Math.PI) / 360) * distanceToCamera
        : camera instanceof THREE.OrthographicCamera
          ? Math.abs(camera.top - camera.bottom) / camera.zoom
          : 1;
    const scaleFactor =
      (GIZMO_SCREEN_SCALE.targetScreenSizePx /
        GIZMO_SCREEN_SCALE.referenceViewportHeightPx) *
      (screenHeight / 2);

    // Apply scale with reasonable min/max bounds (bigger)
    const scale = Math.max(
      GIZMO_SCREEN_SCALE.minScale,
      Math.min(GIZMO_SCREEN_SCALE.maxScale, scaleFactor),
    );
    groupRef.current.scale.setScalar(scale);
  });

  // Memoize materials to prevent recreation on re-renders
  const materials = useMemo(createAxisMaterialSet, []);

  // VERIFICATION: ROS REP-103 / URDF Standard Coordinate System
  // ============================================================
  // Scene setup: scene.up.set(0, 0, 1) - Z is UP
  // ROS REP-103 standard for robot coordinate frames:
  //   - X axis = RED, points FORWARD (robot's front direction)
  //   - Y axis = GREEN, points LEFT (robot's left side)
  //   - Z axis = BLUE, points UP (vertical, gravity opposite)
  //
  // This is a right-handed coordinate system where:
  //   - X × Y = Z (cross product verification)
  //   - Forward × Left = Up ✓
  //
  // CylinderGeometry is created along Y-axis by default
  //
  // For X axis (red, forward):
  //   - Rotate cylinder to point along +X
  //
  // For Y axis (green, left):
  //   - Rotate cylinder to point along +Y
  //
  // For Z axis (blue, up):
  //   - Rotate cylinder to point along +Z

  return (
    <group ref={groupRef} renderOrder={9999}>
      {AXIS_CONFIGS.map((config) => (
        <AxisVisual
          key={config.axis}
          config={config}
          materials={materials}
          onViewChange={onViewChange}
        />
      ))}
    </group>
  );
};
