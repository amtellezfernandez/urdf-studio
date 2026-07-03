import * as THREE from "three";
import { type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";

type WorldObjectSelectionOverlayProps = {
  object: CreatedObject;
};

const resolveCubeOverlaySize = (size: THREE.Vector3) => {
  return [
    Math.max(
      size.x + WORLD_OBJECT_RENDER_PARAMS.selectionOverlayPaddingM,
      WORLD_OBJECT_RENDER_PARAMS.selectionOverlayMinCubeSizeM
    ),
    Math.max(
      size.y + WORLD_OBJECT_RENDER_PARAMS.selectionOverlayPaddingM,
      WORLD_OBJECT_RENDER_PARAMS.selectionOverlayMinCubeSizeM
    ),
    Math.max(
      size.z + WORLD_OBJECT_RENDER_PARAMS.selectionOverlayPaddingM,
      WORLD_OBJECT_RENDER_PARAMS.selectionOverlayMinCubeSizeM
    ),
  ] as const;
};

const resolvePointOverlayRadius = (size: THREE.Vector3) => {
  const baseRadius = Math.max(size.x, size.y, size.z) * 0.5;
  return Math.max(
    baseRadius * WORLD_OBJECT_RENDER_PARAMS.selectionOverlayPointRadiusScale,
    WORLD_OBJECT_RENDER_PARAMS.selectionOverlayMinPointRadiusM
  );
};

const SelectionOverlayMeshMaterial = ({
  opacity,
  wireframe = false,
}: {
  opacity: number;
  wireframe?: boolean;
}) => (
  <meshBasicMaterial
    color={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayColor}
    transparent
    opacity={opacity}
    depthTest={false}
    depthWrite={false}
    wireframe={wireframe}
  />
);

const SelectionOverlayLineMaterial = ({ opacity }: { opacity: number }) => (
  <lineBasicMaterial
    color={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayColor}
    transparent
    opacity={opacity}
    depthTest={false}
    depthWrite={false}
  />
);

export const WorldObjectSelectionOverlay = ({
  object,
}: WorldObjectSelectionOverlayProps) => {
  const position = [object.position.x, object.position.y, object.position.z] as const;
  const rotationEuler = normalizeWorldObjectRotationEuler(object.rotation);
  const rotation: [number, number, number] = [
    rotationEuler.x,
    rotationEuler.y,
    rotationEuler.z,
  ];
  return object.type === "point" || object.type === "sphere" ? (
    <mesh position={position} rotation={rotation} raycast={() => null} renderOrder={960}>
      <sphereGeometry
        args={[
          object.type === "point" ? resolvePointOverlayRadius(object.size) : object.size.x * 0.5,
          20,
          14,
        ]}
      />
      <SelectionOverlayMeshMaterial
        opacity={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayOpacity}
        wireframe
      />
    </mesh>
  ) : object.type === "cylinder" ? (
    <>
      <mesh position={position} rotation={rotation} raycast={() => null} renderOrder={959}>
        <cylinderGeometry args={[object.size.x * 0.5, object.size.y * 0.5, object.size.z, 20]} />
        <SelectionOverlayMeshMaterial
          opacity={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayFillOpacity}
        />
      </mesh>
      <mesh position={position} rotation={rotation} raycast={() => null} renderOrder={960}>
        <cylinderGeometry args={[object.size.x * 0.5, object.size.y * 0.5, object.size.z, 20]} />
        <SelectionOverlayMeshMaterial
          opacity={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayOpacity}
          wireframe
        />
      </mesh>
    </>
  ) : (
    <>
      <mesh
        position={position}
        rotation={rotation}
        raycast={() => null}
        renderOrder={959}
      >
        <boxGeometry args={[object.size.x, object.size.y, object.size.z]} />
        <SelectionOverlayMeshMaterial
          opacity={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayFillOpacity}
        />
      </mesh>
      <lineSegments
        position={position}
        rotation={rotation}
        raycast={() => null}
        renderOrder={960}
      >
        <edgesGeometry args={[new THREE.BoxGeometry(...resolveCubeOverlaySize(object.size))]} />
        <SelectionOverlayLineMaterial
          opacity={WORLD_OBJECT_RENDER_PARAMS.selectionOverlayOpacity}
        />
      </lineSegments>
    </>
  );
};
