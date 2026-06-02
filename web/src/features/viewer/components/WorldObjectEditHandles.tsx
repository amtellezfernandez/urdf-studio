import { Html, Line } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import type { CreatedObject } from "@/features/objects";
import { WORLD_OBJECT_EDIT_PARAMS } from "@/features/objects/worldObjectEditParams";
import {
  WORLD_OBJECT_CUBE_CORNER_SIGNS,
  WORLD_OBJECT_CUBE_FACE_HANDLES,
  resolveCubeCornerOffset,
  resolveCubeResizeFromDraggedFace,
  resolveCubeUniformResize,
  resolveCubeResizeFromDraggedCorner,
  resolveWorldCubeCornerPosition,
  resolveWorldCubeFaceHandlePosition,
  snapScalar,
  snapVector3,
} from "@/features/objects/worldObjectEditMath";
import { useObjectStore } from "@/features/objects/useObjectStore";

type DragState =
  | {
      kind: "move-axis";
      startPosition: THREE.Vector3;
      axis: "x" | "y" | "z";
      axisVector: THREE.Vector3;
      screenAxisDirection: THREE.Vector2;
      pixelsPerUnit: number;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: "resize-face";
      plane: THREE.Plane;
      startPoint: THREE.Vector3;
      startPosition: THREE.Vector3;
      startSize: THREE.Vector3;
      axis: "x" | "y" | "z";
      direction: -1 | 1;
    }
  | {
      kind: "resize";
      plane: THREE.Plane;
      startPoint: THREE.Vector3;
      startPosition: THREE.Vector3;
      startSize: THREE.Vector3;
      initialDraggedCorner: THREE.Vector3;
      initialDraggedCornerWorld: THREE.Vector3;
      anchorCorner: THREE.Vector3;
      handleSign: THREE.Vector3;
    }
  | {
      kind: "resize-uniform";
      plane: THREE.Plane;
      startPoint: THREE.Vector3;
      startSize: THREE.Vector3;
      startRadius: number;
    }
  | {
      kind: "rotate-axis";
      plane: THREE.Plane;
      startRotation: THREE.Euler;
      startAngleRad: number;
      axis: "x" | "y" | "z";
      axisVector: THREE.Vector3;
    };

type WorldObjectEditHandlesProps = {
  object: CreatedObject;
  mode: "move" | "resize" | "rotate";
  onDragStateChange?: (dragging: boolean) => void;
};

type DragPreviewState = {
  startWorld: THREE.Vector3;
  currentWorld: THREE.Vector3;
  label: string;
  measurement?: string;
  snapEnabled: boolean;
};

const formatMeters = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(WORLD_OBJECT_EDIT_PARAMS.guideMeasurementDecimals)}m`;

const formatDegrees = (valueRad: number): string =>
  `${valueRad >= 0 ? "+" : ""}${THREE.MathUtils.radToDeg(valueRad).toFixed(1)}deg`;

const formatAxisMeasurement = (axis: "x" | "y" | "z", value: number): string =>
  `${axis.toUpperCase()} ${formatMeters(value)}`;

const formatAxisCoordinate = (axis: "x" | "y" | "z", value: number): string =>
  `${axis.toUpperCase()} ${value.toFixed(WORLD_OBJECT_EDIT_PARAMS.guideMeasurementDecimals)}`;

const formatVectorMeasurement = (
  value: THREE.Vector3,
  axes: ReadonlyArray<"x" | "y" | "z">
): string => axes.map((axis) => formatAxisMeasurement(axis, value[axis])).join(" • ");

const OVERLAY_LABEL_CLASS =
  "pointer-events-none rounded border border-border/70 bg-background/95 px-1 py-[1px] font-mono text-[8.5px] font-semibold leading-none text-foreground shadow-sm";

const OVERLAY_META_CLASS =
  "pointer-events-none rounded border border-border/60 bg-background/92 px-1 py-[1px] font-mono text-[8px] leading-none text-foreground/90 shadow-sm";

const resolveHandleLabel = (handleId: string): string => {
  if (handleId.startsWith("move-")) {
    return handleId.replace("move-", "").toUpperCase();
  }
  if (handleId.startsWith("face-")) {
    const [, axis, direction] = handleId.split("-");
    return `${axis.toUpperCase()}${direction === "1" ? "+" : "-"}`;
  }
  if (handleId.startsWith("corner-")) {
    return "XYZ";
  }
  if (handleId === "resize-uniform") {
    return "XYZ";
  }
  if (handleId.startsWith("rotate-")) {
    return handleId.replace("rotate-", "").toUpperCase();
  }
  return handleId;
};

const resolveHandleOpacity = ({
  activeHandleId,
  hoveredHandleId,
  handleId,
}: {
  activeHandleId: string | null;
  hoveredHandleId: string | null;
  handleId: string;
}) => {
  if (!activeHandleId && !hoveredHandleId) {
    return 1;
  }
  return activeHandleId === handleId || hoveredHandleId === handleId
    ? 1
    : WORLD_OBJECT_EDIT_PARAMS.inactiveHandleOpacity;
};

const resolveHandleMaterialOpacity = ({
  activeHandleId,
  hoveredHandleId,
  handleId,
  baseOpacity = 1,
}: {
  activeHandleId: string | null;
  hoveredHandleId: string | null;
  handleId: string;
  baseOpacity?: number;
}) => {
  if (activeHandleId === handleId) {
    return baseOpacity * WORLD_OBJECT_EDIT_PARAMS.activeHandleMaterialOpacity;
  }
  if (hoveredHandleId === handleId) {
    return baseOpacity * WORLD_OBJECT_EDIT_PARAMS.hoveredHandleMaterialOpacity;
  }
  if (!activeHandleId && !hoveredHandleId) {
    return baseOpacity;
  }
  return baseOpacity * WORLD_OBJECT_EDIT_PARAMS.inactiveHandleOpacity;
};

const buildScreenPlane = (
  camera: THREE.Camera,
  point: THREE.Vector3
): THREE.Plane => {
  const planeNormal = new THREE.Vector3();
  camera.getWorldDirection(planeNormal);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, point);
};

const resolveWorldToScreenPoint = (
  worldPoint: THREE.Vector3,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number
): THREE.Vector2 => {
  const projected = worldPoint.clone().project(camera);
  return new THREE.Vector2(
    ((projected.x + 1) * 0.5) * viewportWidth,
    ((1 - projected.y) * 0.5) * viewportHeight
  );
};

const MOVE_AXES = [
  { axis: "x" as const, vector: new THREE.Vector3(1, 0, 0) },
  { axis: "y" as const, vector: new THREE.Vector3(0, 1, 0) },
  { axis: "z" as const, vector: new THREE.Vector3(0, 0, 1) },
] as const;

const ROTATE_AXES = [
  {
    axis: "x" as const,
    vector: new THREE.Vector3(1, 0, 0),
    rotation: [0, Math.PI / 2, 0] as [number, number, number],
  },
  {
    axis: "y" as const,
    vector: new THREE.Vector3(0, 1, 0),
    rotation: [Math.PI / 2, 0, 0] as [number, number, number],
  },
  {
    axis: "z" as const,
    vector: new THREE.Vector3(0, 0, 1),
    rotation: [0, 0, 0] as [number, number, number],
  },
] as const;

const RESIZE_FACE_BOX_ARGS = {
  x: [
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadThicknessM,
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadSizeM,
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadSizeM,
  ] as const,
  y: [
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadSizeM,
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadThicknessM,
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadSizeM,
  ] as const,
  z: [
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadSizeM,
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadSizeM,
    WORLD_OBJECT_EDIT_PARAMS.resizeFacePadThicknessM,
  ] as const,
} as const;

const resolveResizeFaceHighlightArgs = (
  size: THREE.Vector3,
  axis: "x" | "y" | "z"
): [number, number, number] => {
  if (axis === "x") {
    return [
      WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightThicknessM,
      size.y,
      size.z,
    ];
  }
  if (axis === "y") {
    return [
      size.x,
      WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightThicknessM,
      size.z,
    ];
  }
  return [
    size.x,
    size.y,
    WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightThicknessM,
  ];
};

const resolveEyeVector = (
  camera: THREE.Camera,
  worldPosition: THREE.Vector3
): THREE.Vector3 => {
  if (camera instanceof THREE.OrthographicCamera) {
    return camera.getWorldDirection(new THREE.Vector3()).negate();
  }
  return camera.position.clone().sub(worldPosition).normalize();
};

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

const normalizeAngleDeltaRad = (value: number): number => {
  let normalized = value;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
};

const resolveAxisPlaneAngleRad = ({
  point,
  center,
  axisVector,
}: {
  point: THREE.Vector3;
  center: THREE.Vector3;
  axisVector: THREE.Vector3;
}): number => {
  const planeVector = point.clone().sub(center);
  const referenceVector =
    Math.abs(axisVector.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
  const basisU = referenceVector.clone().cross(axisVector).normalize();
  const basisV = axisVector.clone().cross(basisU).normalize();
  return Math.atan2(planeVector.dot(basisV), planeVector.dot(basisU));
};

export const WorldObjectEditHandles = ({
  object,
  mode,
  onDragStateChange,
}: WorldObjectEditHandlesProps) => {
  const beginEditSession = useObjectStore((state) => state.beginEditSession);
  const cancelEditSession = useObjectStore((state) => state.cancelEditSession);
  const endEditSession = useObjectStore((state) => state.endEditSession);
  const updateObjectPosition = useObjectStore((state) => state.updateObjectPosition);
  const updateObjectRotation = useObjectStore((state) => state.updateObjectRotation);
  const updateObjectSize = useObjectStore((state) => state.updateObjectSize);
  const { camera, gl } = useThree();
  const dragStateRef = useRef<DragState | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragPointerTargetRef = useRef<EventTarget | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const intersectionRef = useRef(new THREE.Vector3());
  const objectIdRef = useRef(object.id);
  const objectPositionRef = useRef(object.position.clone());
  const objectQuaternionRef = useRef(new THREE.Quaternion());
  const inverseObjectQuaternionRef = useRef(new THREE.Quaternion());
  const moveAxisGroupRefs = useRef<Array<THREE.Group | null>>([]);
  const resizeFaceGroupRefs = useRef<Array<THREE.Group | null>>([]);
  const resizeCornerGroupRefs = useRef<Array<THREE.Group | null>>([]);
  const resizeUniformGroupRef = useRef<THREE.Group | null>(null);
  const rotateGroupRefs = useRef<Array<THREE.Group | null>>([]);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [hoveredHandleId, setHoveredHandleId] = useState<string | null>(null);
  const [activeHandleId, setActiveHandleId] = useState<string | null>(null);
  const statusHandleId = activeHandleId ?? hoveredHandleId;
  const resolvedRotation = useMemo(
    () =>
      new THREE.Euler(
        object.rotation?.x ?? 0,
        object.rotation?.y ?? 0,
        object.rotation?.z ?? 0,
        object.rotation?.order ?? "XYZ"
      ),
    [object.rotation]
  );
  const objectQuaternion = useMemo(
    () => new THREE.Quaternion().setFromEuler(resolvedRotation),
    [resolvedRotation]
  );
  const inverseObjectQuaternion = useMemo(
    () => objectQuaternion.clone().invert(),
    [objectQuaternion]
  );
  objectIdRef.current = object.id;
  objectPositionRef.current.copy(object.position);
  objectQuaternionRef.current.copy(objectQuaternion);
  inverseObjectQuaternionRef.current.copy(inverseObjectQuaternion);

  const cornerHandles = useMemo(
    () =>
      WORLD_OBJECT_CUBE_CORNER_SIGNS.map((sign, index) => ({
        id: `corner-${index}`,
        sign,
        position: resolveWorldCubeCornerPosition({
          center: object.position,
          size: object.size,
          rotation: objectQuaternion,
          sign,
        }),
      })),
    [object.position, object.size, objectQuaternion]
  );

  const faceHandles = useMemo(
    () =>
      WORLD_OBJECT_CUBE_FACE_HANDLES.map((handle, index) => ({
        id: `face-${index}`,
        axis: handle.axis,
        direction: handle.direction,
        position: resolveWorldCubeFaceHandlePosition({
          center: object.position,
          size: object.size,
          rotation: objectQuaternion,
          axis: handle.axis,
          direction: handle.direction,
        }),
      })),
    [object.position, object.size, objectQuaternion]
  );

  const moveAxisHandles = useMemo(
    () =>
      MOVE_AXES.map((handle, index) => ({
        id: `move-${handle.axis}-${index}`,
        axis: handle.axis,
        vector: handle.vector,
        position: [
          object.position.x + handle.vector.x * WORLD_OBJECT_EDIT_PARAMS.moveAxisHandleLengthM,
          object.position.y + handle.vector.y * WORLD_OBJECT_EDIT_PARAMS.moveAxisHandleLengthM,
          object.position.z + handle.vector.z * WORLD_OBJECT_EDIT_PARAMS.moveAxisHandleLengthM,
        ] as [number, number, number],
      })),
    [object.position.x, object.position.y, object.position.z]
  );
  const eyeVector = useMemo(
    () => resolveEyeVector(camera, object.position),
    [camera, object.position]
  );
  const visibleMoveAxes = useMemo(
    () =>
      new Set(
        MOVE_AXES.filter(
          (handle) =>
            Math.abs(handle.vector.clone().normalize().dot(eyeVector)) <=
            WORLD_OBJECT_EDIT_PARAMS.axisHideThreshold
        ).map((handle) => handle.axis)
      ),
    [eyeVector]
  );

  const visibleResizeFaces = useMemo(
    () =>
      new Set(
        WORLD_OBJECT_CUBE_FACE_HANDLES.filter((handle) => {
          const axisVector =
            handle.axis === "x"
              ? new THREE.Vector3(1, 0, 0)
              : handle.axis === "y"
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
          axisVector.applyQuaternion(objectQuaternion);
          return (
            Math.abs(axisVector.dot(eyeVector)) >=
            WORLD_OBJECT_EDIT_PARAMS.planeHideThreshold
          );
        }).map((handle) => `face-${handle.axis}-${handle.direction}`)
      ),
    [eyeVector, objectQuaternion]
  );

  const activeResizeFaceHandle = useMemo(() => {
    if (mode !== "resize" || !statusHandleId?.startsWith("face-")) {
      return null;
    }
    return faceHandles.find(
      (handle) => `face-${handle.axis}-${handle.direction}` === statusHandleId
    ) ?? null;
  }, [faceHandles, mode, statusHandleId]);

  const activeResizeCornerHandle = useMemo(() => {
    if (mode !== "resize" || !statusHandleId?.startsWith("corner-")) {
      return null;
    }
    return cornerHandles.find(
      (handle) =>
        `corner-${handle.sign.x}-${handle.sign.y}-${handle.sign.z}` === statusHandleId
    ) ?? null;
  }, [cornerHandles, mode, statusHandleId]);

  const activeResizeUniformHandle =
    mode === "resize" && statusHandleId === "resize-uniform";

  const applyScreenStableScale = useCallback(
    (
      group: THREE.Group | null,
      emphasisScale = 1,
      targetScreenFactorPx: number = WORLD_OBJECT_EDIT_PARAMS.targetScreenFactorPx
    ) => {
      if (!group) {
        return;
      }
      const worldPosition = new THREE.Vector3();
      group.getWorldPosition(worldPosition);
      let screenScale = 1;
      if (camera instanceof THREE.PerspectiveCamera) {
        const distance = camera.position.distanceTo(worldPosition);
        const visibleHeight =
          2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(distance, 0.001);
        const baseScale =
          (visibleHeight * targetScreenFactorPx) /
          WORLD_OBJECT_EDIT_PARAMS.screenScaleReferencePx;
        screenScale = THREE.MathUtils.clamp(
          baseScale,
          WORLD_OBJECT_EDIT_PARAMS.minScreenScale,
          WORLD_OBJECT_EDIT_PARAMS.maxScreenScale
        );
      } else if (camera instanceof THREE.OrthographicCamera) {
        const visibleHeight = Math.abs(camera.top - camera.bottom) / camera.zoom;
        const baseScale =
          (visibleHeight * targetScreenFactorPx) /
          WORLD_OBJECT_EDIT_PARAMS.screenScaleReferencePx;
        screenScale = THREE.MathUtils.clamp(
          baseScale,
          WORLD_OBJECT_EDIT_PARAMS.minScreenScale,
          WORLD_OBJECT_EDIT_PARAMS.maxScreenScale
        );
      }
      group.scale.setScalar(screenScale * emphasisScale);
    },
    [camera]
  );

  useFrame(() => {
    moveAxisGroupRefs.current.forEach((group, index) => {
      const handle = moveAxisHandles[index];
      if (!handle) {
        return;
      }
      const handleId = `move-${handle.axis}`;
      const moveEmphasis =
        activeHandleId === handleId
          ? WORLD_OBJECT_EDIT_PARAMS.activeHandleScale
          : hoveredHandleId === handleId
            ? WORLD_OBJECT_EDIT_PARAMS.hoveredHandleScale
            : 1;
      applyScreenStableScale(group, moveEmphasis);
    });

    resizeFaceGroupRefs.current.forEach((group, index) => {
      const handle = faceHandles[index];
      if (!handle) {
        return;
      }
      const handleId = `face-${handle.axis}-${handle.direction}`;
      const emphasis =
        activeHandleId === handleId
          ? WORLD_OBJECT_EDIT_PARAMS.activeHandleScale
          : hoveredHandleId === handleId
            ? WORLD_OBJECT_EDIT_PARAMS.hoveredHandleScale
            : 1;
      applyScreenStableScale(group, emphasis);
    });

    resizeCornerGroupRefs.current.forEach((group, index) => {
      const handle = cornerHandles[index];
      if (!handle) {
        return;
      }
      const handleId = `corner-${handle.sign.x}-${handle.sign.y}-${handle.sign.z}`;
      const emphasis =
        activeHandleId === handleId
          ? WORLD_OBJECT_EDIT_PARAMS.activeHandleScale
          : hoveredHandleId === handleId
            ? WORLD_OBJECT_EDIT_PARAMS.hoveredHandleScale
            : 1;
      applyScreenStableScale(group, emphasis);
    });

    applyScreenStableScale(
      resizeUniformGroupRef.current,
      activeHandleId === "resize-uniform"
        ? WORLD_OBJECT_EDIT_PARAMS.activeHandleScale
        : hoveredHandleId === "resize-uniform"
          ? WORLD_OBJECT_EDIT_PARAMS.hoveredHandleScale
          : 1
    );

    rotateGroupRefs.current.forEach((group, index) => {
      const handle = ROTATE_AXES[index];
      if (!handle) {
        return;
      }
      const handleId = `rotate-${handle.axis}`;
      const emphasis =
        activeHandleId === handleId
          ? WORLD_OBJECT_EDIT_PARAMS.activeHandleScale
          : hoveredHandleId === handleId
            ? WORLD_OBJECT_EDIT_PARAMS.hoveredHandleScale
            : 1;
      applyScreenStableScale(
        group,
        emphasis,
        WORLD_OBJECT_EDIT_PARAMS.rotateTargetScreenFactorPx
      );
    });
  });

  const intersectPointerWithPlane = useCallback(
    (event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      if (!raycasterRef.current.ray.intersectPlane(plane, intersectionRef.current)) {
        return null;
      }
      return intersectionRef.current.clone();
    },
    [camera, gl]
  );

  const releaseDragPointerCapture = useCallback(() => {
    if (
      dragPointerTargetRef.current instanceof Element &&
      dragPointerIdRef.current !== null &&
      dragPointerTargetRef.current.hasPointerCapture?.(dragPointerIdRef.current)
    ) {
      dragPointerTargetRef.current.releasePointerCapture(dragPointerIdRef.current);
    }
    dragPointerIdRef.current = null;
    dragPointerTargetRef.current = null;
  }, []);

  const resetDragUi = useCallback(() => {
    dragStateRef.current = null;
    setDragPreview(null);
    setActiveHandleId(null);
    setHoveredHandleId(null);
    onDragStateChange?.(false);
    gl.domElement.style.cursor = "";
    releaseDragPointerCapture();
  }, [gl, onDragStateChange, releaseDragPointerCapture]);

  const commitDrag = useCallback(() => {
    endEditSession();
    resetDragUi();
  }, [endEditSession, resetDragUi]);

  const cancelDrag = useCallback(() => {
    cancelEditSession();
    resetDragUi();
  }, [cancelEditSession, resetDragUi]);

  const captureDragPointer = useCallback((event: ThreeEvent<PointerEvent>) => {
    dragPointerIdRef.current = event.pointerId;
    dragPointerTargetRef.current = event.target;
    if (event.target instanceof Element) {
      event.target.setPointerCapture?.(event.pointerId);
    }
  }, []);

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const snapEnabled = !event.altKey;
      if (dragState.kind === "move-axis") {
        const pointerDelta = new THREE.Vector2(
          event.clientX - dragState.startClientX,
          event.clientY - dragState.startClientY
        );
        const axisDelta =
          pointerDelta.dot(dragState.screenAxisDirection) / dragState.pixelsPerUnit;
        const resolvedAxisDelta = snapEnabled
          ? snapScalar(axisDelta, WORLD_OBJECT_EDIT_PARAMS.moveSnapStepM)
          : axisDelta;
        const nextPosition = dragState.startPosition.clone().addScaledVector(
          dragState.axisVector,
          resolvedAxisDelta
        );
        updateObjectPosition(objectIdRef.current, nextPosition);
        setDragPreview({
          startWorld: dragState.startPosition,
          currentWorld: nextPosition,
          label: formatAxisCoordinate(dragState.axis, nextPosition[dragState.axis]),
          snapEnabled,
        });
        return;
      }
      const nextPoint = intersectPointerWithPlane(event, dragState.plane);
      if (!nextPoint) {
        return;
      }
      if (dragState.kind === "resize-face") {
        const worldDelta = nextPoint.sub(dragState.startPoint);
        const localDelta = worldDelta.applyQuaternion(
          inverseObjectQuaternionRef.current
        );
        const resized = resolveCubeResizeFromDraggedFace({
          position: new THREE.Vector3(0, 0, 0),
          size: dragState.startSize,
          axis: dragState.axis,
          direction: dragState.direction,
          axisDelta: snapEnabled
            ? snapScalar(
                localDelta[dragState.axis] * dragState.direction,
                WORLD_OBJECT_EDIT_PARAMS.resizeSnapStepM
              )
            : localDelta[dragState.axis] * dragState.direction,
        });
        const nextPosition = dragState.startPosition
          .clone()
          .add(
            resized.position
              .clone()
              .applyQuaternion(objectQuaternionRef.current)
          );
        updateObjectPosition(objectIdRef.current, nextPosition);
        updateObjectSize(objectIdRef.current, resized.size);
        setDragPreview({
          startWorld: resolveWorldCubeFaceHandlePosition({
            center: dragState.startPosition,
            size: dragState.startSize,
            rotation: objectQuaternionRef.current,
            axis: dragState.axis,
            direction: dragState.direction,
          }),
          currentWorld: resolveWorldCubeFaceHandlePosition({
            center: nextPosition,
            size: resized.size,
            rotation: objectQuaternionRef.current,
            axis: dragState.axis,
            direction: dragState.direction,
          }),
          label: snapEnabled
            ? `${dragState.axis.toUpperCase()} • ${WORLD_OBJECT_EDIT_PARAMS.resizeSnapStepM.toFixed(2)}m`
            : `${dragState.axis.toUpperCase()} • free`,
          measurement: formatAxisMeasurement(
            dragState.axis,
            resized.size[dragState.axis] - dragState.startSize[dragState.axis]
          ),
          snapEnabled,
        });
        return;
      }
      if (dragState.kind === "resize-uniform") {
        const objectCenter = objectPositionRef.current;
        const nextRadius = nextPoint.distanceTo(objectCenter);
        const resolvedDelta = snapEnabled
          ? snapScalar(
              (nextRadius - dragState.startRadius) * 2,
              WORLD_OBJECT_EDIT_PARAMS.resizeSnapStepM
            )
          : (nextRadius - dragState.startRadius) * 2;
        const resized = resolveCubeUniformResize({
          position: objectCenter,
          size: dragState.startSize,
          sizeDelta: resolvedDelta,
        });
        updateObjectSize(objectIdRef.current, resized.size);
        setDragPreview({
          startWorld: objectCenter,
          currentWorld: nextPoint,
          label: snapEnabled
            ? `XYZ • ${WORLD_OBJECT_EDIT_PARAMS.resizeSnapStepM.toFixed(2)}m`
            : "XYZ • free",
          measurement: formatVectorMeasurement(
            resized.size.clone().sub(dragState.startSize),
            ["x", "y", "z"]
          ),
          snapEnabled,
        });
        return;
      }
      if (dragState.kind === "rotate-axis") {
        const nextAngleRad = resolveAxisPlaneAngleRad({
          point: nextPoint,
          center: objectPositionRef.current,
          axisVector: dragState.axisVector,
        });
        const rawDeltaRad = normalizeAngleDeltaRad(
          nextAngleRad - dragState.startAngleRad
        );
        const resolvedDeltaRad = snapEnabled
          ? snapScalar(rawDeltaRad, WORLD_OBJECT_EDIT_PARAMS.rotateSnapStepRad)
          : rawDeltaRad;
        const nextRotation = dragState.startRotation.clone();
        nextRotation[dragState.axis] += resolvedDeltaRad;
        updateObjectRotation(objectIdRef.current, nextRotation);
        setDragPreview({
          startWorld: objectPositionRef.current,
          currentWorld: nextPoint,
          label: formatDegrees(resolvedDeltaRad),
          snapEnabled,
        });
        return;
      }
      const draggedCorner = dragState.initialDraggedCorner
        .clone()
        .add(
          nextPoint
            .sub(dragState.startPoint)
            .applyQuaternion(inverseObjectQuaternionRef.current)
        );
      const resized = resolveCubeResizeFromDraggedCorner({
        anchorCorner: dragState.anchorCorner,
        draggedCorner: snapVector3(
          draggedCorner,
          WORLD_OBJECT_EDIT_PARAMS.resizeSnapStepM,
          snapEnabled
        ),
        handleSign: dragState.handleSign,
      });
      const nextPosition = dragState.startPosition
        .clone()
        .add(
          resized.position
            .clone()
            .applyQuaternion(objectQuaternionRef.current)
        );
      updateObjectPosition(objectIdRef.current, nextPosition);
      updateObjectSize(objectIdRef.current, resized.size);
      setDragPreview({
        startWorld: dragState.initialDraggedCornerWorld,
        currentWorld: resolveWorldCubeCornerPosition({
          center: nextPosition,
          size: resized.size,
          rotation: objectQuaternionRef.current,
          sign: dragState.handleSign,
        }),
        label: snapEnabled
          ? `Corner • ${WORLD_OBJECT_EDIT_PARAMS.resizeSnapStepM.toFixed(2)}m`
          : "Corner • free",
        measurement: formatVectorMeasurement(
          resized.size.clone().sub(dragState.startSize),
          ["x", "y", "z"]
        ),
        snapEnabled,
      });
    };

    const handleWindowPointerEnd = () => {
      commitDrag();
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragStateRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      cancelDrag();
    };
  }, [
    cancelDrag,
    commitDrag,
    intersectPointerWithPlane,
    updateObjectPosition,
    updateObjectRotation,
    updateObjectSize,
  ]);

  const handleMoveStart = useCallback(
    (
      event: ThreeEvent<PointerEvent>,
      axis: "x" | "y" | "z",
      axisVector: THREE.Vector3
    ) => {
      event.stopPropagation();
      beginEditSession();
      captureDragPointer(event);
      gl.domElement.style.cursor = "grabbing";
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const axisScreenVector = resolveWorldToScreenPoint(
        object.position.clone().add(axisVector),
        camera,
        rect.width,
        rect.height
      ).sub(
        resolveWorldToScreenPoint(
          object.position,
          camera,
          rect.width,
          rect.height
        )
      );
      if (axisScreenVector.lengthSq() <= Number.EPSILON) {
        return;
      }
      const pixelsPerUnit = Math.max(axisScreenVector.length(), 1);
      const screenAxisDirection = axisScreenVector.normalize();
      setDragPreview(null);
      setActiveHandleId(`move-${axis}`);
      onDragStateChange?.(true);
      dragStateRef.current = {
        kind: "move-axis",
        startPosition: object.position.clone(),
        axis,
        axisVector: axisVector.clone(),
        screenAxisDirection,
        pixelsPerUnit,
        startClientX: event.clientX,
        startClientY: event.clientY,
      };
    },
    [beginEditSession, camera, captureDragPointer, gl, object.position, onDragStateChange]
  );

  const handleFaceResizeStart = useCallback(
    (
      event: ThreeEvent<PointerEvent>,
      axis: "x" | "y" | "z",
      direction: -1 | 1
    ) => {
      event.stopPropagation();
      beginEditSession();
      captureDragPointer(event);
      gl.domElement.style.cursor = axis === "z" ? "ns-resize" : "ew-resize";
      setDragPreview(null);
      setActiveHandleId(`face-${axis}-${direction}`);
      onDragStateChange?.(true);
      dragStateRef.current = {
        kind: "resize-face",
        plane: buildScreenPlane(camera, event.point),
        startPoint: event.point.clone(),
        startPosition: object.position.clone(),
        startSize: object.size.clone(),
        axis,
        direction,
      };
    },
    [
      beginEditSession,
      camera,
      captureDragPointer,
      gl,
      object.position,
      object.size,
      onDragStateChange,
    ]
  );

  const handleResizeStart = useCallback(
    (event: ThreeEvent<PointerEvent>, handleSign: THREE.Vector3) => {
      event.stopPropagation();
      beginEditSession();
      captureDragPointer(event);
      gl.domElement.style.cursor = "nwse-resize";
      const initialDraggedCorner = resolveCubeCornerOffset(object.size, handleSign);
      const initialDraggedCornerWorld = resolveWorldCubeCornerPosition({
        center: object.position,
        size: object.size,
        rotation: objectQuaternion,
        sign: handleSign,
      });
      setDragPreview(null);
      setActiveHandleId(
        `corner-${handleSign.x}-${handleSign.y}-${handleSign.z}`
      );
      onDragStateChange?.(true);
      dragStateRef.current = {
        kind: "resize",
        plane: buildScreenPlane(camera, initialDraggedCornerWorld),
        startPoint: event.point.clone(),
        startPosition: object.position.clone(),
        startSize: object.size.clone(),
        initialDraggedCorner,
        initialDraggedCornerWorld,
        anchorCorner: resolveCubeCornerOffset(
          object.size,
          handleSign.clone().multiplyScalar(-1)
        ),
        handleSign: handleSign.clone(),
      };
    },
    [
      beginEditSession,
      camera,
      captureDragPointer,
      gl,
      object.position,
      objectQuaternion,
      object.size,
      onDragStateChange,
    ]
  );

  const handleUniformResizeStart = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      beginEditSession();
      captureDragPointer(event);
      gl.domElement.style.cursor = "nwse-resize";
      setDragPreview(null);
      setActiveHandleId("resize-uniform");
      onDragStateChange?.(true);
      dragStateRef.current = {
        kind: "resize-uniform",
        plane: buildScreenPlane(camera, object.position),
        startPoint: event.point.clone(),
        startSize: object.size.clone(),
        startRadius: event.point.distanceTo(object.position),
      };
    },
    [
      beginEditSession,
      camera,
      captureDragPointer,
      gl,
      object.position,
      object.size,
      onDragStateChange,
    ]
  );

  const handleRotateStart = useCallback(
    (
      event: ThreeEvent<PointerEvent>,
      axis: "x" | "y" | "z",
      axisVector: THREE.Vector3
    ) => {
      event.stopPropagation();
      beginEditSession();
      captureDragPointer(event);
      gl.domElement.style.cursor = "grabbing";
      setDragPreview(null);
      setActiveHandleId(`rotate-${axis}`);
      onDragStateChange?.(true);
      dragStateRef.current = {
        kind: "rotate-axis",
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axisVector, object.position),
        startRotation: resolvedRotation.clone(),
        startAngleRad: resolveAxisPlaneAngleRad({
          point: event.point,
          center: object.position,
          axisVector,
        }),
        axis,
        axisVector: axisVector.clone(),
      };
    },
    [
      beginEditSession,
      captureDragPointer,
      gl,
      object.position,
      onDragStateChange,
      resolvedRotation,
    ]
  );

  return (
    <group>
      {dragPreview && (
        <>
          <Line
            points={[
              [dragPreview.startWorld.x, dragPreview.startWorld.y, dragPreview.startWorld.z],
              [dragPreview.currentWorld.x, dragPreview.currentWorld.y, dragPreview.currentWorld.z],
            ]}
            color={WORLD_OBJECT_EDIT_PARAMS.guideLineColor}
            transparent
            opacity={WORLD_OBJECT_EDIT_PARAMS.guideLineOpacity}
            lineWidth={1.5}
            renderOrder={965}
          />
          <mesh
            position={[
              dragPreview.startWorld.x,
              dragPreview.startWorld.y,
              dragPreview.startWorld.z,
            ]}
            raycast={() => null}
            renderOrder={966}
          >
            <sphereGeometry args={[WORLD_OBJECT_EDIT_PARAMS.resizeHandleRadiusM * 0.75, 12, 12]} />
            <meshBasicMaterial
              color={WORLD_OBJECT_EDIT_PARAMS.guideLineColor}
              transparent
              opacity={0.6}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <Html
            position={[
              dragPreview.currentWorld.x,
              dragPreview.currentWorld.y,
              dragPreview.currentWorld.z + WORLD_OBJECT_EDIT_PARAMS.guideHintOffsetM,
            ]}
            center
            style={{ pointerEvents: "none" }}
          >
            <div className="pointer-events-none flex flex-col items-center gap-1">
              <div className={OVERLAY_LABEL_CLASS}>
                {dragPreview.label}
              </div>
              {dragPreview.measurement ? (
                <div className={OVERLAY_META_CLASS}>
                  {dragPreview.measurement}
                </div>
              ) : null}
            </div>
          </Html>
        </>
      )}
      {statusHandleId && !dragPreview && mode !== "rotate" && (
        <Html
          position={[
            object.position.x,
            object.position.y,
            object.position.z + WORLD_OBJECT_EDIT_PARAMS.guideHintOffsetM,
          ]}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className={OVERLAY_LABEL_CLASS}>
            {mode} • {resolveHandleLabel(statusHandleId)}
          </div>
        </Html>
      )}
      {mode === "resize" && !statusHandleId && !dragPreview && (
        <Html
          position={[
            object.position.x,
            object.position.y,
            object.position.z + WORLD_OBJECT_EDIT_PARAMS.guideHintOffsetM,
          ]}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className="pointer-events-none flex flex-col items-center gap-1">
            <div className={OVERLAY_LABEL_CLASS}>resize</div>
            <div className={OVERLAY_META_CLASS}>Faces axis • Corners xyz • Center uniform</div>
          </div>
        </Html>
      )}
      {mode === "resize" && activeResizeFaceHandle && (
        <>
          <mesh
            position={[
              activeResizeFaceHandle.position.x,
              activeResizeFaceHandle.position.y,
              activeResizeFaceHandle.position.z,
            ]}
            raycast={() => null}
            renderOrder={962}
          >
            <boxGeometry
              args={resolveResizeFaceHighlightArgs(object.size, activeResizeFaceHandle.axis)}
            />
            <meshBasicMaterial
              color={WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[activeResizeFaceHandle.axis]}
              transparent
              opacity={WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightOpacity}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={[
              [
                activeResizeFaceHandle.position.x,
                activeResizeFaceHandle.position.y,
                activeResizeFaceHandle.position.z,
              ],
              [
                activeResizeFaceHandle.position.x +
                  AXIS_VECTORS[activeResizeFaceHandle.axis].x *
                    activeResizeFaceHandle.direction *
                    WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                activeResizeFaceHandle.position.y +
                  AXIS_VECTORS[activeResizeFaceHandle.axis].y *
                    activeResizeFaceHandle.direction *
                    WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                activeResizeFaceHandle.position.z +
                  AXIS_VECTORS[activeResizeFaceHandle.axis].z *
                    activeResizeFaceHandle.direction *
                    WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
              ],
            ]}
            color={WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[activeResizeFaceHandle.axis]}
            transparent
            opacity={WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueOpacity}
            lineWidth={WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLineWidth}
            renderOrder={966}
          />
        </>
      )}
      {mode === "resize" && activeResizeCornerHandle && (
        <>
          <mesh
            position={[
              object.position.x + activeResizeCornerHandle.sign.x * object.size.x * 0.25,
              object.position.y + activeResizeCornerHandle.sign.y * object.size.y * 0.25,
              object.position.z + activeResizeCornerHandle.sign.z * object.size.z * 0.25,
            ]}
            raycast={() => null}
            renderOrder={961}
          >
            <boxGeometry
              args={[object.size.x * 0.5, object.size.y * 0.5, object.size.z * 0.5]}
            />
            <meshBasicMaterial
              color={WORLD_OBJECT_EDIT_PARAMS.resizeHandleColor}
              transparent
              opacity={WORLD_OBJECT_EDIT_PARAMS.resizeCornerHighlightOpacity}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={[
              [
                activeResizeCornerHandle.position.x,
                activeResizeCornerHandle.position.y,
                activeResizeCornerHandle.position.z,
              ],
              [
                activeResizeCornerHandle.position.x +
                  activeResizeCornerHandle.sign.x *
                    WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                activeResizeCornerHandle.position.y +
                  activeResizeCornerHandle.sign.y *
                    WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                activeResizeCornerHandle.position.z +
                  activeResizeCornerHandle.sign.z *
                    WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
              ],
            ]}
            color={WORLD_OBJECT_EDIT_PARAMS.resizeHandleColor}
            transparent
            opacity={WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueOpacity}
            lineWidth={WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLineWidth}
            renderOrder={966}
          />
        </>
      )}
      {mode === "resize" && activeResizeUniformHandle && (
        <>
          <mesh
            position={[object.position.x, object.position.y, object.position.z]}
            raycast={() => null}
            renderOrder={960}
          >
            <boxGeometry args={[object.size.x, object.size.y, object.size.z]} />
            <meshBasicMaterial
              color={WORLD_OBJECT_EDIT_PARAMS.guideLineColor}
              transparent
              opacity={WORLD_OBJECT_EDIT_PARAMS.resizeUniformHighlightOpacity}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          {(["x", "y", "z"] as const).map((axis) => (
            <Line
              key={`uniform-cue-${axis}`}
              points={[
                [object.position.x, object.position.y, object.position.z],
                [
                  object.position.x +
                    AXIS_VECTORS[axis].x *
                      WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                  object.position.y +
                    AXIS_VECTORS[axis].y *
                      WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                  object.position.z +
                    AXIS_VECTORS[axis].z *
                      WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLengthM,
                ],
              ]}
              color={WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[axis]}
              transparent
              opacity={WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueOpacity}
              lineWidth={WORLD_OBJECT_EDIT_PARAMS.resizeDirectionCueLineWidth}
              renderOrder={966}
            />
          ))}
        </>
      )}
      {mode === "move" && (
        <>
          <group position={[object.position.x, object.position.y, object.position.z]}>
            <mesh raycast={() => null} renderOrder={967}>
              <sphereGeometry args={[WORLD_OBJECT_EDIT_PARAMS.moveCenterHubRadiusM, 18, 18]} />
              <meshBasicMaterial
                color={WORLD_OBJECT_EDIT_PARAMS.guideLineColor}
                transparent
                opacity={WORLD_OBJECT_EDIT_PARAMS.moveCenterHubOpacity}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          </group>
          {moveAxisHandles.map((handle, index) => {
            if (!visibleMoveAxes.has(handle.axis)) {
              return null;
            }
            const handleId = `move-${handle.axis}`;
            const axisColor = WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[handle.axis];
            const emphasized =
              activeHandleId === handleId || hoveredHandleId === handleId;
            const handleOpacity = resolveHandleOpacity({
              activeHandleId,
              hoveredHandleId,
              handleId,
            });
            return (
              <group key={handle.id}>
                <Line
                  points={[
                    [object.position.x, object.position.y, object.position.z],
                    handle.position,
                  ]}
                  color={axisColor}
                  transparent
                  opacity={
                    emphasized
                      ? 1
                      : activeHandleId || hoveredHandleId
                        ? WORLD_OBJECT_EDIT_PARAMS.inactiveLineOpacity
                        : WORLD_OBJECT_EDIT_PARAMS.moveAxisLineOpacity
                  }
                  lineWidth={emphasized ? 2.8 : 2}
                  renderOrder={964}
                />
                <group
                  position={handle.position}
                  ref={(node) => {
                    moveAxisGroupRefs.current[index] = node;
                  }}
                >
                  <mesh
                    onPointerDown={(event) =>
                      handleMoveStart(event, handle.axis, handle.vector)
                    }
                    onPointerOver={(event) => {
                      event.stopPropagation();
                      setHoveredHandleId(handleId);
                      gl.domElement.style.cursor = "grab";
                    }}
                    onPointerOut={(event) => {
                      event.stopPropagation();
                      setHoveredHandleId((current) => (current === handleId ? null : current));
                      if (!dragStateRef.current) {
                        gl.domElement.style.cursor = "";
                      }
                    }}
                  >
                    <sphereGeometry
                      args={[WORLD_OBJECT_EDIT_PARAMS.moveHandleHitRadiusM, 16, 16]}
                    />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                  <mesh raycast={() => null}>
                    <sphereGeometry args={[WORLD_OBJECT_EDIT_PARAMS.moveHandleRadiusM, 18, 18]} />
                    <meshBasicMaterial
                      color={axisColor}
                      transparent
                      opacity={resolveHandleMaterialOpacity({
                        activeHandleId,
                        hoveredHandleId,
                        handleId,
                      })}
                      depthTest={false}
                      depthWrite={false}
                    />
                  </mesh>
                  {(activeHandleId === handleId || hoveredHandleId === handleId) && (
                    <Html
                      position={[
                        0,
                        0,
                        WORLD_OBJECT_EDIT_PARAMS.handleLabelOffsetM,
                      ]}
                      center
                      style={{ pointerEvents: "none" }}
                    >
                      <div className={OVERLAY_LABEL_CLASS}>
                        {handle.axis}
                      </div>
                    </Html>
                  )}
                </group>
              </group>
            );
          })}
        </>
      )}
      {mode === "rotate" && (
        <group position={[object.position.x, object.position.y, object.position.z]}>
          {ROTATE_AXES.map((handle, index) => {
            const handleId = `rotate-${handle.axis}`;
            return (
              <group
                key={handleId}
                rotation={handle.rotation}
                ref={(node) => {
                  rotateGroupRefs.current[index] = node;
                }}
              >
                <mesh
                  onPointerDown={(event) =>
                    handleRotateStart(event, handle.axis, handle.vector)
                  }
                  onPointerOver={(event) => {
                    event.stopPropagation();
                    setHoveredHandleId(handleId);
                    gl.domElement.style.cursor = "grab";
                  }}
                  onPointerOut={(event) => {
                    event.stopPropagation();
                    setHoveredHandleId((current) => (current === handleId ? null : current));
                    if (!dragStateRef.current) {
                      gl.domElement.style.cursor = "";
                    }
                  }}
                >
                  <torusGeometry
                    args={[
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingRadiusM,
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingHitTubeRadiusM,
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingSegments,
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingSegments,
                    ]}
                  />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
                <mesh raycast={() => null} renderOrder={964}>
                  <torusGeometry
                    args={[
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingRadiusM,
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingTubeRadiusM,
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingSegments,
                      WORLD_OBJECT_EDIT_PARAMS.rotateRingSegments,
                    ]}
                  />
                  <meshBasicMaterial
                    color={WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[handle.axis]}
                    transparent
                    opacity={resolveHandleMaterialOpacity({
                      activeHandleId,
                      hoveredHandleId,
                      handleId,
                      baseOpacity: WORLD_OBJECT_EDIT_PARAMS.rotateRingOpacity,
                    })}
                    depthTest={false}
                    depthWrite={false}
                  />
                </mesh>
              </group>
            );
          })}
        </group>
      )}
      {mode === "resize" &&
        faceHandles.map((handle) => {
          const handleId = `face-${handle.axis}-${handle.direction}`;
          if (!visibleResizeFaces.has(handleId)) {
            return null;
          }
          const emphasized =
            activeHandleId === handleId || hoveredHandleId === handleId;
          return (
            <Line
              key={`face-line-${handle.id}`}
              points={[
                [object.position.x, object.position.y, object.position.z],
                [handle.position.x, handle.position.y, handle.position.z],
              ]}
              color={WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[handle.axis]}
              transparent
              opacity={
                emphasized
                  ? 1
                  : activeHandleId || hoveredHandleId
                    ? WORLD_OBJECT_EDIT_PARAMS.inactiveLineOpacity
                    : WORLD_OBJECT_EDIT_PARAMS.resizeFaceLineOpacity
              }
              lineWidth={emphasized ? 2.4 : 1.6}
              renderOrder={964}
            />
          );
        })}
      {mode === "resize" &&
        cornerHandles.map((handle) => {
          const handleId = `corner-${handle.sign.x}-${handle.sign.y}-${handle.sign.z}`;
          const emphasized =
            activeHandleId === handleId || hoveredHandleId === handleId;
          return (
            <Line
              key={`corner-line-${handle.id}`}
              points={[
                [object.position.x, object.position.y, object.position.z],
                [handle.position.x, handle.position.y, handle.position.z],
              ]}
              color={WORLD_OBJECT_EDIT_PARAMS.resizeHandleColor}
              transparent
              opacity={
                emphasized
                  ? 0.9
                  : activeHandleId || hoveredHandleId
                    ? WORLD_OBJECT_EDIT_PARAMS.inactiveLineOpacity
                    : WORLD_OBJECT_EDIT_PARAMS.resizeCornerLineOpacity
              }
              lineWidth={emphasized ? 2 : 1.2}
              renderOrder={963}
            />
          );
        })}
      {mode === "resize" && (
        <group
          position={[object.position.x, object.position.y, object.position.z]}
          ref={resizeUniformGroupRef}
        >
          <mesh
            onPointerDown={handleUniformResizeStart}
            onPointerOver={(event) => {
              event.stopPropagation();
              setHoveredHandleId("resize-uniform");
              gl.domElement.style.cursor = "nwse-resize";
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              setHoveredHandleId((current) =>
                current === "resize-uniform" ? null : current
              );
              if (!dragStateRef.current) {
                gl.domElement.style.cursor = "";
              }
            }}
          >
            <boxGeometry
              args={[
                WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.4,
                WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.4,
                WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.4,
              ]}
            />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh raycast={() => null}>
            <boxGeometry
              args={[
                WORLD_OBJECT_EDIT_PARAMS.resizeUniformGripSizeM,
                WORLD_OBJECT_EDIT_PARAMS.resizeUniformGripSizeM,
                WORLD_OBJECT_EDIT_PARAMS.resizeUniformGripSizeM,
              ]}
            />
            <meshBasicMaterial
              color={WORLD_OBJECT_EDIT_PARAMS.guideLineColor}
              transparent
              opacity={resolveHandleMaterialOpacity({
                activeHandleId,
                hoveredHandleId,
                handleId: "resize-uniform",
                baseOpacity: WORLD_OBJECT_EDIT_PARAMS.resizeUniformGripOpacity,
              })}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          {(activeHandleId === "resize-uniform" || hoveredHandleId === "resize-uniform") && (
            <Html
              position={[0, 0, WORLD_OBJECT_EDIT_PARAMS.handleLabelOffsetM]}
              center
              style={{ pointerEvents: "none" }}
            >
              <div className={OVERLAY_LABEL_CLASS}>XYZ</div>
            </Html>
          )}
        </group>
      )}
      {mode === "resize" &&
        faceHandles.map((handle, index) => {
          const handleId = `face-${handle.axis}-${handle.direction}`;
          if (!visibleResizeFaces.has(handleId)) {
            return null;
          }
          const handleOpacity = resolveHandleOpacity({
            activeHandleId,
            hoveredHandleId,
            handleId,
          });
          return (
            <group
              key={handle.id}
              position={[handle.position.x, handle.position.y, handle.position.z]}
              ref={(node) => {
                resizeFaceGroupRefs.current[index] = node;
              }}
            >
              <mesh
                onPointerDown={(event) =>
                  handleFaceResizeStart(event, handle.axis, handle.direction)
                }
                onPointerOver={(event) => {
                  event.stopPropagation();
                  setHoveredHandleId(handleId);
                  gl.domElement.style.cursor =
                    handle.axis === "z" ? "ns-resize" : "ew-resize";
                }}
                onPointerOut={(event) => {
                  event.stopPropagation();
                  setHoveredHandleId((current) => (current === handleId ? null : current));
                  if (!dragStateRef.current) {
                    gl.domElement.style.cursor = "";
                  }
                }}
              >
                <boxGeometry
                  args={[
                    WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.5,
                    WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.5,
                    WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.5,
                  ]}
                />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              <mesh raycast={() => null}>
                <boxGeometry
                  args={[
                    RESIZE_FACE_BOX_ARGS[handle.axis][0],
                    RESIZE_FACE_BOX_ARGS[handle.axis][1],
                    RESIZE_FACE_BOX_ARGS[handle.axis][2],
                  ]}
                />
                <meshBasicMaterial
                  color={WORLD_OBJECT_EDIT_PARAMS.axisHandleColors[handle.axis]}
                  transparent
                  opacity={resolveHandleMaterialOpacity({
                    activeHandleId,
                    hoveredHandleId,
                    handleId,
                  })}
                  depthTest={false}
                  depthWrite={false}
                />
              </mesh>
              {(activeHandleId === handleId || hoveredHandleId === handleId) && (
                <Html
                  position={[
                    0,
                    0,
                    WORLD_OBJECT_EDIT_PARAMS.handleLabelOffsetM,
                  ]}
                  center
                  style={{ pointerEvents: "none" }}
                >
                  <div className={OVERLAY_LABEL_CLASS}>
                    {handle.axis}
                    {handle.direction === 1 ? "+" : "-"}
                  </div>
                </Html>
              )}
            </group>
          );
        })}
      {mode === "resize" &&
        cornerHandles.map((handle, index) => {
          const handleId = `corner-${handle.sign.x}-${handle.sign.y}-${handle.sign.z}`;
          const handleOpacity = resolveHandleOpacity({
            activeHandleId,
            hoveredHandleId,
            handleId,
          });
          return (
            <group
              key={handle.id}
              position={[handle.position.x, handle.position.y, handle.position.z]}
              ref={(node) => {
                resizeCornerGroupRefs.current[index] = node;
              }}
            >
              <mesh
                onPointerDown={(event) => handleResizeStart(event, handle.sign)}
                onPointerOver={(event) => {
                  event.stopPropagation();
                  setHoveredHandleId(handleId);
                  gl.domElement.style.cursor = "nwse-resize";
                }}
                onPointerOut={(event) => {
                  event.stopPropagation();
                  setHoveredHandleId((current) => (current === handleId ? null : current));
                  if (!dragStateRef.current) {
                    gl.domElement.style.cursor = "";
                  }
                }}
              >
                <boxGeometry
                  args={[
                    WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.3,
                    WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.3,
                    WORLD_OBJECT_EDIT_PARAMS.resizeHandleHitRadiusM * 1.3,
                  ]}
                />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              <mesh
                raycast={() => null}
                rotation={[Math.PI * 0.25, Math.PI * 0.25, 0]}
              >
                <boxGeometry
                  args={[
                    WORLD_OBJECT_EDIT_PARAMS.resizeCornerGripSizeM,
                    WORLD_OBJECT_EDIT_PARAMS.resizeCornerGripSizeM,
                    WORLD_OBJECT_EDIT_PARAMS.resizeCornerGripSizeM,
                  ]}
                />
                <meshBasicMaterial
                  color={WORLD_OBJECT_EDIT_PARAMS.resizeHandleColor}
                  transparent
                  opacity={resolveHandleMaterialOpacity({
                    activeHandleId,
                    hoveredHandleId,
                    handleId,
                  })}
                  depthTest={false}
                  depthWrite={false}
                />
              </mesh>
              {(activeHandleId === handleId || hoveredHandleId === handleId) && (
                <Html
                  position={[
                    0,
                    0,
                    WORLD_OBJECT_EDIT_PARAMS.handleLabelOffsetM,
                  ]}
                  center
                  style={{ pointerEvents: "none" }}
                >
                  <div className={OVERLAY_LABEL_CLASS}>
                    XYZ
                  </div>
                </Html>
              )}
            </group>
          );
        })}
    </group>
  );
};
