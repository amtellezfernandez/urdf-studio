export const safeDecodeEndEffectorLink = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
