export type OptionalNumberBounds = {
  min?: number;
  max?: number;
};

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const clampNumberToMin = (value: number, min: number): number =>
  Math.max(min, value);

export const clampNumberToOptionalBounds = (
  value: number,
  { min, max }: OptionalNumberBounds
): number => {
  let boundedValue = value;
  if (min !== undefined) boundedValue = Math.max(min, boundedValue);
  if (max !== undefined) boundedValue = Math.min(max, boundedValue);
  return boundedValue;
};

export const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const toFiniteNumberOrFallback = (value: unknown, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;
