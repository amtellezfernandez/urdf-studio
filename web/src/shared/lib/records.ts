export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readRecordOrEmpty = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};
