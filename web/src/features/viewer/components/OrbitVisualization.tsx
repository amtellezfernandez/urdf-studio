import { useCallback, useMemo } from "react";
import * as THREE from "three";

export const OrbitVisualization = ({
  centerPosition,
  radius,
  inclination,
  phase,
  color,
  onPrimaryOrbitClick,
  onPrimaryOrbitDoubleClick,
  onSecondaryOrbitClick,
  onSecondaryOrbitDoubleClick,
  secondaryPhaseOffsetDeg = 0,
}: {
  centerPosition: THREE.Vector3;
  radius: number;
  inclination: number;
  phase: number;
  color: string;
  onPrimaryOrbitClick?: () => void;
  onPrimaryOrbitDoubleClick?: () => void;
  onSecondaryOrbitClick?: () => void;
  onSecondaryOrbitDoubleClick?: () => void;
  secondaryPhaseOffsetDeg?: number;
}) => {
  const TWO_PI = Math.PI * 2;
  const inclinationRad = (inclination * Math.PI) / 180;

  const normalizeAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const primaryRad = normalizeAngle((phase * Math.PI) / 180);
  const secondaryRad = normalizeAngle(((phase + secondaryPhaseOffsetDeg) * Math.PI) / 180);

  const getPoint = useCallback(
    (angle: number) => {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = y * Math.sin(inclinationRad);
      const yAdjusted = y * Math.cos(inclinationRad);
      return new THREE.Vector3(x, yAdjusted, z);
    },
    [radius, inclinationRad]
  );

  const { solidPositions, hashedPositions } = useMemo(() => {
    const sampleArc = (start: number, end: number, segments: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = segments === 0 ? 0 : i / segments;
        const angle = start + (end - start) * t;
        pts.push(getPoint(angle));
      }
      return pts;
    };

    const rawDiff = (secondaryRad - primaryRad + TWO_PI) % TWO_PI;
    if (rawDiff < 1e-5) {
      const fullPoints = sampleArc(0, TWO_PI, 96);
      return {
        solidPositions: new Float32Array(fullPoints.flatMap((p) => [p.x, p.y, p.z])),
        hashedPositions: new Float32Array(),
      };
    }

    const diff = rawDiff;
    const usePrimaryToSecondary = diff <= Math.PI && diff > 0;

    const solidStart = usePrimaryToSecondary ? primaryRad : secondaryRad;
    const solidEnd = usePrimaryToSecondary ? secondaryRad : primaryRad;
    const solidLength = usePrimaryToSecondary ? diff : TWO_PI - diff;
    const hashedStart = solidEnd;
    const hashedLength = Math.max(0, TWO_PI - solidLength);

    const solidSegCount = Math.max(12, Math.round((solidLength / TWO_PI) * 64));
    const solidPoints = sampleArc(solidStart, solidEnd, solidSegCount);
    const solidFlat = new Float32Array(solidPoints.flatMap((p) => [p.x, p.y, p.z]));

    const hashedFlat = (() => {
      if (hashedLength <= 0.0001) return new Float32Array();
      const dashSegments = Math.max(8, Math.round((hashedLength / TWO_PI) * 48));
      const dashStep = hashedLength / dashSegments;
      const dashFill = 0.55; // fraction of each dash step that is visible
      const positions: number[] = [];

      for (let i = 0; i < dashSegments; i += 2) {
        const startA = hashedStart + dashStep * i;
        const endA = startA + dashStep * dashFill;
        const p1 = getPoint(startA);
        const p2 = getPoint(endA);
        positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }

      return new Float32Array(positions);
    })();

    return { solidPositions: solidFlat, hashedPositions: hashedFlat };
  }, [getPoint, primaryRad, secondaryRad, TWO_PI]);

  // Calculate current position on orbit based on phase
  const orbitTargetPosition = useMemo(() => {
    const phaseRad = (phase * Math.PI) / 180;
    const inclinationRad = (inclination * Math.PI) / 180;

    const x = Math.cos(phaseRad) * radius;
    const y = Math.sin(phaseRad) * radius;
    const z = y * Math.sin(inclinationRad);
    const yAdjusted = y * Math.cos(inclinationRad);

    return new THREE.Vector3(
      centerPosition.x + x,
      centerPosition.y + yAdjusted,
      centerPosition.z + z
    );
  }, [centerPosition, radius, inclination, phase]);

  const secondaryTargetPosition = useMemo(() => {
    const phaseRad = ((phase + secondaryPhaseOffsetDeg) * Math.PI) / 180;
    const inclinationRad = (inclination * Math.PI) / 180;

    const x = Math.cos(phaseRad) * radius;
    const y = Math.sin(phaseRad) * radius;
    const z = y * Math.sin(inclinationRad);
    const yAdjusted = y * Math.cos(inclinationRad);

    return new THREE.Vector3(
      centerPosition.x + x,
      centerPosition.y + yAdjusted,
      centerPosition.z + z
    );
  }, [centerPosition, radius, inclination, phase, secondaryPhaseOffsetDeg]);

  const targetOffset = useMemo<[number, number, number]>(
    () => [
      orbitTargetPosition.x - centerPosition.x,
      orbitTargetPosition.y - centerPosition.y,
      orbitTargetPosition.z - centerPosition.z,
    ],
    [orbitTargetPosition, centerPosition]
  );

  const secondaryTargetOffset = useMemo<[number, number, number]>(
    () => [
      secondaryTargetPosition.x - centerPosition.x,
      secondaryTargetPosition.y - centerPosition.y,
      secondaryTargetPosition.z - centerPosition.z,
    ],
    [secondaryTargetPosition, centerPosition]
  );

  const radiusLinePositions = useMemo(
    () => new Float32Array([0, 0, 0, ...targetOffset]),
    [targetOffset]
  );

  // Force geometry rebuild when orbit params move so the viewer updates immediately
  const orbitGeometryKey = useMemo(
    () => `${radius}-${inclination}-${phase}-${secondaryPhaseOffsetDeg}`,
    [radius, inclination, phase, secondaryPhaseOffsetDeg]
  );
  const radiusLineKey = useMemo(
    () => `${orbitGeometryKey}-${phase}-${targetOffset.join("|")}`,
    [orbitGeometryKey, phase, targetOffset]
  );

  return (
    <group position={[centerPosition.x, centerPosition.y, centerPosition.z]}>
      {/* Orbit circle */}
      <line key={`orbit-${orbitGeometryKey}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={solidPositions.length / 3}
            array={solidPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} opacity={0.6} transparent linewidth={2} />
      </line>

      {/* Hashed (dashed) part */}
      {hashedPositions.length > 0 && (
        <lineSegments key={`orbit-hash-${orbitGeometryKey}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={hashedPositions.length / 3}
              array={hashedPositions}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} opacity={0.35} transparent linewidth={1} />
        </lineSegments>
      )}

      {/* Primary target point on orbit */}
      <mesh
        position={targetOffset}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPrimaryOrbitClick?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onPrimaryOrbitDoubleClick?.();
        }}
      >
        <sphereGeometry args={[0.01, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Secondary marker on orbit */}
      <mesh
        position={secondaryTargetOffset}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSecondaryOrbitClick?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onSecondaryOrbitDoubleClick?.();
        }}
      >
        <sphereGeometry args={[0.01, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Line from center to target point */}
      <line key={`orbit-radius-${radiusLineKey}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={radiusLinePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} opacity={0.4} transparent linewidth={1} />
      </line>
    </group>
  );
};
