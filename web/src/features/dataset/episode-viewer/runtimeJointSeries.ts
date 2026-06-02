const UNSET_SERIES_VALUE = Number.NaN;

const buildSeriesValues = ({
  frameCount,
  existing,
}: {
  frameCount: number;
  existing?: number[];
}) =>
  Array.from({ length: frameCount }, (_, frameIndex) => {
    const value = existing?.[frameIndex];
    return Number.isFinite(value) ? value : UNSET_SERIES_VALUE;
  });

export const buildRuntimeJointSeries = ({
  jointNames,
  frameCount,
  previousSeries,
}: {
  jointNames: readonly string[];
  frameCount: number;
  previousSeries?: ReadonlyMap<string, number[]>;
}) => {
  const series = new Map<string, number[]>();
  jointNames.forEach((jointName) => {
    const existing = previousSeries?.get(jointName);
    series.set(
      jointName,
      buildSeriesValues({
        frameCount,
        existing,
      })
    );
  });
  return series;
};

export const recordRuntimeJointSeriesFrame = ({
  series,
  frameIndex,
  jointNames,
  jointValues,
}: {
  series: Map<string, number[]>;
  frameIndex: number;
  jointNames: readonly string[];
  jointValues: Record<string, number>;
}) => {
  let didChange = false;
  jointNames.forEach((jointName) => {
    const jointValue = jointValues[jointName];
    if (!Number.isFinite(jointValue)) return;
    const seriesValues = series.get(jointName);
    if (!seriesValues) return;
    if (frameIndex < 0 || frameIndex >= seriesValues.length) return;
    if (Object.is(seriesValues[frameIndex], jointValue)) return;
    seriesValues[frameIndex] = jointValue;
    didChange = true;
  });
  return didChange;
};

export const resolveRuntimeJointSeriesValue = ({
  series,
  jointName,
  frameIndex,
}: {
  series: ReadonlyMap<string, number[]>;
  jointName: string;
  frameIndex: number;
}) => {
  const seriesValues = series.get(jointName);
  if (!seriesValues) return null;
  if (frameIndex < 0 || frameIndex >= seriesValues.length) return null;
  const directValue = seriesValues[frameIndex];
  if (Number.isFinite(directValue)) {
    return directValue;
  }

  let previousFiniteIndex = -1;
  for (let index = frameIndex - 1; index >= 0; index -= 1) {
    if (Number.isFinite(seriesValues[index])) {
      previousFiniteIndex = index;
      break;
    }
  }

  let nextFiniteIndex = -1;
  for (let index = frameIndex + 1; index < seriesValues.length; index += 1) {
    if (Number.isFinite(seriesValues[index])) {
      nextFiniteIndex = index;
      break;
    }
  }

  if (previousFiniteIndex >= 0 && nextFiniteIndex >= 0) {
    const previousValue = seriesValues[previousFiniteIndex];
    const nextValue = seriesValues[nextFiniteIndex];
    if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) return null;
    const blend =
      (frameIndex - previousFiniteIndex) /
      (nextFiniteIndex - previousFiniteIndex);
    return previousValue + (nextValue - previousValue) * blend;
  }

  if (previousFiniteIndex >= 0) {
    const previousValue = seriesValues[previousFiniteIndex];
    return Number.isFinite(previousValue) ? previousValue : null;
  }

  if (nextFiniteIndex >= 0) {
    const nextValue = seriesValues[nextFiniteIndex];
    return Number.isFinite(nextValue) ? nextValue : null;
  }

  return null;
};
