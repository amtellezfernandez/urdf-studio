import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import {
  STUDIO_WHEEL_MARKER_OFFSET_M,
  type StudioWheelRoleMarker,
} from "@/features/viewer/studioWheelDriveModel";
import { cn } from "@/shared/lib/utils";

const STUDIO_WHEEL_MARKER_WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);

const StudioWheelRoleMarkerBadge = ({ marker }: { marker: StudioWheelRoleMarker }) => {
  const groupRef = useRef<THREE.Group>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const markerOffsetRef = useRef(
    STUDIO_WHEEL_MARKER_WORLD_UP_AXIS.clone()
      .normalize()
      .multiplyScalar(STUDIO_WHEEL_MARKER_OFFSET_M)
  );

  useFrame(() => {
    if (!groupRef.current) return;
    marker.anchorObject.getWorldPosition(worldPositionRef.current);
    groupRef.current.position.copy(worldPositionRef.current).add(markerOffsetRef.current);
  });

  return (
    <group ref={groupRef}>
      <Html center style={{ pointerEvents: "none" }}>
        <div
          className={cn(
            "rounded border px-1 py-[1px] font-mono text-[9px] font-semibold leading-none shadow-sm",
            marker.driveEnabled
              ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-800"
              : "border-border/70 bg-background/95 text-foreground"
          )}
          title={`Wheel ${marker.wheelNumber}: ${marker.jointName}`}
        >
          {marker.wheelNumber}
        </div>
      </Html>
    </group>
  );
};

export const StudioWheelRoleMarkers = ({
  markers,
}: {
  markers: StudioWheelRoleMarker[];
}) => {
  if (markers.length === 0) return null;
  return (
    <>
      {markers.map((marker) => (
        <StudioWheelRoleMarkerBadge key={marker.jointName} marker={marker} />
      ))}
    </>
  );
};
