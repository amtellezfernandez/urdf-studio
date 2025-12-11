import { useRef, useEffect, useState, useCallback } from "react";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";

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
  const transformRef = useRef<any>(null);
  const targetRef = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const lastIkCallRef = useRef<number>(0);
  const ikThrottleMs = 30; // Call IK max every 30ms for very smooth response
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingTargetRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);

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

  // Update target position to match end effector
  useEffect(() => {
    if (!endEffectorObject.current || !targetRef.current || isDragging) return;

    const link = endEffectorObject.current;
    link.updateMatrixWorld(true);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    link.matrixWorld.decompose(pos, quat, scale);

    targetRef.current.position.copy(pos);
    targetRef.current.quaternion.copy(quat);
  }, [currentJointValues, isDragging]);

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
        const response = await fetch(`${API_BASE_URL}/pyroki/ik`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urdf: urdfContent,
            joint_values: currentJointValues,
            target_link: endEffectorLink,
            target_position: [position.x, position.y, position.z],
            target_wxyz: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.error("IK request failed:", response.statusText);
          return;
        }

        const data = await response.json();

        // Check if solution is valid
        if (data.diagnostics?.validity === "valid" && data.solution) {
          onIkSolved(data.solution);
        } else {
          console.warn("IK solution invalid:", data.diagnostics);
        }
      } catch (error: any) {
        if (error.name !== "AbortError") {
          console.error("IK solve error:", error);
        }
      }
    },
    [urdfContent, currentJointValues, endEffectorLink, onIkSolved]
  );

  // Use frame loop to throttle IK calls during dragging
  useFrame(() => {
    if (!isDragging || !pendingTargetRef.current) return;

    const now = Date.now();
    if (now - lastIkCallRef.current >= ikThrottleMs) {
      lastIkCallRef.current = now;
      const { position, quaternion } = pendingTargetRef.current;
      solveIk(position.clone(), quaternion.clone());
      pendingTargetRef.current = null;
    }
  });

  // Handle drag events
  useEffect(() => {
    if (!transformRef.current) return;

    const controls = transformRef.current;

    const onDraggingChanged = (event: any) => {
      setIsDragging(event.value);
      onDragStateChange?.(event.value);
    };

    const onChange = () => {
      if (targetRef.current) {
        // Queue the target for IK solving (will be throttled by useFrame)
        pendingTargetRef.current = {
          position: targetRef.current.position.clone(),
          quaternion: targetRef.current.quaternion.clone(),
        };
      }
    };

    controls.addEventListener("dragging-changed", onDraggingChanged);
    controls.addEventListener("change", onChange);

    return () => {
      controls.removeEventListener("dragging-changed", onDraggingChanged);
      controls.removeEventListener("change", onChange);
    };
  }, []);

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
      onDragStateChange?.(false);
    }
  }, [enabled, onDragStateChange]);

  if (!enabled || !endEffectorObject.current) {
    return null;
  }

  return (
    <group ref={targetRef}>
      <TransformControls
        ref={transformRef}
        camera={camera}
        gl={gl}
        mode={mode}
        size={0.8}
        showX
        showY
        showZ
      >
        {/* Visual indicator sphere at the end effector */}
        <mesh>
          <sphereGeometry args={[0.02]} />
          <meshBasicMaterial
            color={isDragging ? "#ff6b6b" : "#4dabf7"}
            transparent
            opacity={0.7}
            depthTest={false}
          />
        </mesh>
      </TransformControls>
    </group>
  );
};
