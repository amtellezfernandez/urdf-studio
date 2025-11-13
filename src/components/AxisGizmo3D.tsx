import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";

/**
 * Blender-style 3D axis gizmo showing X (coral), Y (mint), Z (sky blue) axes
 * Positioned in the bottom-left corner of the viewport
 * Shows the exact same orientation as axesHelper (world axes)
 */
export const AxisGizmo3D = () => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  
  // Position gizmo relative to camera in a fixed position
  // This ensures it always stays visible and doesn't disappear when camera moves
  useFrame(() => {
    if (!groupRef.current) return;
    
    // Get camera's local coordinate system from world matrix
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Extract right (X) and up (Y) vectors from camera's world matrix
    const cameraRight = new THREE.Vector3();
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const cameraUp = new THREE.Vector3();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    
    // Calculate gizmo position: bottom-left corner of viewport
    // Position it at a fixed distance from camera, offset to bottom-left
    const viewDistance = 1.2; // Distance from camera (in world units)
    const screenOffsetX = -0.65; // Left offset (negative = left)
    const screenOffsetY = -0.4; // Down offset (negative = down)
    
    // Calculate position: start from camera, move forward, then offset
    const gizmoPosition = camera.position.clone()
      .add(cameraDirection.clone().multiplyScalar(viewDistance))
      .add(cameraRight.clone().multiplyScalar(screenOffsetX))
      .add(cameraUp.clone().multiplyScalar(screenOffsetY));
    
    groupRef.current.position.copy(gizmoPosition);
    
    // CRITICAL: No rotation - gizmo shows world axes exactly like axesHelper
    groupRef.current.rotation.set(0, 0, 0);
    
    // Scale based on distance to camera to maintain consistent screen size
    const distanceToCamera = camera.position.distanceTo(gizmoPosition);
    const targetScreenSize = 150; // Target size in pixels
    const fov = camera.fov * (Math.PI / 180);
    const screenHeight = 2 * Math.tan(fov / 2) * distanceToCamera;
    const scaleFactor = (targetScreenSize / 600) * (screenHeight / 2); // 600px reference
    
    // Apply scale with reasonable min/max bounds
    const scale = Math.max(0.18, Math.min(0.45, scaleFactor));
    groupRef.current.scale.setScalar(scale);
  });

  // Sweet, softer colors - more pleasant than bright primary colors
  const colors = {
    x: "#FF0000", // X axis - red
    y: "#00FF00", // Y axis - green
    z: "#0000FF", // Z axis - blue
  };
  
  // Size parameters
  const axisLength = 0.34;
  const axisRadius = 0.015;
  const arrowLength = 0.09;
  const arrowRadius = 0.024;
  const labelDistance = 0.42;

  // VERIFICATION: World axes alignment - MUST match axesHelper exactly
  // ===================================================================
  // Scene setup: scene.up.set(0, 0, 1) - Z is UP
  // axesHelper shows world axes at origin:
  //   - X axis = RED, points in +X direction (horizontal, right)
  //   - Y axis = GREEN, points in +Y direction (horizontal, forward)
  //   - Z axis = BLUE, points in +Z direction (vertical, up)
  // Grid: rotation={[Math.PI/2, 0, 0]} - lies in XY plane (horizontal floor)
  // 
  // CylinderGeometry is created along Y-axis by default (vertical in default Three.js)
  // But with scene.up = Z, Y is horizontal
  // 
  // For X axis (red, horizontal, +X direction):
  //   - Cylinder along Y needs to rotate to point along X
  //   - Rotate -90° around Z: cylinder along Y -> points in +X direction
  //   - Arrow head at end should point in +X (same rotation)
  //
  // For Y axis (green, horizontal, +Y direction):
  //   - Cylinder is already along Y, no rotation needed
  //   - Arrow head at end should point in +Y
  //
  // For Z axis (blue, vertical, +Z direction):
  //   - Rotate 90° around X: cylinder along Y -> points in +Z direction
  //   - Arrow head at end should point in +Z (same rotation)

  return (
    <group ref={groupRef} renderOrder={1000}>
      {/* X-axis (Coral) - Horizontal, pointing in +X direction (right) */}
      <group>
        <mesh position={[axisLength / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 16]} />
          <meshBasicMaterial color={colors.x} />
        </mesh>
        <mesh position={[axisLength, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[arrowRadius, arrowLength, 16]} />
          <meshBasicMaterial color={colors.x} />
        </mesh>
        <Text
          position={[labelDistance, 0, 0]}
          fontSize={0.14}
          color={colors.x}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.005}
          outlineColor="#000000"
          billboard
        >
          X
        </Text>
      </group>

      {/* Y-axis (Mint) - Horizontal, pointing in +Y direction (forward) */}
      <group>
        <mesh position={[0, axisLength / 2, 0]}>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 16]} />
          <meshBasicMaterial color={colors.y} />
        </mesh>
        <mesh position={[0, axisLength + arrowLength / 2, 0]}>
          <coneGeometry args={[arrowRadius, arrowLength, 16]} />
          <meshBasicMaterial color={colors.y} />
        </mesh>
        <Text
          position={[0, labelDistance, 0]}
          fontSize={0.14}
          color={colors.y}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.005}
          outlineColor="#000000"
          billboard
        >
          Y
        </Text>
      </group>

      {/* Z-axis (Sky Blue) - Vertical, pointing in +Z direction (up) */}
      <group>
        <mesh position={[0, 0, axisLength / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 16]} />
          <meshBasicMaterial color={colors.z} />
        </mesh>
        <mesh position={[0, 0, axisLength + arrowLength / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[arrowRadius, arrowLength, 16]} />
          <meshBasicMaterial color={colors.z} />
        </mesh>
        <Text
          position={[0, 0, labelDistance]}
          fontSize={0.14}
          color={colors.z}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.005}
          outlineColor="#000000"
          billboard
        >
          Z
        </Text>
      </group>
    </group>
  );
};

