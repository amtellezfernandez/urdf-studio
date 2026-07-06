import { isRecord } from "@/shared/lib/records";
import { isFiniteWorldSceneNumber } from "@/features/world-share/worldSceneNumber";

const WORLD_SCENE_MANIFEST_VALIDATION_PARAMS = {
  vectorComponentCount: 3,
  vectorComponentLabels: ["x", "y", "z"],
} as const;

export { isFiniteWorldSceneNumber, isRecord };

export const isString = (value: unknown): value is string => typeof value === "string";

export const isIntegerNumber = (value: unknown): value is number =>
  isFiniteWorldSceneNumber(value) && Number.isInteger(value);

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const isOneOf = <TValue extends string>(
  value: unknown,
  supportedValues: readonly TValue[]
): value is TValue => isString(value) && supportedValues.includes(value as TValue);

export const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

export const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.trim().length > 0;

export const validateFiniteVector = (
  value: unknown,
  fieldLabel: string,
  options?: { requirePositive?: boolean }
): string[] => {
  const errors: string[] = [];
  if (
    !Array.isArray(value) ||
    value.length !== WORLD_SCENE_MANIFEST_VALIDATION_PARAMS.vectorComponentCount
  ) {
    errors.push(
      `${fieldLabel} must be an array of ${WORLD_SCENE_MANIFEST_VALIDATION_PARAMS.vectorComponentCount} finite numbers`
    );
    return errors;
  }

  value.forEach((component, index) => {
    const axisLabel =
      WORLD_SCENE_MANIFEST_VALIDATION_PARAMS.vectorComponentLabels[index] ?? `${index}`;
    if (!isFiniteWorldSceneNumber(component)) {
      errors.push(`${fieldLabel}[${axisLabel}] must be a finite number`);
      return;
    }
    if (options?.requirePositive && component <= 0) {
      errors.push(`${fieldLabel}[${axisLabel}] must be > 0`);
    }
  });

  return errors;
};

export const validateAllowedFields = (
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  fieldLabel: string
): string[] => {
  const unsupportedFields = Object.keys(value)
    .filter((fieldName) => !allowedFields.includes(fieldName))
    .sort((left, right) => left.localeCompare(right));
  return unsupportedFields.length > 0
    ? [`${fieldLabel} has unsupported field(s): ${unsupportedFields.join(", ")}`]
    : [];
};

export const validatePositiveInteger = (value: unknown, fieldLabel: string): string[] => {
  if (!isFiniteWorldSceneNumber(value) || !Number.isInteger(value) || value < 1) {
    return [`${fieldLabel} must be a positive integer`];
  }
  return [];
};

export const validateNonEmptyString = (value: unknown, fieldLabel: string): string[] => {
  if (!isNonEmptyString(value)) {
    return [`${fieldLabel} must be a non-empty string`];
  }
  return [];
};

export const validateMaxLength = (
  value: unknown[],
  fieldLabel: string,
  maxLength: number
): string[] =>
  value.length > maxLength ? [`${fieldLabel} must contain at most ${maxLength} entries`] : [];

export const validatePositiveNumber = (value: unknown, fieldLabel: string): string[] => {
  if (!isFiniteWorldSceneNumber(value) || value <= 0) {
    return [`${fieldLabel} must be a finite number > 0`];
  }
  return [];
};

export const validateCameraFovDeg = (value: unknown, fieldLabel: string): string[] => {
  if (!isFiniteWorldSceneNumber(value) || value < 1 || value > 179) {
    return [`${fieldLabel} must be between 1 and 179 degrees`];
  }
  return [];
};

export const validateOptionalBoolean = (value: unknown, fieldLabel: string): string[] => {
  if (value === undefined) return [];
  return isBoolean(value) ? [] : [`${fieldLabel} must be a boolean`];
};

export const validateOptionalString = (value: unknown, fieldLabel: string): string[] => {
  if (value === undefined || value === null) return [];
  return isString(value) ? [] : [`${fieldLabel} must be a string or null`];
};

export const validateOptionalFiniteNumber = (
  value: unknown,
  fieldLabel: string,
  options?: { minimum?: number; maximum?: number }
): string[] => {
  if (value === undefined || value === null) return [];
  if (!isFiniteWorldSceneNumber(value)) return [`${fieldLabel} must be a finite number or null`];
  if (options?.minimum !== undefined && value < options.minimum) {
    return [`${fieldLabel} must be >= ${options.minimum}`];
  }
  if (options?.maximum !== undefined && value > options.maximum) {
    return [`${fieldLabel} must be <= ${options.maximum}`];
  }
  return [];
};

export const normalizePortableWorldAssetRef = (value: string): string | null => {
  if (value !== value.trim()) return null;
  let normalized = value.replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  const segments = normalized.length > 0 ? normalized.split("/") : [];
  if (
    normalized.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    `/${normalized}/`.includes("/../") ||
    normalized.includes(":")
  ) {
    return null;
  }
  return normalized;
};

export const validatePortableWorldAssetRef = (
  value: unknown,
  fieldLabel: string
): string[] => {
  if (!isNonEmptyString(value)) return [`${fieldLabel} must be a non-empty string`];
  return normalizePortableWorldAssetRef(value) === null
    ? [`${fieldLabel} must be a portable relative asset reference`]
    : [];
};
