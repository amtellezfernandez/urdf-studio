import type { CreatedObject } from "@/features/objects";

export type IkOrbitDefaults = {
  radius: number;
  inclinationDeg: number;
  phaseDeg: number;
  secondaryOffsetDeg: number;
};

export type WorldTargetPosition = [number, number, number];

const resolveFiniteNumber = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;

export const resolveObjectCenterOfMassWorld = (
  object: Pick<CreatedObject, "position">
): WorldTargetPosition => [object.position.x, object.position.y, object.position.z];

export const resolveObjectOrbitPhaseWorldTarget = ({
  object,
  orbitDefaults,
  phaseDeg,
}: {
  object: CreatedObject;
  orbitDefaults: IkOrbitDefaults;
  phaseDeg: number;
}): WorldTargetPosition => {
  const radius = resolveFiniteNumber(object.orbitRadius, orbitDefaults.radius);
  const inclinationDeg = resolveFiniteNumber(
    object.orbitInclination,
    orbitDefaults.inclinationDeg
  );
  const phaseRad = (phaseDeg * Math.PI) / 180;
  const inclinationRad = (inclinationDeg * Math.PI) / 180;
  const x = Math.cos(phaseRad) * radius;
  const y = Math.sin(phaseRad) * radius;
  const z = y * Math.sin(inclinationRad);
  const yAdjusted = y * Math.cos(inclinationRad);
  return [
    object.position.x + x,
    object.position.y + yAdjusted,
    object.position.z + z,
  ];
};

export const resolveObjectIkTargetWorld = ({
  object,
  orbitDefaults,
}: {
  object: CreatedObject;
  orbitDefaults: IkOrbitDefaults;
}): WorldTargetPosition => {
  if (object.ikTargetType !== "orbit" || object.orbitTargetPoint === "center") {
    return resolveObjectCenterOfMassWorld(object);
  }
  const basePhaseDeg = resolveFiniteNumber(object.orbitPhase, orbitDefaults.phaseDeg);
  const secondaryOffsetDeg = resolveFiniteNumber(
    object.orbitSecondaryOffset,
    orbitDefaults.secondaryOffsetDeg
  );
  const phaseDeg =
    object.orbitTargetPoint === "secondary" ? basePhaseDeg + secondaryOffsetDeg : basePhaseDeg;
  return resolveObjectOrbitPhaseWorldTarget({
    object,
    orbitDefaults,
    phaseDeg,
  });
};
