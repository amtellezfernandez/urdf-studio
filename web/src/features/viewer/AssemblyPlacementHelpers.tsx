import { useMemo } from "react";
import { Line } from "@react-three/drei";

import { ASSEMBLY_PLACEMENT_HELPERS_PARAMS } from "@/features/viewer/assemblyPlacementHelpersParams";
import {
  buildAssemblyContactRobotIds,
  buildAssemblyContactSegments,
  resolveAssemblyHelperRadius,
  resolveAssemblySelectedGuide,
  type AssemblyPlacementPoseMap,
  type AssemblyPlacementRadiusMap,
  type AssemblyPlacementTuple3,
} from "@/features/viewer/assemblyPlacementHelpersState";

type AssemblyPlacementHelpersProps = {
  poses: AssemblyPlacementPoseMap;
  radii: AssemblyPlacementRadiusMap;
  selectedRobotId: string | null;
  contactPairs: string[];
};

type HelperLineProps = {
  color: string;
  lineWidth: number;
  opacity: number;
  points: [AssemblyPlacementTuple3, AssemblyPlacementTuple3];
};

type HelperMarkerProps = {
  color: string;
  opacity: number;
  position: AssemblyPlacementTuple3;
  radius: number;
};

const HelperLine = ({ color, lineWidth, opacity, points }: HelperLineProps) => (
  <Line
    points={points}
    color={color}
    transparent
    opacity={opacity}
    lineWidth={lineWidth}
    depthTest={false}
    depthWrite={false}
  />
);

const HelperMarker = ({ color, opacity, position, radius }: HelperMarkerProps) => (
  <mesh
    position={position}
    renderOrder={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.helperMarkerRenderOrder}
  >
    <sphereGeometry
      args={[
        radius,
        ASSEMBLY_PLACEMENT_HELPERS_PARAMS.helperMarkerSegments,
        ASSEMBLY_PLACEMENT_HELPERS_PARAMS.helperMarkerSegments,
      ]}
    />
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthTest={false}
      depthWrite={false}
    />
  </mesh>
);

export const AssemblyPlacementHelpers = ({
  poses,
  radii,
  selectedRobotId,
  contactPairs,
}: AssemblyPlacementHelpersProps) => {
  const contactMap = useMemo(
    () => buildAssemblyContactRobotIds(contactPairs),
    [contactPairs]
  );
  const contactSegments = useMemo(
    () => buildAssemblyContactSegments({ contactPairs, poses }),
    [contactPairs, poses]
  );
  const selectedGuide = useMemo(
    () => resolveAssemblySelectedGuide({ poses, radii, selectedRobotId }),
    [poses, radii, selectedRobotId]
  );

  const robotEntries = Object.entries(poses);
  if (robotEntries.length === 0) return null;

  return (
    <group>
      {robotEntries.map(([robotId, pose]) => {
        const radius = resolveAssemblyHelperRadius(radii[robotId]);
        const innerRadius = Math.max(
          radius - ASSEMBLY_PLACEMENT_HELPERS_PARAMS.ringInsetM,
          ASSEMBLY_PLACEMENT_HELPERS_PARAMS.minInnerRadiusM
        );
        const isSelected = selectedRobotId === robotId;
        const isInContact = contactMap.has(robotId);
        const color = isSelected
          ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedColor
          : isInContact
            ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor
            : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.idleColor;
        return (
          <group key={robotId}>
            <mesh
              position={[
                pose.x,
                ASSEMBLY_PLACEMENT_HELPERS_PARAMS.ringHeightM,
                pose.z,
              ]}
              rotation={[
                ASSEMBLY_PLACEMENT_HELPERS_PARAMS.ringRotationXRad,
                0,
                0,
              ]}
              renderOrder={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.ringRenderOrder}
              userData={{ assemblyModelId: robotId }}
            >
              <ringGeometry
                args={[
                  innerRadius,
                  radius,
                  ASSEMBLY_PLACEMENT_HELPERS_PARAMS.ringSegments,
                ]}
              />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={
                  isSelected
                    ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedRingOpacity
                    : isInContact
                      ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactRingOpacity
                      : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.idleRingOpacity
                }
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <mesh
              position={[
                pose.x,
                ASSEMBLY_PLACEMENT_HELPERS_PARAMS.centerMarkerHeightM,
                pose.z,
              ]}
              renderOrder={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.centerMarkerRenderOrder}
              userData={{ assemblyModelId: robotId }}
            >
              <sphereGeometry
                args={[
                  ASSEMBLY_PLACEMENT_HELPERS_PARAMS.centerMarkerRadiusM,
                  ASSEMBLY_PLACEMENT_HELPERS_PARAMS.centerMarkerSegments,
                  ASSEMBLY_PLACEMENT_HELPERS_PARAMS.centerMarkerSegments,
                ]}
              />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={
                  isSelected
                    ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedCenterMarkerOpacity
                    : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.idleCenterMarkerOpacity
                }
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
      {contactSegments.map((segment) => (
        <HelperLine
          key={segment.id}
          points={[segment.from, segment.to]}
          color={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor}
          opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactLineOpacity}
          lineWidth={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactLineWidth}
        />
      ))}
      {selectedGuide ? (
        <>
          <HelperLine
            points={[selectedGuide.from, selectedGuide.to]}
            color={
              selectedGuide.isNearContact
                ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor
                : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.warningColor
            }
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedGuideLineOpacity}
            lineWidth={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedGuideLineWidth}
          />
          <HelperLine
            points={[selectedGuide.from, selectedGuide.axisCorner]}
            color={
              selectedGuide.axisXAligned
                ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor
                : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisGuideIdleColor
            }
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedGuideLineOpacity}
            lineWidth={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisGuideLineWidth}
          />
          <HelperLine
            points={[selectedGuide.axisCorner, selectedGuide.to]}
            color={
              selectedGuide.axisZAligned
                ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor
                : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisGuideIdleColor
            }
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedGuideLineOpacity}
            lineWidth={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisGuideLineWidth}
          />
          <HelperLine
            points={[selectedGuide.from, selectedGuide.snap]}
            color={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedColor}
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.snapGuideLineOpacity}
            lineWidth={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.snapGuideLineWidth}
          />
          <HelperLine
            points={[selectedGuide.snap, selectedGuide.to]}
            color={
              selectedGuide.isNearContact
                ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor
                : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedColor
            }
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.snapToTargetLineOpacity}
            lineWidth={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.snapToTargetLineWidth}
          />
          <HelperMarker
            position={selectedGuide.axisCorner}
            radius={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisCornerMarkerRadiusM}
            color={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisGuideIdleColor}
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.axisCornerMarkerOpacity}
          />
          <HelperMarker
            position={selectedGuide.to}
            radius={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.nearestMarkerRadiusM}
            color={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor}
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.nearestMarkerOpacity}
          />
          <HelperMarker
            position={selectedGuide.snap}
            radius={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.snapMarkerRadiusM}
            color={
              selectedGuide.isNearContact
                ? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactColor
                : ASSEMBLY_PLACEMENT_HELPERS_PARAMS.selectedColor
            }
            opacity={ASSEMBLY_PLACEMENT_HELPERS_PARAMS.snapMarkerOpacity}
          />
        </>
      ) : null}
    </group>
  );
};
