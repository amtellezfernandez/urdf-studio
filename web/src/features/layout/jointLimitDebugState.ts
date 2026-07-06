import { isFiniteNumber, isFinitePositiveNumber } from "@/shared/lib/numeric";

type LimitAttributeStatus = "set" | "missing" | "invalid" | "zero";

export type LimitAttributeDebugState = {
  raw: string | null;
  status: LimitAttributeStatus;
  value: number | null;
};

export const parsePositiveScalar = (
  value: string | number | null | undefined
): number | null => {
  const parsedValue = typeof value === "number" ? value : Number(value);
  return isFinitePositiveNumber(parsedValue) ? parsedValue : null;
};

export const parseLimitAttributeDebugState = (
  value: string | number | null | undefined
): LimitAttributeDebugState => {
  if (value === null || value === undefined) {
    return { raw: null, status: "missing", value: null };
  }

  const raw = typeof value === "number" ? String(value) : value.trim();
  const parsedValue = typeof value === "number" ? value : Number(raw);
  if (raw.length === 0 || !isFiniteNumber(parsedValue)) {
    return { raw, status: "invalid", value: null };
  }
  if (parsedValue < 0) {
    return { raw, status: "invalid", value: parsedValue };
  }
  if (parsedValue === 0) {
    return { raw, status: "zero", value: parsedValue };
  }
  return { raw, status: "set", value: parsedValue };
};

export const getLimitAttributeInputTitle = (
  attributeName: "effort" | "velocity",
  attribute: LimitAttributeDebugState
): string => {
  if (attribute.status === "missing") {
    return `URDF <limit ${attributeName}> is not set.`;
  }
  if (attribute.status === "invalid") {
    return `URDF <limit ${attributeName}="${attribute.raw ?? ""}"> is invalid.`;
  }
  if (attribute.status === "zero") {
    return `URDF <limit ${attributeName}="0"> is zero.`;
  }
  return `URDF <limit ${attributeName}="${attribute.raw ?? attribute.value}">`;
};
