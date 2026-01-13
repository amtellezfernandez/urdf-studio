export const parseVector3 = (value: string): [number, number, number] => {
  const parts = value.trim().split(/\s+/).map((part) => Number(part));
  return [parts[0] || 1, parts[1] || 1, parts[2] || 1];
};

export const formatVector3 = (value: [number, number, number]): string => {
  return `${value[0]} ${value[1]} ${value[2]}`;
};
