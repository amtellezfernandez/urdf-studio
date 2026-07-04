import materialPolicyConfig from "../../config/urdf_material_policy.json";

export type Rgba = readonly [number, number, number, number];

export type SemanticSyntheticColor = {
  terms: readonly string[];
  rgba: Rgba;
};

export type MaterialApplyParams = {
  defaultAlpha: number;
  rgbComponentCount: number;
  rgbaComponentCount: number;
  syntheticColorPalette: readonly Rgba[];
  semanticSyntheticColors: readonly SemanticSyntheticColor[];
  fnv1a32OffsetBasis: number;
  fnv1a32Prime: number;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): JsonRecord => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const requireFiniteNumber = (record: JsonRecord, key: string, label: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number`);
  }
  return value;
};

const parseRgbaTuple = (value: unknown, label: string): Rgba => {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    throw new Error(`${label} must be an RGBA tuple of four finite numbers`);
  }
  return [value[0], value[1], value[2], value[3]];
};

const parseSemanticSyntheticColor = (
  value: unknown,
  index: number
): SemanticSyntheticColor => {
  const label = `material policy semanticSyntheticColors[${index}]`;
  const record = requireRecord(value, label);
  const terms = record.terms;
  if (
    !Array.isArray(terms) ||
    terms.length === 0 ||
    terms.some((term) => typeof term !== "string" || term.trim().length === 0)
  ) {
    throw new Error(`${label}.terms must be a non-empty string list`);
  }
  return {
    terms: terms.map((term) => term.trim()),
    rgba: parseRgbaTuple(record.rgba, `${label}.rgba`),
  };
};

export const parseMaterialApplyParams = (value: unknown): MaterialApplyParams => {
  const record = requireRecord(value, "material policy");
  const syntheticColorPalette = record.syntheticColorPalette;
  const semanticSyntheticColors = record.semanticSyntheticColors;

  if (!Array.isArray(syntheticColorPalette) || syntheticColorPalette.length === 0) {
    throw new Error("material policy syntheticColorPalette must be a non-empty list");
  }
  if (!Array.isArray(semanticSyntheticColors)) {
    throw new Error("material policy semanticSyntheticColors must be a list");
  }

  return {
    defaultAlpha: requireFiniteNumber(record, "defaultAlpha", "material policy"),
    rgbComponentCount: requireFiniteNumber(record, "rgbComponentCount", "material policy"),
    rgbaComponentCount: requireFiniteNumber(record, "rgbaComponentCount", "material policy"),
    syntheticColorPalette: syntheticColorPalette.map((rgba, index) =>
      parseRgbaTuple(rgba, `material policy syntheticColorPalette[${index}]`)
    ),
    semanticSyntheticColors: semanticSyntheticColors.map(parseSemanticSyntheticColor),
    fnv1a32OffsetBasis: requireFiniteNumber(
      record,
      "fnv1a32OffsetBasis",
      "material policy"
    ),
    fnv1a32Prime: requireFiniteNumber(record, "fnv1a32Prime", "material policy"),
  };
};

export const MATERIAL_APPLY_PARAMS = parseMaterialApplyParams(materialPolicyConfig);
