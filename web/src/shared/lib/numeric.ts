export type OptionalNumberBounds = {
  min?: number;
  max?: number;
};

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const clampNumberToOptionalBounds = (
  value: number,
  { min, max }: OptionalNumberBounds
): number => {
  let boundedValue = value;
  if (min !== undefined) boundedValue = Math.max(min, boundedValue);
  if (max !== undefined) boundedValue = Math.min(max, boundedValue);
  return boundedValue;
};
