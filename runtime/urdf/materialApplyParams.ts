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

export const MATERIAL_APPLY_PARAMS = materialPolicyConfig as unknown as MaterialApplyParams;
