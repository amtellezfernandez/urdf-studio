import { isFiniteNumber } from "@/shared/lib/numeric";

export const isFiniteWorldSceneNumber = (value: unknown): value is number =>
  isFiniteNumber(value);

export const assertFiniteWorldSceneNumber = (
  value: unknown,
  fieldLabel: string
): number => {
  if (!isFiniteWorldSceneNumber(value)) {
    throw new Error(`${fieldLabel} must be a finite number.`);
  }
  return value;
};
