export const WORLD_OBJECT_SOURCE_IDS = {
  user: "user",
  scenario: "world-scenario",
  demo: "demo-world",
} as const;

export const WORLD_OBJECT_SOURCES = [
  WORLD_OBJECT_SOURCE_IDS.user,
  WORLD_OBJECT_SOURCE_IDS.scenario,
  WORLD_OBJECT_SOURCE_IDS.demo,
] as const;

export type WorldObjectSource = (typeof WORLD_OBJECT_SOURCES)[number];

export const WORLD_OBJECT_SOURCE_LABELS: Record<WorldObjectSource, string> = {
  [WORLD_OBJECT_SOURCE_IDS.user]: "User Objects",
  [WORLD_OBJECT_SOURCE_IDS.scenario]: "Scene Objects",
  [WORLD_OBJECT_SOURCE_IDS.demo]: "Demo Objects",
};
