type NowSource = {
  now: () => number;
};

export const nowMs = (
  source: NowSource | null = typeof performance !== "undefined" ? performance : null
): number => {
  const timestampMs = source?.now();
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? timestampMs
    : Date.now();
};
