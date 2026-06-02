import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";

type MouseButtonsWithOriginal = OrbitControlsImpl["mouseButtons"] & {
  _originalMiddle?: THREE.MOUSE;
  _originalLeft?: THREE.MOUSE;
  _originalRight?: THREE.MOUSE;
};

type UseOrbitControlsBindingsParams = {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  robot: URDFRobot | null;
};

type ModifierEvent = Pick<
  KeyboardEvent | MouseEvent | PointerEvent,
  "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
> & {
  getModifierState?: (keyArg: string) => boolean;
};
type PanModifierKey = "Control" | "Meta" | "Alt";

const ORIGINAL_MOUSE_BINDINGS = {
  middle: THREE.MOUSE.DOLLY,
  left: THREE.MOUSE.ROTATE,
  right: THREE.MOUSE.ROTATE,
} as const;
const ORBIT_BINDINGS_INIT_DELAY_MS = 100;
const USE_CAPTURE_PHASE = true;

const normalizePanModifierKey = (key: string): string | null => {
  if (key === "Control" || key === "Ctrl") return "Control";
  if (key === "Meta" || key === "OS") return "Meta";
  if (key === "Alt" || key === "AltGraph") return "Alt";
  return null;
};

const normalizePanModifierCode = (code?: string): string | null => {
  if (!code) return null;
  if (code === "ControlLeft" || code === "ControlRight") return "Control";
  if (code === "MetaLeft" || code === "MetaRight") return "Meta";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  return null;
};

const hasPanModifier = (event?: ModifierEvent) =>
  Boolean(
    event?.ctrlKey ||
      event?.altKey ||
      event?.metaKey ||
      event?.getModifierState?.("Control") ||
      event?.getModifierState?.("Alt") ||
      event?.getModifierState?.("AltGraph") ||
      event?.getModifierState?.("Meta") ||
      event?.getModifierState?.("OS")
  );

const getMouseButtons = (controls: OrbitControlsImpl | null): MouseButtonsWithOriginal | null => {
  if (!controls?.mouseButtons) return null;
  return controls.mouseButtons as MouseButtonsWithOriginal;
};

const ensureOriginalMouseButtons = (mouseButtons: MouseButtonsWithOriginal) => {
  if (mouseButtons._originalMiddle === undefined) {
    mouseButtons._originalMiddle = mouseButtons.MIDDLE ?? ORIGINAL_MOUSE_BINDINGS.middle;
  }
  if (mouseButtons._originalLeft === undefined) {
    mouseButtons._originalLeft = mouseButtons.LEFT ?? ORIGINAL_MOUSE_BINDINGS.left;
  }
  if (mouseButtons._originalRight === undefined) {
    mouseButtons._originalRight = mouseButtons.RIGHT ?? ORIGINAL_MOUSE_BINDINGS.right;
  }
};

export const useOrbitControlsBindings = ({
  controlsRef,
  robot,
}: UseOrbitControlsBindingsParams) => {
  const isShiftPressedRef = useRef(false);
  const isPanModifierPressedRef = useRef(false);
  const panModifierKeysPressedRef = useRef(new Set<string>());

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const mouseButtons = getMouseButtons(controlsRef.current);
      if (!mouseButtons) return;
      ensureOriginalMouseButtons(mouseButtons);
      mouseButtons.MIDDLE = ORIGINAL_MOUSE_BINDINGS.middle;
    }, ORBIT_BINDINGS_INIT_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, [controlsRef, robot]);

  useEffect(() => {
    let originalEnableRotate: boolean | null = null;
    const panModifierKeysPressed = panModifierKeysPressedRef.current;
    const setModifierPressed = (modifier: PanModifierKey, isPressed: boolean) => {
      if (isPressed) {
        panModifierKeysPressed.add(modifier);
      } else {
        panModifierKeysPressed.delete(modifier);
      }
    };
    const syncPanModifierSetFromKeyboardEvent = (event: KeyboardEvent) => {
      setModifierPressed("Control", event.ctrlKey);
      setModifierPressed("Meta", event.metaKey);
      setModifierPressed("Alt", event.altKey || event.getModifierState?.("AltGraph"));
    };
    const syncPanModifierPressedState = (event?: ModifierEvent) => {
      const keyboardModifierActive = panModifierKeysPressed.size > 0;
      const eventModifierActive = hasPanModifier(event);
      isPanModifierPressedRef.current = keyboardModifierActive || eventModifierActive;
    };

    const updateMouseBindings = ({
      panMiddle,
      panLeft,
      panRight,
    }: {
      panMiddle: boolean;
      panLeft: boolean;
      panRight: boolean;
    }) => {
      const controls = controlsRef.current;
      const mouseButtons = getMouseButtons(controls);
      if (!controls || !mouseButtons) return;
      if (originalEnableRotate === null) {
        originalEnableRotate = controls.enableRotate;
      }

      ensureOriginalMouseButtons(mouseButtons);
      mouseButtons.MIDDLE = panMiddle
        ? THREE.MOUSE.PAN
        : (mouseButtons._originalMiddle ?? ORIGINAL_MOUSE_BINDINGS.middle);
      mouseButtons.LEFT = panLeft
        ? THREE.MOUSE.PAN
        : (mouseButtons._originalLeft ?? ORIGINAL_MOUSE_BINDINGS.left);
      mouseButtons.RIGHT = panRight
        ? THREE.MOUSE.PAN
        : (mouseButtons._originalRight ?? ORIGINAL_MOUSE_BINDINGS.right);

      // In modifier pan mode, disable rotate entirely for true lateral translation behavior.
      const forcePanMode = panLeft || panRight;
      controls.enableRotate = forcePanMode ? false : (originalEnableRotate ?? true);
    };

    const syncBindings = (event?: ModifierEvent) => {
      syncPanModifierPressedState(event);
      const panMiddle = Boolean(event?.shiftKey) || isShiftPressedRef.current;
      const panLeft = isPanModifierPressedRef.current;
      updateMouseBindings({ panMiddle, panLeft, panRight: panLeft });
    };

    const syncFromPointerState = (event: ModifierEvent) => {
      isShiftPressedRef.current = Boolean(event.shiftKey);
      syncBindings(event);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.shiftKey) {
        isShiftPressedRef.current = true;
      }
      const normalizedPanModifierKey =
        normalizePanModifierKey(e.key) ?? normalizePanModifierCode(e.code);
      if (normalizedPanModifierKey) {
        panModifierKeysPressed.add(normalizedPanModifierKey);
      }
      syncPanModifierSetFromKeyboardEvent(e);
      syncBindings(e);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        isShiftPressedRef.current = false;
      }
      const normalizedPanModifierKey =
        normalizePanModifierKey(e.key) ?? normalizePanModifierCode(e.code);
      if (normalizedPanModifierKey) {
        panModifierKeysPressed.delete(normalizedPanModifierKey);
      }
      syncPanModifierSetFromKeyboardEvent(e);
      syncBindings(e);
    };

    const handleMouseDown = (e: MouseEvent) => syncFromPointerState(e);
    const handleMouseUp = (e: MouseEvent) => syncFromPointerState(e);
    const handlePointerDown = (e: PointerEvent) => syncFromPointerState(e);
    const handlePointerUp = (e: PointerEvent) => syncFromPointerState(e);
    const handleMouseMove = (e: MouseEvent) => syncFromPointerState(e);
    const handlePointerMove = (e: PointerEvent) => syncFromPointerState(e);
    const resetModifierState = () => {
      panModifierKeysPressed.clear();
      isPanModifierPressedRef.current = false;
      isShiftPressedRef.current = false;
      updateMouseBindings({ panMiddle: false, panLeft: false, panRight: false });
    };

    const keyboardEvents: Array<["keydown" | "keyup", (event: KeyboardEvent) => void]> = [
      ["keydown", handleKeyDown],
      ["keyup", handleKeyUp],
    ];
    const pointerEvents: Array<
      [
        "mousedown" | "mouseup" | "mousemove" | "pointerdown" | "pointerup" | "pointermove",
        (event: MouseEvent | PointerEvent) => void
      ]
    > = [
      ["mousedown", handleMouseDown],
      ["mouseup", handleMouseUp],
      ["mousemove", handleMouseMove],
      ["pointerdown", handlePointerDown],
      ["pointerup", handlePointerUp],
      ["pointermove", handlePointerMove],
    ];

    keyboardEvents.forEach(([eventName, handler]) => {
      window.addEventListener(eventName, handler);
    });
    pointerEvents.forEach(([eventName, handler]) => {
      window.addEventListener(eventName, handler, USE_CAPTURE_PHASE);
    });

    const handleWindowBlur = () => {
      resetModifierState();
    };
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      keyboardEvents.forEach(([eventName, handler]) => {
        window.removeEventListener(eventName, handler);
      });
      pointerEvents.forEach(([eventName, handler]) => {
        window.removeEventListener(eventName, handler, USE_CAPTURE_PHASE);
      });
      window.removeEventListener("blur", handleWindowBlur);
      resetModifierState();
    };
  }, [controlsRef]);
};
