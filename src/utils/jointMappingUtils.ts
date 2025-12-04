import type { SavedMapping, JointMapping } from "@/components/JointMappingDialog";

const STORAGE_KEY = "urdf-studio-joint-mappings";

/**
 * Compute global min/max joint ranges across all episodes
 */
export const computeGlobalJointRanges = (
  episodes: Array<{
    frames: Array<{ jointPositions: Record<string, number> }>;
  }>
): Record<string, { min: number; max: number }> => {
  const ranges: Record<string, { min: number; max: number }> = {};

  for (const episode of episodes) {
    for (const frame of episode.frames) {
      for (const [jointName, value] of Object.entries(frame.jointPositions)) {
        if (!ranges[jointName]) {
          ranges[jointName] = { min: value, max: value };
        } else {
          ranges[jointName].min = Math.min(ranges[jointName].min, value);
          ranges[jointName].max = Math.max(ranges[jointName].max, value);
        }
      }
    }
  }

  return ranges;
};

/**
 * Get all saved mappings from sessionStorage (session-only, not persistent)
 */
export const getSavedMappings = (): SavedMapping[] => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.error("Failed to load saved mappings:", error);
    return [];
  }
};

/**
 * Save a new mapping to sessionStorage (session-only, not persistent across browser restarts)
 */
export const saveMapping = (
  source: string,
  mappings: JointMapping[],
  degToRad: boolean
): SavedMapping => {
  const allMappings = getSavedMappings();

  // Check if mapping for this source already exists
  const existingIndex = allMappings.findIndex((m) => m.source === source);

  const newMapping: SavedMapping = {
    id: existingIndex >= 0 ? allMappings[existingIndex].id : generateId(),
    source,
    mappings,
    degToRad,
    timestamp: Date.now(),
  };

  if (existingIndex >= 0) {
    // Update existing mapping
    allMappings[existingIndex] = newMapping;
  } else {
    // Add new mapping
    allMappings.push(newMapping);
  }

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(allMappings));
  return newMapping;
};

/**
 * Get mapping for a specific source
 */
export const getMappingForSource = (source: string): SavedMapping | undefined => {
  const allMappings = getSavedMappings();
  return allMappings.find((m) => m.source === source);
};

/**
 * Delete a mapping by ID
 */
export const deleteMapping = (id: string): void => {
  const allMappings = getSavedMappings();
  const filtered = allMappings.filter((m) => m.id !== id);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

/**
 * Apply a mapping to episode data (transform joint positions)
 */
export const applyMapping = (
  jointPositions: Record<string, number>,
  mappings: JointMapping[],
  degToRad: boolean
): Record<string, number> => {
  const result: Record<string, number> = {};

  for (const mapping of mappings) {
    if (!mapping.urdfJoint || mapping.urdfJoint === "?") {
      // Skip unmapped joints
      continue;
    }

    const value = jointPositions[mapping.datasetJoint];
    if (value !== undefined) {
      // Apply deg→rad conversion if enabled
      const convertedValue = degToRad ? (value * Math.PI) / 180 : value;
      result[mapping.urdfJoint] = convertedValue;
    }
  }

  return result;
};

/**
 * Apply mapping to all episodes
 */
export const applyMappingToEpisodes = <T extends { frames: Array<{ jointPositions: Record<string, number> }> }>(
  episodes: T[],
  mappings: JointMapping[],
  degToRad: boolean,
  source: string
): T[] => {
  return episodes.map((episode) => ({
    ...episode,
    frames: episode.frames.map((frame) => ({
      ...frame,
      jointPositions: applyMapping(frame.jointPositions, mappings, degToRad),
    })),
    metadata: {
      ...(episode as any).metadata,
      jointMapping: {
        source,
        appliedAt: Date.now(),
        degToRad,
        mappings: mappings.map((m) => ({
          from: m.datasetJoint,
          to: m.urdfJoint,
        })),
      },
    },
  }));
};

/**
 * Extract dataset source from episode metadata
 */
export const extractDatasetSource = (episode: { metadata?: any }): string | undefined => {
  if (!episode.metadata) return undefined;

  // Try various metadata fields that might contain the source
  return (
    episode.metadata.source ||
    episode.metadata.dataset_name ||
    episode.metadata.repo_id ||
    episode.metadata.datasetSource ||
    undefined
  );
};

/**
 * Generate a unique ID
 */
const generateId = (): string => {
  return `mapping-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Validate that a mapping is complete and valid
 */
export const validateMapping = (
  mappings: JointMapping[],
  urdfJoints: string[]
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Check for duplicate URDF joints (excluding empty and "?")
  const usedUrdfJoints = mappings
    .map((m) => m.urdfJoint)
    .filter((j) => j && j !== "?");
  const uniqueUrdfJoints = new Set(usedUrdfJoints);
  if (usedUrdfJoints.length !== uniqueUrdfJoints.size) {
    errors.push("Duplicate URDF joints detected");
  }

  // Check for invalid URDF joints
  const invalidUrdfJoints = mappings
    .filter((m) => m.urdfJoint && m.urdfJoint !== "?" && !urdfJoints.includes(m.urdfJoint))
    .map((m) => m.urdfJoint);
  if (invalidUrdfJoints.length > 0) {
    errors.push(`Invalid URDF joints: ${invalidUrdfJoints.join(", ")}`);
  }

  // Check for unmapped dataset joints (unless explicitly set to "?")
  const unmappedDatasetJoints = mappings
    .filter((m) => !m.urdfJoint || m.urdfJoint === "")
    .map((m) => m.datasetJoint);
  if (unmappedDatasetJoints.length > 0) {
    errors.push(`Unmapped dataset joints: ${unmappedDatasetJoints.join(", ")}`);
  }

  // Check if dataset joints > URDF joints
  const mappedCount = mappings.filter((m) => m.urdfJoint && m.urdfJoint !== "?").length;
  if (mappedCount > urdfJoints.length) {
    errors.push("Cannot map more dataset joints than available URDF joints");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};
