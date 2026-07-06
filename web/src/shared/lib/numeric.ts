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

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isFinitePositiveNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0;

export const toFiniteNumberOrNull = (value: unknown): number | null =>
  isFiniteNumber(value) ? value : null;

export const toFiniteNumberOrFallback = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? value : fallback;

export const toNonNegativeFiniteNumberOrNull = (value: unknown): number | null => {
  const finiteValue = toFiniteNumberOrNull(value);
  return finiteValue !== null && finiteValue >= 0 ? finiteValue : null;
};

export const toNonNegativeFiniteNumberOrFallback = (
  value: unknown,
  fallback: number
): number => toNonNegativeFiniteNumberOrNull(value) ?? fallback;

export const parseFiniteFloatOrNull = (value: string): number | null =>
  toFiniteNumberOrNull(Number.parseFloat(value));
