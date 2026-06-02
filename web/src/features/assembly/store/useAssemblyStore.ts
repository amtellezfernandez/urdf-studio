import { create } from "zustand";

export type AssemblyRobotInstance = {
  instanceId: string;
  urdfPath: string;
  name: string;
  isPrimary: boolean;
  role?: "host" | "replacement";
  source?:
    | {
        type: "github";
        owner: string;
        repo: string;
        path?: string;
        branch?: string;
        url?: string;
      }
    | {
        type: "local";
        folder?: string;
      };
};

const sanitizeToken = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "robot";

let instanceCounter = 0;
const createInstanceId = (urdfPath: string): string => {
  instanceCounter += 1;
  return `${sanitizeToken(urdfPath)}__${Date.now()}_${instanceCounter}`;
};

const normalizePrimary = (robots: AssemblyRobotInstance[]): AssemblyRobotInstance[] => {
  if (robots.length === 0) return [];
  let primaryFound = false;
  return robots.map((robot, index) => {
    const shouldBePrimary = !primaryFound && (robot.isPrimary || index === 0);
    if (shouldBePrimary) primaryFound = true;
    return { ...robot, isPrimary: shouldBePrimary };
  });
};

const uniquePathsPreserveOrder = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  paths.forEach((path) => {
    if (seen.has(path)) return;
    seen.add(path);
    unique.push(path);
  });
  return unique;
};

type AssemblyStore = {
  selectedRobots: AssemblyRobotInstance[];
  selectedUrdfPaths: string[];
  setSelectedUrdfPaths: (
    paths: string[],
    namesByPath?: Record<string, string>,
    sourceByPath?: Record<string, AssemblyRobotInstance["source"]>,
    roleByPath?: Record<string, AssemblyRobotInstance["role"]>
  ) => void;
  duplicateRobot: (instanceId: string) => void;
  clear: () => void;
};

export const useAssemblyStore = create<AssemblyStore>((set) => ({
  selectedRobots: [],
  selectedUrdfPaths: [],
  setSelectedUrdfPaths: (paths, namesByPath = {}, sourceByPath = {}, roleByPath = {}) =>
    set(() => {
      const uniquePaths = uniquePathsPreserveOrder(paths);
      const robots = normalizePrimary(
        uniquePaths.map((urdfPath, index) => ({
          instanceId: createInstanceId(urdfPath),
          urdfPath,
          name: namesByPath[urdfPath] || urdfPath.split("/").pop() || urdfPath,
          isPrimary: index === 0,
          role: roleByPath[urdfPath],
          source: sourceByPath[urdfPath],
        }))
      );
      return {
        selectedRobots: robots,
        selectedUrdfPaths: robots.map((robot) => robot.urdfPath),
      };
    }),
  duplicateRobot: (instanceId) =>
    set((state) => {
      const source = state.selectedRobots.find((robot) => robot.instanceId === instanceId);
      if (!source) return state;
      const sourceIndex = state.selectedRobots.findIndex((robot) => robot.instanceId === instanceId);
      const duplicate: AssemblyRobotInstance = {
        ...source,
        instanceId: createInstanceId(source.urdfPath),
        isPrimary: false,
        role: undefined,
      };
      const nextRobots = [...state.selectedRobots];
      nextRobots.splice(sourceIndex + 1, 0, duplicate);
      const normalized = normalizePrimary(nextRobots);
      return {
        selectedRobots: normalized,
        selectedUrdfPaths: normalized.map((robot) => robot.urdfPath),
      };
    }),
  clear: () => set({ selectedRobots: [], selectedUrdfPaths: [] }),
}));
