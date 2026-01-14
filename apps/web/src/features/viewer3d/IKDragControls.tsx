import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { useThree, useFrame, ThreeEvent } from "@react-three/fiber";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";

interface IKDragControlsProps {
  robot: URDFRobot | null; // URDFRobot
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
  const targetPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const targetQuaternionRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const targetScaleRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const activePointerIdRef = useRef<number | null>(null);
  const intersectionRef = useRef<THREE.Vector3>(new THREE.Vector3());

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

    link.matrixWorld.decompose(
      targetPositionRef.current,
      targetQuaternionRef.current,
      targetScaleRef.current
    );

    targetMeshRef.current.position.copy(targetPositionRef.current);
    targetMeshRef.current.quaternion.copy(targetQuaternionRef.current);
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

  const updateDragTarget = useCallback(
    (clientX: number, clientY: number, applyOffset: boolean = true) => {
      if (!targetMeshRef.current) return false;

      const rect = gl.domElement.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      if (!raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionRef.current)) {
        return false;
      }

      if (!applyOffset) {
        return true;
      }

      intersectionRef.current.add(dragOffsetRef.current);
      targetMeshRef.current.position.copy(intersectionRef.current);

      pendingTargetRef.current = {
        position: targetMeshRef.current.position.clone(),
        quaternion: targetMeshRef.current.quaternion.clone(),
      };
      return true;
    },
    [camera, gl, raycaster]
  );

  const endDrag = useCallback(
    (pointerId?: number) => {
      if (pointerId !== undefined && activePointerIdRef.current !== null) {
        if (pointerId !== activePointerIdRef.current) return;
      }

      if (pointerId !== undefined) {
        const domElement = gl.domElement as Element & {
          releasePointerCapture?: (id: number) => void;
        };
        if (domElement?.releasePointerCapture) {
          try {
            domElement.releasePointerCapture(pointerId);
          } catch {
            // Ignore release failures for browsers that reject stale captures.
          }
        }
      }

      activePointerIdRef.current = null;
      setIsDragging(false);
      onDragStateChange?.(false);
    },
    [gl, onDragStateChange]
  );

  // Pointer event handlers for direct dragging
  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled || !targetMeshRef.current) {
        return;
      }

      event.stopPropagation();
      activePointerIdRef.current = event.pointerId;
      const domElement = gl.domElement as Element & {
        setPointerCapture?: (id: number) => void;
      };
      if (domElement?.setPointerCapture) {
        try {
          domElement.setPointerCapture(event.pointerId);
        } catch {
          // Ignore capture failures; we'll still listen globally.
        }
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

      const hasIntersection = updateDragTarget(event.clientX, event.clientY, false);
      if (!hasIntersection) {
        return;
      }
      dragOffsetRef.current.subVectors(
        targetMeshRef.current.position,
        intersectionRef.current
      );
    },
    [enabled, camera, gl, onDragStateChange, updateDragTarget]
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging || !targetMeshRef.current) return;

      event.stopPropagation();
      updateDragTarget(event.clientX, event.clientY);
    },
    [isDragging, updateDragTarget]
  );

  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging) return;

      event.stopPropagation();
      endDrag(event.pointerId);
    },
    [isDragging, endDrag]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (
        activePointerIdRef.current !== null &&
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }
      updateDragTarget(event.clientX, event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      endDrag(event.pointerId);
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      endDrag(event.pointerId);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [isDragging, endDrag, updateDragTarget]);

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
      if (activePointerIdRef.current !== null) {
        endDrag(activePointerIdRef.current);
      } else {
        setIsDragging(false);
        onDragStateChange?.(false);
      }
      setIsHovered(false);
    }
  }, [enabled, endDrag, onDragStateChange]);

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
