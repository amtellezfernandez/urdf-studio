import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";

interface AxisGizmo3DProps {
  onViewChange?: (direction: 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right') => void;
}

/**
 * Blender-style 3D axis gizmo showing X (coral), Y (mint), Z (sky blue) axes
 * Positioned on the right side of the viewport (to the right of the lateral bar)
 * Shows the exact same orientation as axesHelper (world axes)
 * Clicking on the balls changes the camera view
 */
export const AxisGizmo3D = ({ onViewChange }: AxisGizmo3DProps = {}) => {
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
    
    // Calculate gizmo position: top-right corner of viewport (where Selected Joint popup was)
    // Position it at a fixed distance from camera, offset to top-right
    const viewDistance = 1.2; // Distance from camera (in world units)
    const screenOffsetX = 0.65; // Right offset (positive = right)
    const screenOffsetY = 0.4; // Top offset (positive = up)
    
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
    const targetScreenSize = 140; // Target size in pixels (bigger)
    const fov = camera.fov * (Math.PI / 180);
    const screenHeight = 2 * Math.tan(fov / 2) * distanceToCamera;
    const scaleFactor = (targetScreenSize / 600) * (screenHeight / 2); // 600px reference
    
    // Apply scale with reasonable min/max bounds (bigger)
    const scale = Math.max(0.16, Math.min(0.40, scaleFactor));
    groupRef.current.scale.setScalar(scale);
  });

  // Axis colors matching specified RGB values
  const colors = {
    x: "#BE2C41", // X axis - red/pink (190, 44, 65)
    y: "#6DA424", // Y axis - green (109, 164, 36)
    z: "#3464AD", // Z axis - blue (52, 100, 173)
  };
  
  // Size parameters (bigger)
  const axisLength = 0.32;
  const axisRadius = 0.016;
  const arrowLength = 0.08;
  const arrowRadius = 0.024;
  const labelDistance = 0.40;
  const ballRadius = 0.11;

  // Memoize materials to prevent recreation on re-renders
  const materials = useMemo(() => {
    const xMaterial = new THREE.MeshBasicMaterial({ 
      color: colors.x, 
      depthTest: false, 
      depthWrite: false 
    });
    const yMaterial = new THREE.MeshBasicMaterial({ 
      color: colors.y, 
      depthTest: false, 
      depthWrite: false 
    });
    const zMaterial = new THREE.MeshBasicMaterial({ 
      color: colors.z, 
      depthTest: false, 
      depthWrite: false 
    });
    const xTransparentMaterial = new THREE.MeshBasicMaterial({ 
      color: colors.x, 
      transparent: true, 
      opacity: 0.3, 
      depthTest: false, 
      depthWrite: false 
    });
    const yTransparentMaterial = new THREE.MeshBasicMaterial({ 
      color: colors.y, 
      transparent: true, 
      opacity: 0.3, 
      depthTest: false, 
      depthWrite: false 
    });
    const zTransparentMaterial = new THREE.MeshBasicMaterial({ 
      color: colors.z, 
      transparent: true, 
      opacity: 0.3, 
      depthTest: false, 
      depthWrite: false 
    });
    
    return {
      x: xMaterial,
      y: yMaterial,
      z: zMaterial,
      xTransparent: xTransparentMaterial,
      yTransparent: yTransparentMaterial,
      zTransparent: zTransparentMaterial,
    };
  }, []);

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
      {/* X-axis (Red) - FORWARD direction per ROS REP-103 */}
      <group>
        <mesh position={[axisLength / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} material={materials.x}>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 16]} />
        </mesh>
        <mesh position={[axisLength, 0, 0]} rotation={[0, 0, -Math.PI / 2]} material={materials.x}>
          <coneGeometry args={[arrowRadius, arrowLength, 16]} />
        </mesh>
        {/* Solid ball at positive end - X positive = FRONT view (looking from behind) */}
        <mesh
          position={[labelDistance, 0, 0]}
          renderOrder={999}
          material={materials.x}
          onPointerDown={(e) => {
            e.stopPropagation();
            onViewChange?.('front');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }}
        >
          <sphereGeometry args={[ballRadius, 16, 16]} />
        </mesh>
        {/* Transparent ball at negative end - X negative = BACK view (looking from front) */}
        <mesh
          position={[-axisLength, 0, 0]}
          material={materials.xTransparent}
          onPointerDown={(e) => {
            e.stopPropagation();
            onViewChange?.('back');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }}
        >
          <sphereGeometry args={[ballRadius, 16, 16]} />
        </mesh>
        <group renderOrder={10000}>
          <Text
            position={[labelDistance, 0, 0]}
            fontSize={0.13}
            color="#FFFFFF"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.008}
            outlineColor="#000000"
            billboard
          >
            X
          </Text>
        </group>
      </group>

      {/* Y-axis (Green) - LEFT direction per ROS REP-103 */}
      <group>
        <mesh position={[0, axisLength / 2, 0]} material={materials.y}>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 16]} />
        </mesh>
        <mesh position={[0, axisLength + arrowLength / 2, 0]} material={materials.y}>
          <coneGeometry args={[arrowRadius, arrowLength, 16]} />
        </mesh>
        {/* Solid ball at positive end - Y positive = LEFT view (looking from robot's right) */}
        <mesh
          position={[0, labelDistance, 0]}
          renderOrder={999}
          material={materials.y}
          onPointerDown={(e) => {
            e.stopPropagation();
            onViewChange?.('left');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }}
        >
          <sphereGeometry args={[ballRadius, 16, 16]} />
        </mesh>
        {/* Transparent ball at negative end - Y negative = RIGHT view (looking from robot's left) */}
        <mesh
          position={[0, -axisLength, 0]}
          material={materials.yTransparent}
          onPointerDown={(e) => {
            e.stopPropagation();
            onViewChange?.('right');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }}
        >
          <sphereGeometry args={[ballRadius, 16, 16]} />
        </mesh>
        <group renderOrder={10000}>
          <Text
            position={[0, labelDistance, 0]}
            fontSize={0.13}
            color="#FFFFFF"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.008}
            outlineColor="#000000"
            billboard
          >
            Y
          </Text>
        </group>
      </group>

      {/* Z-axis (Blue) - UP direction per ROS REP-103 */}
      <group>
        <mesh position={[0, 0, axisLength / 2]} rotation={[Math.PI / 2, 0, 0]} material={materials.z}>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 16]} />
        </mesh>
        <mesh position={[0, 0, axisLength + arrowLength / 2]} rotation={[Math.PI / 2, 0, 0]} material={materials.z}>
          <coneGeometry args={[arrowRadius, arrowLength, 16]} />
        </mesh>
        {/* Solid ball at positive end (with text inside) - Z positive = top view */}
        <mesh 
          position={[0, 0, labelDistance]} 
          renderOrder={999}
          material={materials.z}
          onPointerDown={(e) => {
            e.stopPropagation();
            onViewChange?.('top');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }}
        >
          <sphereGeometry args={[ballRadius, 16, 16]} />
        </mesh>
        {/* Transparent ball at negative end - Z negative = bottom view */}
        <mesh 
          position={[0, 0, -axisLength]}
          material={materials.zTransparent}
          onPointerDown={(e) => {
            e.stopPropagation();
            onViewChange?.('bottom');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'default';
          }}
        >
          <sphereGeometry args={[ballRadius, 16, 16]} />
        </mesh>
        <group renderOrder={10000}>
          <Text
            position={[0, 0, labelDistance]}
            fontSize={0.13}
            color="#FFFFFF"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.008}
            outlineColor="#000000"
            billboard
          >
            Z
          </Text>
        </group>
      </group>
    </group>
  );
};

