export const EPISODE_PARAMS = {
  recordingIntervalMs: 20,
  fallbackJoints: ["1", "2", "3", "4", "5"],
  autoEmbodiment: {
    prefix: "urdfstudio",
    version: "v1",
    unknownRobotType: "unknown",
    baseFrame: "base_link",
    eeFrame: "tool0",
  },
} as const;
