import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { useThree, useFrame, ThreeEvent } from "@react-three/fiber";

interface IKDragControlsProps {
  robot: any; // URDFRobot
  endEffectorLink: string;
  urdfContent: string;
  currentJointValues: Record<string, number>;
  onIkSolved: (solution: Record<string, number>) => void;
  enabled: boolean;
  mode?: "translate" | "rotate";
  onDragStateChange?: (dragging: boolean) => void;
}

const API_BASE_URL = "http://localhost:8000";

export const IKDragControls = ({
  robot,
  endEffectorLink,
  urdfContent,
  currentJointValues,
  onIkSolved,
  enabled,
  mode = "translate",
  onDragStateChange,
}: IKDragControlsProps) => {
  const targetMeshRef = useRef<THREE.Mesh>(null);
  const { camera, gl, raycaster, pointer } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const lastIkCallRef = useRef<number>(0);
  const ikThrottleMs = 30; // Call IK max every 30ms for very smooth response
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingTargetRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // Debug initial props
  useEffect(() => {
    console.log("[IK] Component mounted with props:", {
      enabled,
      endEffectorLink,
      hasRobot: !!robot,
      hasUrdf: !!urdfContent,
      jointCount: Object.keys(currentJointValues).length,
    });
  }, []);

  // Find the end effector link in the robot
  const endEffectorObject = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!robot || !endEffectorLink) {
      endEffectorObject.current = null;
      return;
    }

    const robotAny: any = robot;
    const safeDecode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    const link =
      robotAny?.links?.[endEffectorLink] ??
      robotAny?.getObjectByName?.(endEffectorLink) ??
      robotAny?.getObjectByName?.(safeDecode(endEffectorLink));

    endEffectorObject.current = link;
  }, [robot, endEffectorLink]);

  // Update target position to match end effector (runs on joint changes and initially)
  useFrame(() => {
    if (!endEffectorObject.current || !targetMeshRef.current || isDragging) return;

    const link = endEffectorObject.current;
    link.updateMatrixWorld(true);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    link.matrixWorld.decompose(pos, quat, scale);

    targetMeshRef.current.position.copy(pos);
    targetMeshRef.current.quaternion.copy(quat);
  });

  // Solve IK when target is moved - uses current joint values as seed for fast convergence
  const solveIk = useCallback(
    async (position: THREE.Vector3, quaternion: THREE.Quaternion) => {
      // Cancel previous IK call if still running
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const payload = {
          urdf: urdfContent,
          joint_values: currentJointValues,
          target_link: endEffectorLink,
          target_position: [position.x, position.y, position.z],
          target_wxyz: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
        };
        console.log("[IK] Sending request:", payload.target_position);

        const response = await fetch(`${API_BASE_URL}/pyroki/ik`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.error("[IK] Request failed:", response.statusText);
          return;
        }

        const data = await response.json();
        console.log("[IK] Response:", data);

        // Check if solution is valid
        if (data.diagnostics?.validity === "valid" && data.solution) {
          console.log("[IK] Solution valid, applying:", data.solution);
          onIkSolved(data.solution);
        } else {
          console.warn("[IK] Solution invalid:", data.diagnostics);
        }
      } catch (error: any) {
        if (error.name !== "AbortError") {
          console.error("[IK] Solve error:", error);
        }
      }
    },
    [urdfContent, currentJointValues, endEffectorLink, onIkSolved]
  );

  // Pointer event handlers for direct dragging
  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      console.log("[IK] PointerDown event fired");
      if (!enabled || !targetMeshRef.current) {
        console.log("[IK] PointerDown ignored - enabled:", enabled, "hasMesh:", !!targetMeshRef.current);
        return;
      }

      event.stopPropagation();
      (event.target as any).setPointerCapture(event.pointerId);

      console.log("[IK] Starting drag, disabling OrbitControls");
      setIsDragging(true);
      onDragStateChange?.(true);

      // Create a drag plane perpendicular to the camera view
      const cameraDirection = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(
        cameraDirection,
        targetMeshRef.current.position
      );

      // Update raycaster with current pointer position
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      // Calculate offset from plane intersection to sphere center
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersection);
      if (intersection) {
        dragOffsetRef.current.subVectors(targetMeshRef.current.position, intersection);
        console.log("[IK] Drag offset:", dragOffsetRef.current.toArray());
      }
    },
    [enabled, camera, gl, raycaster, onDragStateChange]
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging || !targetMeshRef.current) return;

      event.stopPropagation();

      // Update raycaster with current pointer position
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      // Find intersection with drag plane
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlaneRef.current, intersection)) {
        // Apply offset and update position
        intersection.add(dragOffsetRef.current);
        targetMeshRef.current.position.copy(intersection);

        // Queue for IK solving
        pendingTargetRef.current = {
          position: targetMeshRef.current.position.clone(),
          quaternion: targetMeshRef.current.quaternion.clone(),
        };
        console.log("[IK] Queued position:", targetMeshRef.current.position.toArray());
      }
    },
    [isDragging, camera, gl, raycaster]
  );

  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging) return;

      event.stopPropagation();
      (event.target as any).releasePointerCapture(event.pointerId);

      setIsDragging(false);
      onDragStateChange?.(false);
    },
    [isDragging, onDragStateChange]
  );

  // Use frame loop to throttle IK calls during dragging
  useFrame(() => {
    if (!isDragging || !pendingTargetRef.current) return;

    const now = Date.now();
    if (now - lastIkCallRef.current >= ikThrottleMs) {
      lastIkCallRef.current = now;
      const { position, quaternion } = pendingTargetRef.current;
      console.log("[IK] Solving for position:", position.toArray());
      solveIk(position.clone(), quaternion.clone());
      pendingTargetRef.current = null;
    }
  });

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // If controls become disabled, ensure dragging flag is cleared
  useEffect(() => {
    if (!enabled) {
      setIsDragging(false);
      setIsHovered(false);
      onDragStateChange?.(false);
    }
  }, [enabled, onDragStateChange]);

  if (!enabled || !endEffectorObject.current) {
    console.log("[IK] Component hidden - enabled:", enabled, "hasEndEffector:", !!endEffectorObject.current);
    return null;
  }

  console.log("[IK] Component rendering, isDragging:", isDragging);

  return (
    <mesh
      ref={targetMeshRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => {
        console.log("[IK] Pointer entered sphere");
        setIsHovered(true);
      }}
      onPointerLeave={() => {
        console.log("[IK] Pointer left sphere");
        setIsHovered(false);
      }}
      renderOrder={999}
    >
      <sphereGeometry args={[0.02]} />
      <meshBasicMaterial
        color={isDragging ? "#ff6b6b" : isHovered ? "#5bc0de" : "#4dabf7"}
        transparent
        opacity={isDragging ? 0.9 : isHovered ? 0.8 : 0.7}
        depthTest={false}
      />
    </mesh>
  );
};
