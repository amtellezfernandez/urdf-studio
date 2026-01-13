import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";

type MouseButtonsWithOriginal = OrbitControlsImpl["mouseButtons"] & {
  _originalMiddle?: THREE.MOUSE;
};

type UseOrbitControlsBindingsParams = {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  robot: URDFRobot | null;
};

export const useOrbitControlsBindings = ({
  controlsRef,
  robot,
}: UseOrbitControlsBindingsParams) => {
  const isShiftPressedRef = useRef(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!controlsRef.current) return;

      const controls = controlsRef.current;
      const threeControls = controls as OrbitControlsImpl | null;

      if (threeControls?.mouseButtons) {
        const mouseButtons = threeControls.mouseButtons as MouseButtonsWithOriginal;
        if (mouseButtons._originalMiddle === undefined) {
          mouseButtons._originalMiddle = mouseButtons.MIDDLE ?? THREE.MOUSE.DOLLY;
          mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
        }
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [controlsRef, robot]);

  useEffect(() => {
    const updateMMBBehavior = (shouldPan: boolean) => {
      if (!controlsRef.current) return;

      const threeControls = controlsRef.current;
      if (threeControls?.mouseButtons) {
        const mouseButtons = threeControls.mouseButtons as MouseButtonsWithOriginal;
        if (mouseButtons._originalMiddle === undefined) {
          mouseButtons._originalMiddle = mouseButtons.MIDDLE ?? THREE.MOUSE.DOLLY;
        }

        if (shouldPan) {
          mouseButtons.MIDDLE = THREE.MOUSE.PAN;
        } else {
          const originalMiddle = mouseButtons._originalMiddle ?? THREE.MOUSE.DOLLY;
          mouseButtons.MIDDLE = originalMiddle;
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.shiftKey) {
        if (!isShiftPressedRef.current) {
          isShiftPressedRef.current = true;
          updateMMBBehavior(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setTimeout(() => {
          if (!e.shiftKey && isShiftPressedRef.current) {
            isShiftPressedRef.current = false;
            updateMMBBehavior(false);
          }
        }, 0);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        if (e.shiftKey && !isShiftPressedRef.current) {
          isShiftPressedRef.current = true;
          updateMMBBehavior(true);
        } else if (!e.shiftKey && isShiftPressedRef.current) {
          isShiftPressedRef.current = false;
          updateMMBBehavior(false);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1 && !e.shiftKey && isShiftPressedRef.current) {
        isShiftPressedRef.current = false;
        updateMMBBehavior(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [controlsRef]);
};
