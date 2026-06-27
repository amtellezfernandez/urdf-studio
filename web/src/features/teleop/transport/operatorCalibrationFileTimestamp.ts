const calibrationModifiedDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatOperatorCalibrationModifiedTime = (
  mtimeNs: number | null | undefined,
): string | null => {
  if (typeof mtimeNs !== "number" || !Number.isFinite(mtimeNs) || mtimeNs <= 0) {
    return null;
  }
  const modifiedAt = new Date(
    Math.floor(mtimeNs / 1_000_000),
  );
  if (!Number.isFinite(modifiedAt.getTime())) {
    return null;
  }
  return calibrationModifiedDateFormatter.format(modifiedAt);
};

export const formatOperatorCalibrationModifiedLine = (
  mtimeNs: number | null | undefined,
): string | null => {
  const modifiedTime = formatOperatorCalibrationModifiedTime(mtimeNs);
  return modifiedTime ? `Last modified: ${modifiedTime}` : null;
};
