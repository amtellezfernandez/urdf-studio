import type { JointMapping, SavedMapping } from "@/shared/types/feature";

const STORAGE_KEY = "urdf-studio-joint-mappings";

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
  degToRad: boolean,
  jointRanges?: Record<string, { min: number; max: number }>,
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
    jointRanges: jointRanges || (existingIndex >= 0 ? allMappings[existingIndex].jointRanges : undefined),
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
 * Generate a unique ID
 */
const generateId = (): string => {
  return `mapping-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
