export type Vector3Tuple = [number, number, number];

export const parseVector3Tuple = (
  value: string,
  fallback: Vector3Tuple = [1, 1, 1]
): Vector3Tuple => {
  const parts = value.trim().split(/\s+/).map((part) => Number(part));
  return [
    Number.isFinite(parts[0]) ? parts[0] : fallback[0],
    Number.isFinite(parts[1]) ? parts[1] : fallback[1],
    Number.isFinite(parts[2]) ? parts[2] : fallback[2],
  ];
};

export const formatVector3Tuple = (value: Vector3Tuple): string =>
  `${value[0]} ${value[1]} ${value[2]}`;

export const updateVector3TupleValue = (
  values: Vector3Tuple,
  index: number,
  value: number
): Vector3Tuple => {
  const next = [...values] as Vector3Tuple;
  next[index] = value;
  return next;
};
