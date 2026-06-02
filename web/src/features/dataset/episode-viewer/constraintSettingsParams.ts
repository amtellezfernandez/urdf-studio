export const DATASET_CONSTRAINT_SETTINGS_PARAMS = {
  axisOptions: ["x", "y", "z"],
  modes: ["none", "height", "box", "wall"],
  wallSides: ["negative", "positive"],
  numberStep: 0.01,
  defaultHeightLimit: 1,
  defaultBoxMin: {
    x: -0.5,
    y: -0.5,
    z: -0.5,
  },
  defaultBoxMax: {
    x: 0.5,
    y: 0.5,
    z: 0.5,
  },
  defaultWallPosition: 0,
  defaultMode: "none",
  defaultHeightAxis: "z",
  defaultWallAxis: "y",
  defaultWallSide: "negative",
} as const;
