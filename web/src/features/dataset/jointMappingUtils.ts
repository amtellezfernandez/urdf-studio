import {
  DEFAULT_INDEXED_REPRESENTATION_ID,
  DEFAULT_SEMANTIC_REPRESENTATION_ID,
  LEGACY_SESSION_MAPPING_STORAGE_KEY,
  LOCAL_MAPPING_STORAGE_KEY,
  MAPPING_ID_PREFIX,
} from "@/features/dataset/datasetAlignmentParams";
import { API_BASE_URL } from "@/shared/config/runtime";
import { resolveBrowserStorage } from "@/shared/lib/browserStorage";
import type { JointMapping, SavedMapping } from "@/shared/types/feature";

const HTTP_CREATED = 201;

export interface SaveMappingOptions {
  sourceEmbodimentId?: string;
  sourceRepresentationId?: string;
  targetEmbodimentId?: string;
  targetRepresentationId?: string;
  createdBy?: string;
}

const readMappingsFromStorage = (storage: Storage | undefined, key: string): SavedMapping[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedMapping => {
      return (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SavedMapping).id === "string" &&
        typeof (entry as SavedMapping).source === "string" &&
        Array.isArray((entry as SavedMapping).mappings) &&
        typeof (entry as SavedMapping).degToRad === "boolean" &&
        typeof (entry as SavedMapping).timestamp === "number"
      );
    });
  } catch (error) {
    console.error("Failed to load saved mappings:", error);
    return [];
  }
};

const writeMappingsToStorage = (storage: Storage | undefined, key: string, mappings: SavedMapping[]): void => {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(mappings));
  } catch (error) {
    console.error("Failed to persist saved mappings:", error);
  }
};

const getLocalStorage = () => resolveBrowserStorage("local");

const getSessionStorage = () => resolveBrowserStorage("session");

const mergeMappings = (primary: SavedMapping[], fallback: SavedMapping[]): SavedMapping[] => {
  if (fallback.length === 0) return primary;
  const bySource = new Map<string, SavedMapping>();
  [...fallback, ...primary].forEach((entry) => {
    const existing = bySource.get(entry.source);
    if (!existing || existing.timestamp <= entry.timestamp) {
      bySource.set(entry.source, entry);
    }
  });
  return Array.from(bySource.values()).sort((left, right) => left.timestamp - right.timestamp);
};

const loadAllMappings = (): SavedMapping[] => {
  const localMappings = readMappingsFromStorage(getLocalStorage(), LOCAL_MAPPING_STORAGE_KEY);
  const legacySessionMappings = readMappingsFromStorage(
    getSessionStorage(),
    LEGACY_SESSION_MAPPING_STORAGE_KEY
  );
  const merged = mergeMappings(localMappings, legacySessionMappings);
  if (merged.length > localMappings.length) {
    writeMappingsToStorage(getLocalStorage(), LOCAL_MAPPING_STORAGE_KEY, merged);
  }
  return merged;
};

const persistAllMappings = (mappings: SavedMapping[]): void => {
  writeMappingsToStorage(getLocalStorage(), LOCAL_MAPPING_STORAGE_KEY, mappings);
  writeMappingsToStorage(getSessionStorage(), LEGACY_SESSION_MAPPING_STORAGE_KEY, mappings);
};

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${MAPPING_ID_PREFIX}-${crypto.randomUUID()}`;
  }
  return `${MAPPING_ID_PREFIX}-${Date.now()}`;
};

const persistMappingSpecBestEffort = async (
  mapping: SavedMapping,
  options: SaveMappingOptions
): Promise<void> => {
  const sourceEmbodimentId = options.sourceEmbodimentId;
  const targetEmbodimentId = options.targetEmbodimentId;
  if (!sourceEmbodimentId || !targetEmbodimentId) {
    return;
  }

  const payload = {
    mapping_id: mapping.mappingId,
    source: {
      embodiment_id: sourceEmbodimentId,
      representation_id: options.sourceRepresentationId ?? DEFAULT_INDEXED_REPRESENTATION_ID,
    },
    target: {
      embodiment_id: targetEmbodimentId,
      representation_id: options.targetRepresentationId ?? DEFAULT_SEMANTIC_REPRESENTATION_ID,
    },
    joint_rules: mapping.mappings
      .filter((rule) => rule.urdfJoint && rule.urdfJoint !== "?")
      .map((rule) => ({
        source_joint: rule.datasetJoint,
        target_joint: rule.urdfJoint,
        scale: 1,
        offset: rule.offset ?? 0,
        invert: Boolean(rule.inverted),
        unit: mapping.degToRad ? "deg" : "rad",
      })),
    created_by: options.createdBy ?? "urdf-studio",
    created_at: new Date(mapping.timestamp).toISOString(),
    version: "v1",
  };

  try {
    const response = await fetch(`${API_BASE_URL}/datasets/mappings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status !== HTTP_CREATED) {
      return;
    }

    const body = (await response.json()) as { mapping_id?: string };
    if (!body.mapping_id || body.mapping_id === mapping.mappingId) {
      return;
    }

    const allMappings = loadAllMappings();
    const index = allMappings.findIndex((entry) => entry.id === mapping.id);
    if (index < 0) {
      return;
    }

    allMappings[index] = {
      ...allMappings[index],
      mappingId: body.mapping_id,
    };
    persistAllMappings(allMappings);
  } catch {
    // Non-blocking: local persistence is the source of truth if backend is unavailable.
  }
};

export const getSavedMappings = (): SavedMapping[] => loadAllMappings();

export const saveMapping = (
  source: string,
  mappings: JointMapping[],
  degToRad: boolean,
  jointRanges?: Record<string, { min: number; max: number }>,
  options: SaveMappingOptions = {}
): SavedMapping => {
  const allMappings = loadAllMappings();
  const existingIndex = allMappings.findIndex((entry) => entry.source === source);
  const existing = existingIndex >= 0 ? allMappings[existingIndex] : undefined;

  const nextMapping: SavedMapping = {
    id: existing?.id ?? generateId(),
    source,
    mappings,
    degToRad,
    timestamp: Date.now(),
    jointRanges: jointRanges ?? existing?.jointRanges,
    sourceEmbodimentId: options.sourceEmbodimentId ?? existing?.sourceEmbodimentId,
    sourceRepresentationId: options.sourceRepresentationId ?? existing?.sourceRepresentationId,
    targetEmbodimentId: options.targetEmbodimentId ?? existing?.targetEmbodimentId,
    targetRepresentationId: options.targetRepresentationId ?? existing?.targetRepresentationId,
    mappingId: existing?.mappingId,
  };

  if (existingIndex >= 0) {
    allMappings[existingIndex] = nextMapping;
  } else {
    allMappings.push(nextMapping);
  }

  persistAllMappings(allMappings);
  void persistMappingSpecBestEffort(nextMapping, options);
  return nextMapping;
};

export const getMappingForSource = (source: string): SavedMapping | undefined => {
  const allMappings = loadAllMappings();
  return allMappings.find((entry) => entry.source === source);
};

export const deleteMapping = (id: string): void => {
  const allMappings = loadAllMappings();
  const filtered = allMappings.filter((entry) => entry.id !== id);
  persistAllMappings(filtered);
};
