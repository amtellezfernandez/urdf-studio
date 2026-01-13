import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { useThree, useFrame, ThreeEvent } from "@react-three/fiber";
import { toast } from "sonner";
import type { URDFRobotLike } from "@/features/types";

interface IKDragControlsProps {
  robot: URDFRobotLike | null; // URDFRobot
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
  const ikThrottleMs = 60; // Call IK at most once every 60ms to avoid spamming and keep responses smooth
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestJointValuesRef = useRef<Record<string, number>>(currentJointValues);
  const lastIkErrorRef = useRef<string | null>(null);
  const pendingTargetRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const queuedTargetRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const isSolvingRef = useRef(false);
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
  }, [enabled, endEffectorLink, robot, urdfContent, currentJointValues]);

  // Find the end effector link in the robot
  const endEffectorObject = useRef<THREE.Object3D | null>(null);

  // Keep the latest joint seed values available for IK solves while dragging
  useEffect(() => {
    latestJointValuesRef.current = currentJointValues;
  }, [currentJointValues]);

  useEffect(() => {
    if (!robot || !endEffectorLink) {
      endEffectorObject.current = null;
      return;
    }

    const robotAny = robot;
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
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const basePayload = {
          urdf: urdfContent,
          joint_values: latestJointValuesRef.current,
          target_link: endEffectorLink,
          target_position: [position.x, position.y, position.z],
        };

        // Convert quaternion to rotation matrix for the API
        const { w, x, y, z } = quaternion;
        const targetRotation = [
          [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ];
        const targetWxyz = [w, x, y, z];

        // Try strict orientation first, then fall back to position-only solve
        const payloads = [
          {
            ...basePayload,
            target_rotation: targetRotation,
            target_wxyz: targetWxyz,
            ignore_orientation: false,
          },
          {
            ...basePayload,
            target_rotation: null,
            target_wxyz: null,
            ignore_orientation: true,
          },
        ];

        let solved = false;
        let lastError: string | null = null;

        for (const payload of payloads) {
          const response = await fetch(`${API_BASE_URL}/pyroki/ik`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!response.ok) {
            try {
              const msg = await response.json();
              lastError = msg?.detail || msg?.error || response.statusText;
            } catch {
              lastError = response.statusText;
            }
            continue;
          }

          const data = await response.json();

          if (data?.solution) {
            onIkSolved(data.solution);
            solved = true;
            lastError = null;
            lastIkErrorRef.current = null;
            break;
          }

          lastError = "IK solve returned no solution";
        }

        if (!solved && lastError && lastIkErrorRef.current !== lastError) {
          lastIkErrorRef.current = lastError;
          console.warn("[IK] Drag handle solve failed:", lastError);
          toast.error(lastError);
        }
      } catch (error: unknown) {
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (!isAbort) {
          console.error("[IK] Solve error:", error);
          toast.error("IK solve failed. Is the IK server running?");
        }
      }
    },
    [urdfContent, endEffectorLink, onIkSolved]
  );

  // Pointer event handlers for direct dragging
  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled || !targetMeshRef.current) {
        return;
      }

      event.stopPropagation();
      const target = event.target;
      if (target instanceof Element && "setPointerCapture" in target) {
        (target as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(
          event.pointerId
        );
      }

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
      }
    },
    [isDragging, camera, gl, raycaster]
  );

  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging) return;

      event.stopPropagation();
      const target = event.target;
      if (target instanceof Element && "releasePointerCapture" in target) {
        (target as Element & { releasePointerCapture: (id: number) => void }).releasePointerCapture(
          event.pointerId
        );
      }

      setIsDragging(false);
      onDragStateChange?.(false);
    },
    [isDragging, onDragStateChange]
  );

  // Use frame loop to throttle IK calls during dragging
  useFrame(() => {
    if (!isDragging) return;

    // Always keep the most recent target; drop older ones to avoid backlog
    if (pendingTargetRef.current) {
      queuedTargetRef.current = pendingTargetRef.current;
      pendingTargetRef.current = null;
    }

    if (isSolvingRef.current || !queuedTargetRef.current) return;

    const now = performance.now();
    if (now - lastIkCallRef.current < ikThrottleMs) return;

    const { position, quaternion } = queuedTargetRef.current;
    queuedTargetRef.current = null;
    isSolvingRef.current = true;
    lastIkCallRef.current = now;

    solveIk(position.clone(), quaternion.clone())
      .catch(() => {
        /* errors handled inside solveIk */
      })
      .finally(() => {
        isSolvingRef.current = false;
      });
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
    return null;
  }

  return (
    <mesh
      ref={targetMeshRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      renderOrder={999}
    >
      <sphereGeometry args={[0.035]} />
      <meshBasicMaterial
        color={isDragging ? "#ff6b6b" : isHovered ? "#5bc0de" : "#4dabf7"}
        transparent
        opacity={isDragging ? 0.9 : isHovered ? 0.8 : 0.7}
        depthTest={false}
      />
    </mesh>
  );
};
