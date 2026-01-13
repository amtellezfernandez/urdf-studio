import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import { useObjectStore, type CreatedObject } from "@/features/object-creator";
import { useJointStore } from "@/store/useJointStore";
import { applyJointValues } from "@/lib/urdf-joints";
import type { WindowWithViewerHandlers } from "@/features/types";
import { getLiveRobotJoints, type DragMode } from "@/components/viewer3d/viewer3d-helpers";
import type { IkResponsePayload } from "@/components/viewer3d/ik-types";

type UseIkSolverParams = {
  apiBaseUrl: string;
  dragMode: DragMode;
  robot: URDFRobot | null;
  urdfContent: string | null;
  endEffectorLink: string | null;
  onIkApplied?: (values: Record<string, number>) => void;
};

export const useIkSolver = ({
  apiBaseUrl,
  dragMode,
  robot,
  urdfContent,
  endEffectorLink,
  onIkApplied,
}: UseIkSolverParams) => {
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const storeJointValues = useJointStore((s) => s.jointValues);
  const [ikResult, setIkResult] = useState<IkResponsePayload | null>(null);
  const [ikError, setIkError] = useState<string | null>(null);
  const [ikDialogOpen, setIkDialogOpen] = useState(false);
  const [ikTargetName, setIkTargetName] = useState<string | null>(null);
  const [isIkRunning, setIsIkRunning] = useState(false);
  const [isIkHandleDragging, setIsIkHandleDragging] = useState(false);
  const [isFollowingOrbit, setIsFollowingOrbit] = useState(false);
  const [orbitFollowProgress, setOrbitFollowProgress] = useState(0);
  const orbitFollowAnimationRef = useRef<number | null>(null);
  const orbitFollowAbortRef = useRef<boolean>(false);
  const lastIkAppliedRef = useRef<Record<string, number> | null>(null);

  const ikDragEnabled =
    dragMode === "drag-handle" && !!robot && !!urdfContent && !!endEffectorLink;

  const liveIkSeedValues = useMemo(
    () => getLiveRobotJoints(robot, storeJointValues),
    [robot, storeJointValues]
  );

  // Reset IK smoothing state when the robot or drag mode changes
  useEffect(() => {
    lastIkAppliedRef.current = null;
  }, [urdfContent, endEffectorLink, dragMode]);

  const solveIkForObject = useCallback(
    async (obj: CreatedObject) => {
      if (dragMode !== "click-to-place") {
        return; // Only allow IK trigger in click-to-place mode
      }

      if (!robot || !urdfContent) {
        toast.error("Load a robot and URDF before solving IK.");
        return;
      }
      if (!endEffectorLink) {
        toast.error("Select an end-effector link to target.");
        return;
      }

      // Fetch the latest object from the store to get updated orbitTargetPoint
      const latestObj = useObjectStore.getState().objects.find((o) => o.id === obj.id);
      if (!latestObj) {
        toast.error("IK target object not found.");
        return;
      }
      const targetObj = latestObj;

      const robotAny = robot;
      const effObj =
        robotAny?.links?.[endEffectorLink] ??
        robotAny?.getObjectByName?.(endEffectorLink) ??
        robotAny?.getObjectByName?.(decodeURIComponent(endEffectorLink));

      const effQuat = new THREE.Quaternion();
      if (effObj) {
        effObj.updateMatrixWorld(true);
        const tmpPos = new THREE.Vector3();
        const tmpScale = new THREE.Vector3();
        effObj.matrixWorld.decompose(tmpPos, effQuat, tmpScale);
      } else {
        effQuat.set(0, 0, 0, 1);
      }

      const jointValues = getLiveRobotJoints(robot, useJointStore.getState().jointValues);

      // Calculate target position based on IK mode
      // Three.js scene coordinates = PyRoki URDF coordinates (meters)
      // Robot is at origin with scale=1, so no transformation needed
      let targetPosition: [number, number, number];
      if (targetObj.ikTargetType === "orbit" && targetObj.orbitTargetPoint !== "center") {
        // Calculate position on orbit based on which point was clicked
        const radius = targetObj.orbitRadius ?? 0.3;
        const inclination = targetObj.orbitInclination ?? 45;
        const basePhase = targetObj.orbitPhase ?? 0;

        // Use secondary offset if secondary point was clicked
        const secondaryOffset =
          targetObj.orbitTargetPoint === "secondary"
            ? (targetObj.orbitSecondaryOffset ?? 180)
            : 0;
        const phase = basePhase + secondaryOffset;

        const phaseRad = (phase * Math.PI) / 180;
        const inclinationRad = (inclination * Math.PI) / 180;

        const x = Math.cos(phaseRad) * radius;
        const y = Math.sin(phaseRad) * radius;
        const z = y * Math.sin(inclinationRad);
        const yAdjusted = y * Math.cos(inclinationRad);

        targetPosition = [
          targetObj.position.x + x,
          targetObj.position.y + yAdjusted,
          targetObj.position.z + z,
        ];
      } else {
        // Punctual mode or center of orbit: use cube center position directly
        targetPosition = [targetObj.position.x, targetObj.position.y, targetObj.position.z];
      }

      // Use end-effector orientation directly (no transformation needed)
      const { w, x, y, z } = effQuat;
      const targetRotation = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
      ];
      const targetWxyz = [w, x, y, z];
      // Orientation is optional for orbit points (not center) and point types
      const orientationOptional =
        (targetObj.ikTargetType === "orbit" && targetObj.orbitTargetPoint !== "center") ||
        (targetObj.ikTargetType !== "orbit" && targetObj.type === "point");

      setIkDialogOpen(true);
      setIkResult(null);
      setIkError(null);
      setIkTargetName(targetObj.id);
      setIsIkRunning(true);

      try {
        const basePayload: Record<string, unknown> = {
          urdf: urdfContent,
          joint_values: jointValues,
          target_link: endEffectorLink,
          target_position: targetPosition,
        };

        const tryPayloads: Array<Record<string, unknown>> = [];
        if (orientationOptional) {
          tryPayloads.push({
            ...basePayload,
            target_rotation: null,
            target_wxyz: null,
            ignore_orientation: true,
          });
        }
        tryPayloads.push({
          ...basePayload,
          target_rotation: targetRotation,
          target_wxyz: targetWxyz,
        });

        let data: IkResponsePayload | null = null;
        let lastError: string | null = null;

        for (const payload of tryPayloads) {
          const response = await fetch(`${apiBaseUrl}/pyroki/ik`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            try {
              const msg = (await response.json()).detail || (await response.json()).error;
              lastError = msg || "IK solve failed";
            } catch {
              lastError = "IK solve failed";
            }
            continue;
          }

          data = (await response.json()) as IkResponsePayload;
          lastError = null;
          break;
        }

        if (!data) {
          setIkError(lastError || "IK solve failed");
          setIkResult(null);
          return;
        }

        setIkResult(data);
      } catch (err) {
        setIkError(err instanceof Error ? err.message : "Unknown IK error");
        setIkResult(null);
      } finally {
        setIsIkRunning(false);
      }
    },
    [apiBaseUrl, dragMode, endEffectorLink, robot, urdfContent]
  );

  // Follow orbit incrementally using previous IK solution as seed
  const followOrbitIncremental = useCallback(
    async (targetObjectId: string) => {
      const targetObj = useObjectStore.getState().objects.find((o) => o.id === targetObjectId);
      if (!targetObj || targetObj.ikTargetType !== "orbit") {
        toast.error("Target is not an orbit");
        return;
      }

      if (!robot || !urdfContent || !endEffectorLink) {
        toast.error("Missing robot, URDF, or end-effector link");
        return;
      }

      if (!ikResult) {
        toast.error("No IK solution to start from");
        return;
      }

      const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;

      // Determine which point was clicked and calculate the arc to traverse
      const basePhase = targetObj.orbitPhase ?? 0;
      const secondaryOffset = targetObj.orbitSecondaryOffset ?? 180;
      const clickedPoint = targetObj.orbitTargetPoint; // "primary", "secondary", or "center"

      if (clickedPoint === "center" || !clickedPoint) {
        toast.error("Please click on a primary or secondary orbit point first");
        return;
      }

      const primaryPhase = normalizeDeg(basePhase);
      const secondaryPhase = normalizeDeg(basePhase + secondaryOffset);
      const startPhase = clickedPoint === "primary" ? primaryPhase : secondaryPhase;
      const destinationPhase = clickedPoint === "primary" ? secondaryPhase : primaryPhase;

      // Choose the shortest arc between the two points (matches the solid segment in the visualization)
      const clockwiseDelta = normalizeDeg(destinationPhase - startPhase);
      const counterClockwiseDelta = clockwiseDelta === 0 ? 360 : 360 - clockwiseDelta;
      const useClockwise = clockwiseDelta <= counterClockwiseDelta;
      const arcLength = clockwiseDelta === 0 ? 360 : useClockwise ? clockwiseDelta : counterClockwiseDelta;
      const direction = useClockwise ? 1 : -1;

      // Stop any existing orbit following
      if (orbitFollowAnimationRef.current) {
        cancelAnimationFrame(orbitFollowAnimationRef.current);
      }
      orbitFollowAbortRef.current = false;

      setIsFollowingOrbit(true);
      setOrbitFollowProgress(0);
      toast.success(`Following orbit from ${clickedPoint} point...`);

      const radius = targetObj.orbitRadius ?? 0.3;
      const inclination = targetObj.orbitInclination ?? 45;
      const inclinationRad = (inclination * Math.PI) / 180;
      const totalSteps = Math.max(1, Math.round(arcLength)); // 1 degree per step
      const minStepIntervalMs = 45;

      let currentStep = 0;
      let currentJointValues = { ...ikResult.solution };
      let lastTimestamp = performance.now();

      const computeTargetPosition = (phaseDeg: number): [number, number, number] => {
        const phaseRad = (phaseDeg * Math.PI) / 180;
        const x = Math.cos(phaseRad) * radius;
        const y = Math.sin(phaseRad) * radius;
        const z = y * Math.sin(inclinationRad);
        const yAdjusted = y * Math.cos(inclinationRad);

        return [
          targetObj.position.x + x,
          targetObj.position.y + yAdjusted,
          targetObj.position.z + z,
        ];
      };

      const stepOrbit = async (timestamp: number) => {
        if (orbitFollowAbortRef.current) {
          setIsFollowingOrbit(false);
          orbitFollowAnimationRef.current = null;
          toast.info("Orbit following stopped");
          return;
        }

        // Throttle the IK calls to avoid hammering the backend
        if (timestamp - lastTimestamp < minStepIntervalMs && currentStep !== 0) {
          orbitFollowAnimationRef.current = requestAnimationFrame(stepOrbit);
          return;
        }
        lastTimestamp = timestamp;

        // Calculate current phase along the chosen arc
        const t = totalSteps <= 1 ? 1 : currentStep / (totalSteps - 1); // cover the full arc including the end point
        const currentPhase = normalizeDeg(startPhase + direction * arcLength * t);
        const targetPosition = computeTargetPosition(currentPhase);

        try {
          // Use current joint values as seed for next IK
          const response = await fetch(`${apiBaseUrl}/pyroki/ik`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              urdf: urdfContent,
              joint_values: currentJointValues,
              target_link: endEffectorLink,
              target_position: targetPosition,
              ignore_orientation: true,
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as IkResponsePayload;
            currentJointValues = data.solution;

            // Apply to robot
            setStoreJointValues(data.solution);
            onIkApplied?.(data.solution);
          } else {
            console.error("IK failed at step", currentStep);
          }
        } catch (err) {
          console.error("Error during orbit following:", err);
          setIsFollowingOrbit(false);
          orbitFollowAnimationRef.current = null;
          toast.error("Orbit following failed");
          return;
        }

        currentStep++;
        setOrbitFollowProgress(Math.min(100, (currentStep / totalSteps) * 100));

        if (currentStep < totalSteps) {
          orbitFollowAnimationRef.current = requestAnimationFrame(stepOrbit);
        } else {
          setIsFollowingOrbit(false);
          orbitFollowAnimationRef.current = null;
          toast.success("Completed orbit arc");
        }
      };

      // Start the orbit following
      orbitFollowAnimationRef.current = requestAnimationFrame(stepOrbit);
    },
    [apiBaseUrl, endEffectorLink, ikResult, onIkApplied, robot, setStoreJointValues, urdfContent]
  );

  // Stop orbit following
  const stopOrbitFollow = useCallback(() => {
    orbitFollowAbortRef.current = true;
    if (orbitFollowAnimationRef.current) {
      cancelAnimationFrame(orbitFollowAnimationRef.current);
      orbitFollowAnimationRef.current = null;
    }
    setIsFollowingOrbit(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (orbitFollowAnimationRef.current) {
        cancelAnimationFrame(orbitFollowAnimationRef.current);
      }
    };
  }, []);

  const handleIkDragSolved = useCallback(
    (solution: Record<string, number>) => {
      const SMOOTH_ALPHA = 0.35; // blend factor to damp sudden IK jumps
      const previous = lastIkAppliedRef.current;
      const blended: Record<string, number> = {};

      if (previous) {
        // Blend towards new solution to avoid flicker between IK branches
        for (const [joint, value] of Object.entries(solution)) {
          const prevVal = previous[joint] ?? value;
          blended[joint] = prevVal + (value - prevVal) * SMOOTH_ALPHA;
        }
        // Keep any joints that were in the previous state but not present in the new solution
        for (const [joint, prevVal] of Object.entries(previous)) {
          if (!(joint in blended)) {
            blended[joint] = prevVal;
          }
        }
      } else {
        Object.assign(blended, solution);
      }

      lastIkAppliedRef.current = blended;

      console.log("[Viewer3D] IK solution received:", solution);
      (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges = true;
      const robotAny = robot;
      if (robotAny?.setJointValues || robotAny?.setJointValue) {
        console.log(
          `[Viewer3D] Applying via ${robotAny.setJointValues ? "setJointValues" : "setJointValue"}`
        );
        applyJointValues(robotAny, blended, { filter: false });
      } else {
        console.error("[Viewer3D] Robot has no setJointValues or setJointValue method!");
      }
      console.log("[Viewer3D] Updating store with solution");
      setStoreJointValues(blended);
      onIkApplied?.(blended);
    },
    [onIkApplied, robot, setStoreJointValues]
  );

  const handleIkDragStateChange = useCallback((dragging: boolean) => {
    setIsIkHandleDragging(dragging);
    if (dragging) {
      (window as WindowWithViewerHandlers).__viewer3dHasManualJointChanges = true;
    }
  }, []);

  // Reset IK drag state when mode changes or handle is hidden
  useEffect(() => {
    if (!ikDragEnabled && isIkHandleDragging) {
      setIsIkHandleDragging(false);
    }
  }, [ikDragEnabled, isIkHandleDragging]);

  return {
    followOrbitIncremental,
    handleIkDragSolved,
    handleIkDragStateChange,
    ikDialogOpen,
    ikDragEnabled,
    ikError,
    ikResult,
    ikTargetName,
    isFollowingOrbit,
    isIkHandleDragging,
    isIkRunning,
    liveIkSeedValues,
    orbitFollowProgress,
    setIkDialogOpen,
    solveIkForObject,
    stopOrbitFollow,
  };
};
