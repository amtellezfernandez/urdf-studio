export const parseVector3 = (
  value: string,
  fallback: [number, number, number] = [1, 1, 1]
): [number, number, number] => {
  const parts = value.trim().split(/\s+/).map((part) => Number(part));
  return [
    Number.isFinite(parts[0]) ? parts[0] : fallback[0],
    Number.isFinite(parts[1]) ? parts[1] : fallback[1],
    Number.isFinite(parts[2]) ? parts[2] : fallback[2],
  ];
};

export const formatVector3 = (value: [number, number, number]): string => {
  return `${value[0]} ${value[1]} ${value[2]}`;
};

export const updateVector3Value = (
  values: [number, number, number],
  index: number,
  value: number
): [number, number, number] => {
  const next = [...values] as [number, number, number];
  next[index] = value;
  return next;
};
