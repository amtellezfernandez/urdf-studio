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
  onIkTargetClick?: (obj: CreatedObject) => void;
  onObjectSelect?: (objectId: string, object?: CreatedObject) => void;
  orbitDefaults: {
    radius: number;
    inclinationDeg: number;
    phaseDeg: number;
    secondaryOffsetDeg: number;
  };
  robot: URDFRobot | null;
};

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
      const targetObj = objects.find((object) => object.id === objectId);
      setSelectedObject(objectId);
      if (!targetObj) {
        return;
      }
      if (orbitTargetPoint) {
        updateOrbitTargetPoint(objectId, orbitTargetPoint);
      } else if (targetObj.ikTargetType === "orbit") {
        updateOrbitTargetPoint(objectId, "primary");
      }
      onObjectSelect?.(objectId, targetObj);
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
      const lockedTargetObj =
        useObjectStore.getState().objects.find((object) => object.id === objectId) ?? null;
      if (!lockedTargetObj) {
        return;
      }
      onIkTargetClick?.(lockedTargetObj);
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
      {objects.filter((obj) => obj.isHidden !== true).map((obj) => {
        const isSelected = selectedObjectId === obj.id;
        const isHovered = hoveredObjectId === obj.id;
        const isContacted = contactObjectId === obj.id;
        const isEmphasized = isSelected || isHovered || isContacted;
        const baseColor = obj.color || "#3b82f6";
        const targetTint = isContacted ? "#f8fafc" : baseColor;
        const hoverEdgeColor = "#67e8f9";
        const contactEdgeColor = "#f8fafc";
        const edgeColor = isContacted ? contactEdgeColor : hoverEdgeColor;
        const maxDim = Math.max(obj.size.x, obj.size.y, obj.size.z);
        const rotationEuler = normalizeWorldObjectRotationEuler(obj.rotation);
        const objectRotation: [number, number, number] = [
          rotationEuler.x,
          rotationEuler.y,
          rotationEuler.z,
        ];
        const comRadius = Math.min(0.028, Math.max(0.007, maxDim * 0.08));
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
          <group key={obj.id}>
            {editable && isSelected && (
              <WorldObjectEditHandles
                object={obj}
                mode={objectEditMode}
                onDragStateChange={onEditDragStateChange}
              />
            )}
            {obj.type === "point" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
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
                <lineSegments position={[obj.position.x, obj.position.y, obj.position.z]}>
                  <edgesGeometry args={[new THREE.SphereGeometry(pointDisplayRadiusM, 12, 8)]} />
                  <lineBasicMaterial
                    color={isEmphasized ? edgeColor : "#aaaaaa"}
                    linewidth={2}
                  />
                </lineSegments>
              </>
            ) : obj.type === "sphere" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  rotation={objectRotation}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <sphereGeometry args={[obj.size.x * 0.5, 24, 18]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.88 : 0.6}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.42 : 0}
                  />
                </mesh>
              </>
            ) : obj.type === "cylinder" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  rotation={objectRotation}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <cylinderGeometry args={[obj.size.x * 0.5, obj.size.y * 0.5, obj.size.z, 24]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.88 : 0.6}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.42 : 0}
                  />
                </mesh>
              </>
            ) : (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  rotation={objectRotation}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.88 : 0.6}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.42 : 0}
                  />
                </mesh>
              </>
            )}

            <group position={[obj.position.x, obj.position.y, obj.position.z]}>
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
              (obj.trackedJointName || endEffectorLink) && (
                <TrackingLine
                  cubePos={obj.position}
                  robot={robot}
                  trackedJointName={obj.trackedJointName || null}
                  endEffectorLink={endEffectorLink}
                  gpuMode={gpuMode}
                />
              )}

            {obj.ikTargetType === "orbit" && (
              <OrbitVisualization
                centerPosition={obj.position}
                radius={obj.orbitRadius ?? orbitDefaults.radius}
                inclination={obj.orbitInclination ?? orbitDefaults.inclinationDeg}
                phase={obj.orbitPhase ?? orbitDefaults.phaseDeg}
                secondaryPhaseOffsetDeg={
                  obj.orbitSecondaryOffset ?? orbitDefaults.secondaryOffsetDeg
                }
                color={targetTint}
                onPrimaryOrbitClick={() => {
                  handleObjectSelection(obj.id, "primary");
                }}
                onPrimaryOrbitDoubleClick={() => {
                  handleObjectMoveRequest(obj.id, "primary");
                }}
                onSecondaryOrbitClick={() => {
                  handleObjectSelection(obj.id, "secondary");
                }}
                onSecondaryOrbitDoubleClick={() => {
                  handleObjectMoveRequest(obj.id, "secondary");
                }}
              />
            )}
          </group>
        );
      })}
    </group>
  );
};
