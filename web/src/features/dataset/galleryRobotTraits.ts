import type { IluGalleryEntry, IluGalleryRobotTraits } from "@/features/dataset/iluGalleryApi";

const GALLERY_ROBOT_FAMILY_LABELS: Record<string, string> = {
  "humanoid-like": "Humanoid",
  "quadruped-like": "Quadruped",
  "mobile-manipulator": "Mobile manipulator",
  wheeled: "Wheeled",
  manipulator: "Manipulator",
  legged: "Legged",
  "object-like": "Object-like",
  other: "Robot",
};

const GALLERY_STAR_MACRO_LABELS = [
  "Arm",
  "Biped",
  "Dual Arm",
  "Drone",
  "End Effector",
  "Humanoid",
  "Mobile Manipulator",
  "Quadruped",
  "Wheeled",
  "Object",
  "Other",
] as const;

const GALLERY_STAR_MACRO_INDEX = new Map<string, string>(
  GALLERY_STAR_MACRO_LABELS.map((tag) => [tag.toLowerCase(), tag])
);

const GALLERY_STAR_MACRO_ALIASES = new Map<string, string>([
  ["arm", "Arm"],
  ["biped", "Biped"],
  ["dual arm", "Dual Arm"],
  ["drone", "Drone"],
  ["end effector", "End Effector"],
  ["hand", "End Effector"],
  ["gripper", "End Effector"],
  ["humanoid", "Humanoid"],
  ["mobile manipulator", "Mobile Manipulator"],
  ["quadruped", "Quadruped"],
  ["wheeled", "Wheeled"],
  ["wheel", "Wheeled"],
  ["object", "Object"],
  ["objects", "Object"],
  ["other", "Other"],
  ["manipulator", "Arm"],
]);

const GALLERY_STAR_FAMILY_LABELS: Record<string, string> = {
  "humanoid-like": "Humanoid",
  "quadruped-like": "Quadruped",
  "mobile-manipulator": "Mobile Manipulator",
  wheeled: "Wheeled",
  manipulator: "Arm",
  legged: "Legged",
  "object-like": "Object",
  other: "Other",
};

const formatPluralizedCount = (
  count: number,
  singular: string,
  plural = `${singular}s`
): string => `${count} ${count === 1 ? singular : plural}`;

const uniqueLabels = (labels: string[]): string[] => {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (!label || seen.has(label)) {
      return false;
    }
    seen.add(label);
    return true;
  });
};

const normalizeCount = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.round(value));
};

const parseCount = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return normalizeCount(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.round(parsed));
};

const normalizeMacroTag = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return GALLERY_STAR_MACRO_ALIASES.get(normalized) || GALLERY_STAR_MACRO_INDEX.get(normalized) || "";
};

const inferMacroTags = ({
  armCount,
  legCount,
  wheelCount,
  nameSeed,
}: {
  armCount?: number;
  legCount?: number;
  wheelCount?: number;
  nameSeed: string;
}): string[] => {
  const arms = armCount ?? 0;
  const legs = legCount ?? 0;
  const wheels = wheelCount ?? 0;
  const seed = nameSeed.toLowerCase();
  const inferred = new Set<string>();
  const hasAny = (...tokens: string[]) => tokens.some((token) => seed.includes(token));

  if (hasAny("hand", "gripper", "finger", "eef", "end effector")) {
    inferred.add("End Effector");
  }
  if (hasAny("drone", "quadrotor", "uav", "crazyflie", "aerial")) {
    inferred.add("Drone");
  }
  if (
    arms === 0 &&
    legs === 0 &&
    wheels === 0 &&
    hasAny(
      "object",
      "cube",
      "box",
      "sphere",
      "cylinder",
      "table",
      "desk",
      "chair",
      "bottle",
      "can",
      "cup",
      "plate",
      "pan",
      "obstacle",
      "prop"
    )
  ) {
    inferred.add("Object");
  }
  if (wheels > 0 && (arms > 0 || legs > 0)) {
    inferred.add("Mobile Manipulator");
  } else if (wheels > 0) {
    inferred.add("Wheeled");
  }

  if (legs >= 4) {
    inferred.add("Quadruped");
  } else if (legs >= 2) {
    inferred.add("Biped");
  }

  if (!inferred.has("End Effector")) {
    if (arms === 2 && legs === 0 && wheels === 0) {
      inferred.add("Dual Arm");
    } else if (arms > 0) {
      inferred.add("Arm");
    }
  }

  if (inferred.size === 0) {
    const familyMacro = normalizeMacroTag(nameSeed);
    if (familyMacro) {
      inferred.add(familyMacro);
    }
  }

  if (inferred.size === 0) {
    inferred.add("Other");
  }

  return Array.from(inferred);
};

const buildMetadataTagMap = (entry: IluGalleryEntry): Map<string, string> => {
  const metadataFromTags = new Map<string, string>();
  entry.tags.forEach((tag) => {
    const [keyRaw, ...valueParts] = tag.split(":");
    if (!keyRaw || valueParts.length === 0) return;
    const key = keyRaw.trim().toLowerCase();
    const value = valueParts.join(":").trim();
    if (!value) return;
    metadataFromTags.set(key, value);
  });
  return metadataFromTags;
};

type GalleryRobotCountKey = "meshes" | "links" | "joints" | "arms" | "legs" | "wheels";

type GalleryRobotCountLineField = {
  key: GalleryRobotCountKey;
  label: string;
  directValue: unknown;
  traitValue?: number;
};

const readCount = (
  directValue: unknown,
  traitValue: number | undefined,
  metadataTags: Map<string, string>,
  key: GalleryRobotCountKey
): string => {
  const directCount = normalizeCount(directValue);
  if (directCount !== undefined) {
    return String(directCount);
  }
  const traitCount = normalizeCount(traitValue);
  if (traitCount !== undefined) {
    return String(traitCount);
  }
  return String(parseCount(metadataTags.get(key)) ?? metadataTags.get(key) ?? "").trim();
};

const buildCountLine = (
  metadataTags: Map<string, string>,
  fields: GalleryRobotCountLineField[]
): string | null => {
  const parts = fields
    .map(({ key, label, directValue, traitValue }) => {
      const count = readCount(directValue, traitValue, metadataTags, key);
      return count ? `${label} ${count}` : "";
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
};

const resolveDisplayMacroTags = (entry: IluGalleryEntry): string[] => {
  const explicitMacroTags = Array.from(
    new Set((entry.macroTags ?? []).map((tag) => normalizeMacroTag(tag)).filter(Boolean))
  );
  const metadataTags = entry.tags.map((tag) => normalizeMacroTag(tag)).filter(Boolean);
  const legacyMacroTags = explicitMacroTags.length ? [] : Array.from(new Set(metadataTags));
  const hasSpecificLegacyTag = legacyMacroTags.some((tag) => tag !== "Other");

  const metadataTagMap = buildMetadataTagMap(entry);
  const armCount = parseCount(readCount(entry.armCount, entry.robotTraits?.armCount, metadataTagMap, "arms"));
  const legCount = parseCount(readCount(entry.legCount, entry.robotTraits?.legCount, metadataTagMap, "legs"));
  const wheelCount = parseCount(readCount(entry.wheelCount, entry.robotTraits?.wheelCount, metadataTagMap, "wheels"));
  const inferredMacroTags = inferMacroTags({
    armCount,
    legCount,
    wheelCount,
    nameSeed: [entry.title, entry.sourceFile, entry.urdfPath, entry.galleryFileBase].filter(Boolean).join(" "),
  });

  const manifestMacroTags = explicitMacroTags.length > 0
    ? explicitMacroTags
    : hasSpecificLegacyTag
      ? legacyMacroTags
      : inferredMacroTags;

  const withoutOther = manifestMacroTags.some((tag) => tag !== "Other")
    ? manifestMacroTags.filter((tag) => tag !== "Other")
    : manifestMacroTags;

  if (withoutOther.includes("Humanoid")) {
    return withoutOther.filter((tag) => tag !== "End Effector");
  }
  if (withoutOther.includes("End Effector")) {
    return withoutOther.filter((tag) => tag !== "Arm" && tag !== "Dual Arm");
  }
  return withoutOther;
};

export const formatGalleryRobotPrimaryFamily = (
  traits: IluGalleryRobotTraits | null | undefined
): string | null => {
  if (!traits?.primaryFamily) return null;
  return GALLERY_ROBOT_FAMILY_LABELS[traits.primaryFamily] ?? traits.primaryFamily;
};

export const buildGalleryRobotTraitChips = (entry: IluGalleryEntry): string[] => {
  const traits = entry.robotTraits;
  const labels: string[] = [];
  const familyLabel = formatGalleryRobotPrimaryFamily(traits);
  if (familyLabel) {
    labels.push(familyLabel);
  }
  if ((traits?.armCount ?? 0) > 0) {
    labels.push(formatPluralizedCount(traits?.armCount ?? 0, "arm"));
  }
  if ((traits?.legCount ?? 0) > 0) {
    labels.push(formatPluralizedCount(traits?.legCount ?? 0, "leg"));
  }
  if ((traits?.wheelCount ?? 0) > 0) {
    labels.push(formatPluralizedCount(traits?.wheelCount ?? 0, "wheel"));
  }
  entry.tags.forEach((tag) => {
    const normalized = tag.trim();
    if (!normalized) return;
    labels.push(normalized.toUpperCase());
  });
  return uniqueLabels(labels);
};


export const buildGalleryRobotMacroTag = (entry: IluGalleryEntry): string | null => {
  const displayMacroTags = resolveDisplayMacroTags(entry);
  if (displayMacroTags.length > 0) {
    return displayMacroTags[0] ?? null;
  }
  const primaryFamily = entry.robotTraits?.primaryFamily;
  if (primaryFamily) {
    return GALLERY_STAR_FAMILY_LABELS[primaryFamily] ?? primaryFamily;
  }
  return null;
};

export const buildGalleryRobotStructureLine = (entry: IluGalleryEntry): string | null => {
  const metadataTags = buildMetadataTagMap(entry);
  return buildCountLine(metadataTags, [
    { key: "meshes", label: "Meshes", directValue: entry.meshCount },
    { key: "links", label: "Links", directValue: entry.linkCount, traitValue: entry.robotTraits?.linkCount },
    { key: "joints", label: "Joints", directValue: entry.jointCount, traitValue: entry.robotTraits?.jointCount },
  ]);
};

export const buildGalleryRobotLimbLine = (entry: IluGalleryEntry): string | null => {
  const metadataTags = buildMetadataTagMap(entry);
  return buildCountLine(metadataTags, [
    { key: "arms", label: "Arms", directValue: entry.armCount, traitValue: entry.robotTraits?.armCount },
    { key: "legs", label: "Legs", directValue: entry.legCount, traitValue: entry.robotTraits?.legCount },
    { key: "wheels", label: "Wheels", directValue: entry.wheelCount, traitValue: entry.robotTraits?.wheelCount },
  ]);
};

const GALLERY_ROBOT_STATUS_NOTE_OMIT_PATTERNS = [
  /^image ready$/i,
  /^image missing$/i,
  /^video ready$/i,
  /^video missing$/i,
  /^animated preview ready$/i,
  /^urdf$/i,
  /^xacro source$/i,
  /^renderable$/i,
  /^candidate discovered$/i,
] as const;

const shouldOmitGalleryRobotStatusNote = (value: string): boolean =>
  GALLERY_ROBOT_STATUS_NOTE_OMIT_PATTERNS.some((pattern) => pattern.test(value));

export const buildGalleryRobotAttentionNotes = (entry: IluGalleryEntry): string[] => {
  const structuredNotes = uniqueLabels(
    (entry.attentionNotes ?? []).map((note) => note.trim()).filter((note) => note.length > 0)
  );
  if (structuredNotes.length > 0) {
    return structuredNotes;
  }

  const summary = entry.summary?.trim();
  if (!summary) return [];
  return uniqueLabels(
    summary
      .split("|")
      .flatMap((segment) => segment.split(","))
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && !shouldOmitGalleryRobotStatusNote(segment))
  );
};
