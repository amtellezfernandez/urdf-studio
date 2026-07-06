export const cloneJsonSerializableValue = <TValue>(value: TValue): TValue => {
  if (typeof structuredClone === "function") {
    return structuredClone(value) as TValue;
  }
  return JSON.parse(JSON.stringify(value)) as TValue;
};
