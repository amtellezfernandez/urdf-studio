import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import { useObjectStore, type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";
import { MeshAssetBody } from "@/features/viewer/components/MeshAssetBody";
import { SplatAssetBody } from "@/features/viewer/components/SplatAssetBody";
import { OrbitVisualization } from "@/features/viewer/components/OrbitVisualization";
import { WorldObjectEditHandles } from "@/features/viewer/components/WorldObjectEditHandles";
import { TrackingLine } from "@/features/viewer/TrackingLine";
import { resolveEndEffectorContactObjectId } from "@/features/viewer/eeObjectContact";
import {
  shouldMoveToObjectOnSingleClick,
  shouldMoveToObjectOnRepeatedClick,
  shouldToggleObjectSelectionOnSingleClick,
} from "@/features/viewer/objectTargetClickPolicy";

type CreatedObjectsProps = {
  allowRetargetOnClick?: boolean;
  editable?: boolean;
  enableObjectActionsInReadOnly?: boolean;
  endEffectorLink?: string | null;
  gpuMode?: GPUMode;
  onEditDragStateChange?: (dragging: boolean) => void;
  onIkTargetClick?: (object: CreatedObject) => void;
  onObjectSelect?: (objectId: string, object?: CreatedObject) => void;
  orbitDefaults: {
    radius: number;
    inclinationDeg: number;
    phaseDeg: number;
    secondaryOffsetDeg: number;
  };
  robot: URDFRobot | null;
};

type ObjectPointerHandlers = {
  onClick: (event: ThreeEvent<MouseEvent>, objectId: string) => void;
  onDoubleClick: (objectId: string) => void;
  onPointerEnter: (event: ThreeEvent<PointerEvent>, objectId: string) => void;
  onPointerLeave: (event: ThreeEvent<PointerEvent>) => void;
};

type CreatedObjectBodyProps = ObjectPointerHandlers & {
  edgeColor: string;
  isEmphasized: boolean;
  object: CreatedObject;
  objectRotation: [number, number, number];
  pointDisplayRadiusM: number;
  targetTint: string;
};

function CreatedObjectBody({
  edgeColor,
  isEmphasized,
  object,
  objectRotation,
  onClick,
  onDoubleClick,
  onPointerEnter,
  onPointerLeave,
  pointDisplayRadiusM,
  targetTint,
}: CreatedObjectBodyProps) {
  const objectPosition: [number, number, number] = [
    object.position.x,
    object.position.y,
    object.position.z,
  ];
  const pointerHandlers = {
    onClick: (event: ThreeEvent<MouseEvent>) => onClick(event, object.id),
    onDoubleClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onDoubleClick(object.id);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerEnter(event, object.id),
    onPointerMove: (event: ThreeEvent<PointerEvent>) => onPointerEnter(event, object.id),
    onPointerOut: onPointerLeave,
  };

  if (object.type === "point") {
    return (
      <>
        <mesh position={objectPosition} {...pointerHandlers}>
          <sphereGeometry args={[pointDisplayRadiusM, 18, 12]} />
          <meshStandardMaterial
            color={targetTint}
            transparent={true}
            opacity={isEmphasized ? 0.98 : 0.85}
            emissive={isEmphasized ? edgeColor : "#000000"}
            emissiveIntensity={isEmphasized ? 0.52 : 0}
            metalness={0.1}
            roughness={0.5}
          />
        </mesh>
        <lineSegments position={objectPosition}>
          <edgesGeometry args={[new THREE.SphereGeometry(pointDisplayRadiusM, 12, 8)]} />
          <lineBasicMaterial
            color={isEmphasized ? edgeColor : "#aaaaaa"}
            linewidth={2}
          />
        </lineSegments>
      </>
    );
  }

  const primitiveFallback = (
    <mesh position={objectPosition} rotation={objectRotation} {...pointerHandlers}>
      {object.type === "sphere" ? (
        <sphereGeometry args={[object.size.x * 0.5, 24, 18]} />
      ) : object.type === "cylinder" ? (
        <cylinderGeometry
          args={[object.size.x * 0.5, object.size.y * 0.5, object.size.z, 24]}
        />
      ) : (
        <boxGeometry args={[object.size.x, object.size.y, object.size.z]} />
      )}
      <meshStandardMaterial
        color={targetTint}
        transparent={true}
        opacity={isEmphasized ? 0.88 : 0.6}
        emissive={isEmphasized ? edgeColor : "#000000"}
        emissiveIntensity={isEmphasized ? 0.42 : 0}
      />
    </mesh>
  );

  if (object.type === "mesh") {
    return (
      <MeshAssetBody
        object={object}
        objectPosition={objectPosition}
        objectRotation={objectRotation}
        pointerHandlers={pointerHandlers}
        fallback={primitiveFallback}
      />
    );
  }

  if (object.type === "splat") {
    return (
      <SplatAssetBody
        object={object}
        objectPosition={objectPosition}
        objectRotation={objectRotation}
        pointerHandlers={pointerHandlers}
        fallback={primitiveFallback}
      />
    );
  }

  return primitiveFallback;
}

export const CreatedObjects = ({
  robot,
  gpuMode = "high",
  endEffectorLink = null,
  onIkTargetClick,
  onObjectSelect,
  orbitDefaults,
  editable = true,
  enableObjectActionsInReadOnly = false,
  onEditDragStateChange,
  allowRetargetOnClick = false,
}: CreatedObjectsProps) => {
  const objects = useObjectStore((state) => state.objects);
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const objectEditMode = useObjectStore((state) => state.editMode);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);
  const updateOrbitTargetPoint = useObjectStore((state) => state.updateOrbitTargetPoint);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [contactObjectId, setContactObjectId] = useState<string | null>(null);
  const gl = useThree((state) => state.gl);
  const resolveLinkObject = useMemo(() => createLinkObjectResolver(robot), [robot]);
  const endEffectorBoundsBoxRef = useRef(new THREE.Box3());
  const endEffectorSphereRef = useRef(new THREE.Sphere());
  const lastObjectClickRef = useRef<{
    objectId: string;
    timeMs: number;
  } | null>(null);

  useFrame(() => {
    if (!robot || !endEffectorLink) {
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }
    const endEffectorObject = resolveLinkObject(endEffectorLink);
    if (!endEffectorObject) {
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }

    endEffectorObject.updateMatrixWorld(true);
    endEffectorBoundsBoxRef.current.makeEmpty();
    endEffectorBoundsBoxRef.current.setFromObject(endEffectorObject);
    if (endEffectorBoundsBoxRef.current.isEmpty()) {
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }

    endEffectorBoundsBoxRef.current.getBoundingSphere(endEffectorSphereRef.current);
    const nextContactObjectId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: endEffectorSphereRef.current,
      objects,
    });
    setContactObjectId((previous) =>
      previous === nextContactObjectId ? previous : nextContactObjectId
    );
  });

  useEffect(() => {
    const canvas = gl.domElement;
    if (!canvas) return;
    canvas.style.cursor = hoveredObjectId ? "pointer" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [gl, hoveredObjectId]);

  const handleObjectSelection = useCallback(
    (
      objectId: string,
      orbitTargetPoint?: "primary" | "secondary",
      options?: { toggle?: boolean }
    ) => {
      const shouldToggleSelection = options?.toggle !== false;
      if (shouldToggleSelection && selectedObjectId === objectId) {
        setSelectedObject(null);
        return;
      }
      const targetObject = objects.find((object) => object.id === objectId);
      setSelectedObject(objectId);
      if (!targetObject) {
        return;
      }
      if (orbitTargetPoint) {
        updateOrbitTargetPoint(objectId, orbitTargetPoint);
      } else if (targetObject.ikTargetType === "orbit") {
        updateOrbitTargetPoint(objectId, "primary");
      }
      onObjectSelect?.(objectId, targetObject);
    },
    [
      objects,
      onObjectSelect,
      selectedObjectId,
      setSelectedObject,
      updateOrbitTargetPoint,
    ]
  );

  const handleObjectMoveRequest = useCallback(
    (objectId: string, orbitTargetPoint?: "primary" | "secondary") => {
      lastObjectClickRef.current = null;
      handleObjectSelection(objectId, orbitTargetPoint, { toggle: false });
      const lockedTargetObject =
        useObjectStore.getState().objects.find((object) => object.id === objectId) ?? null;
      if (!lockedTargetObject) {
        return;
      }
      onIkTargetClick?.(lockedTargetObject);
    },
    [handleObjectSelection, onIkTargetClick]
  );

  const handleObjectClick = useCallback(
    (e: ThreeEvent<MouseEvent>, objectId: string) => {
      e.stopPropagation();
      const hasIkTargetClickHandler = Boolean(onIkTargetClick);
      const clickTimeMs =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const previousClick = lastObjectClickRef.current;
      if (
        shouldMoveToObjectOnRepeatedClick({
          hasIkTargetClickHandler,
          selectedObjectId,
          clickedObjectId: objectId,
          clickDetail: e.detail,
          previousClickedObjectId: previousClick?.objectId ?? null,
          previousClickTimeMs: previousClick?.timeMs ?? null,
          clickTimeMs,
        })
      ) {
        lastObjectClickRef.current = null;
        handleObjectMoveRequest(objectId);
        return;
      }
      const canAutoMoveToObject = shouldMoveToObjectOnSingleClick({
        hasIkTargetClickHandler,
        editable,
        enableObjectActionsInReadOnly,
        allowRetargetOnClick,
      });
      if (canAutoMoveToObject) {
        lastObjectClickRef.current = null;
        handleObjectMoveRequest(objectId);
        return;
      }
      lastObjectClickRef.current = {
        objectId,
        timeMs: clickTimeMs,
      };
      handleObjectSelection(objectId, undefined, {
        toggle: shouldToggleObjectSelectionOnSingleClick({
          hasIkTargetClickHandler,
          selectedObjectId,
          clickedObjectId: objectId,
        }),
      });
    },
    [
      allowRetargetOnClick,
      editable,
      enableObjectActionsInReadOnly,
      handleObjectMoveRequest,
      handleObjectSelection,
      onIkTargetClick,
      selectedObjectId,
    ]
  );

  const handlePointerEnter = useCallback(
    (e: ThreeEvent<PointerEvent>, objectId: string) => {
      e.stopPropagation();
      setHoveredObjectId(objectId);
    },
    []
  );

  const handlePointerLeave = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHoveredObjectId(null);
    },
    []
  );

  return (
    <group>
      {objects
        .filter((createdObject) => createdObject.isHidden !== true)
        .map((createdObject) => {
          const isSelected = selectedObjectId === createdObject.id;
          const isHovered = hoveredObjectId === createdObject.id;
          const isContacted = contactObjectId === createdObject.id;
          const isEmphasized = isSelected || isHovered || isContacted;
          const baseColor = createdObject.color || "#3b82f6";
          const targetTint = isContacted ? "#f8fafc" : baseColor;
          const hoverEdgeColor = "#67e8f9";
          const contactEdgeColor = "#f8fafc";
          const edgeColor = isContacted ? contactEdgeColor : hoverEdgeColor;
          const maximumObjectDimensionMeters = Math.max(
            createdObject.size.x,
            createdObject.size.y,
            createdObject.size.z
          );
          const rotationEuler = normalizeWorldObjectRotationEuler(createdObject.rotation);
          const objectRotation: [number, number, number] = [
            rotationEuler.x,
            rotationEuler.y,
            rotationEuler.z,
          ];
          const comRadius = Math.min(
            0.028,
            Math.max(0.007, maximumObjectDimensionMeters * 0.08)
          );
          const pointDisplayRadiusM = WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM * 0.5;
          const comAxisHalfLength = comRadius * 2.8;
          const comCrossPositions = new Float32Array([
            -comAxisHalfLength, 0, 0,
            comAxisHalfLength, 0, 0,
            0, -comAxisHalfLength, 0,
            0, comAxisHalfLength, 0,
            0, 0, -comAxisHalfLength,
            0, 0, comAxisHalfLength,
          ]);

          return (
            <group key={createdObject.id}>
              {editable && isSelected && (
                <WorldObjectEditHandles
                  object={createdObject}
                  mode={objectEditMode}
                  onDragStateChange={onEditDragStateChange}
                />
              )}
              <CreatedObjectBody
                object={createdObject}
                objectRotation={objectRotation}
                targetTint={targetTint}
                edgeColor={edgeColor}
                isEmphasized={isEmphasized}
                pointDisplayRadiusM={pointDisplayRadiusM}
                onClick={handleObjectClick}
                onDoubleClick={handleObjectMoveRequest}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
              />

              <group
                position={[
                  createdObject.position.x,
                  createdObject.position.y,
                  createdObject.position.z,
                ]}
              >
                <mesh raycast={() => null}>
                  <sphereGeometry args={[comRadius, 14, 10]} />
                  <meshBasicMaterial
                    color="#ff63d5"
                    transparent
                    opacity={isEmphasized ? 0.42 : 0.3}
                    depthWrite={false}
                  />
                </mesh>
                <lineSegments raycast={() => null} renderOrder={950}>
                  <bufferGeometry>
                    <bufferAttribute
                      attach="attributes-position"
                      count={6}
                      array={comCrossPositions}
                      itemSize={3}
                    />
                  </bufferGeometry>
                  <lineBasicMaterial
                    color="#ff63d5"
                    transparent
                    opacity={isEmphasized ? 0.5 : 0.34}
                    depthTest={false}
                    depthWrite={false}
                  />
                </lineSegments>
              </group>

              {robot &&
                endEffectorLink &&
                (createdObject.trackedJointName || endEffectorLink) && (
                  <TrackingLine
                    cubePos={createdObject.position}
                    robot={robot}
                    trackedJointName={createdObject.trackedJointName || null}
                    endEffectorLink={endEffectorLink}
                    gpuMode={gpuMode}
                  />
                )}

              {createdObject.ikTargetType === "orbit" && (
                <OrbitVisualization
                  centerPosition={createdObject.position}
                  radius={createdObject.orbitRadius ?? orbitDefaults.radius}
                  inclination={createdObject.orbitInclination ?? orbitDefaults.inclinationDeg}
                  phase={createdObject.orbitPhase ?? orbitDefaults.phaseDeg}
                  secondaryPhaseOffsetDeg={
                    createdObject.orbitSecondaryOffset ?? orbitDefaults.secondaryOffsetDeg
                  }
                  color={targetTint}
                  onPrimaryOrbitClick={() => {
                    handleObjectSelection(createdObject.id, "primary");
                  }}
                  onPrimaryOrbitDoubleClick={() => {
                    handleObjectMoveRequest(createdObject.id, "primary");
                  }}
                  onSecondaryOrbitClick={() => {
                    handleObjectSelection(createdObject.id, "secondary");
                  }}
                  onSecondaryOrbitDoubleClick={() => {
                    handleObjectMoveRequest(createdObject.id, "secondary");
                  }}
                />
              )}
            </group>
          );
        })}
    </group>
  );
};
