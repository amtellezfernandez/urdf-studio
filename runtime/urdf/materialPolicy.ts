import { MATERIAL_APPLY_PARAMS, type Rgba } from "./materialApplyParams";

const MATERIAL_PARAMS = MATERIAL_APPLY_PARAMS;
const SYNTHETIC_COLOR_PALETTE = MATERIAL_PARAMS.syntheticColorPalette;
const SEMANTIC_SYNTHETIC_COLORS = MATERIAL_PARAMS.semanticSyntheticColors;
const FNV_1A_32_OFFSET_BASIS = MATERIAL_PARAMS.fnv1a32OffsetBasis;
const FNV_1A_32_PRIME = MATERIAL_PARAMS.fnv1a32Prime;

export type ParsedRgba = [number, number, number, number];

export const tupleRgba = (rgba: Rgba): ParsedRgba => [
  rgba[0],
  rgba[1],
  rgba[2],
  rgba[3],
];

export const visualIndexWithinLink = (visualNode: Element): number => {
  const parent = visualNode.parentElement;
  if (!parent) return 0;
  const visuals = Array.from(parent.children).filter(
    (child) => child.nodeName.toLowerCase() === "visual"
  );
  return Math.max(visuals.indexOf(visualNode), 0);
};

export const urdfVisualFingerprint = (visualNode: Element): string => {
  const linkNode = visualNode.parentElement;
  const linkName =
    linkNode?.nodeName.toLowerCase() === "link"
      ? linkNode.getAttribute("name")?.trim() ?? ""
      : "";
  const visualName = visualNode.getAttribute("name")?.trim() ?? "";
  const visualIndex = visualIndexWithinLink(visualNode);
  const meshFilename =
    visualNode.querySelector("geometry > mesh")?.getAttribute("filename")?.trim() ?? "";
  return [linkName, visualName, String(visualIndex), meshFilename]
    .filter(Boolean)
    .join(" ");
};

export const stablePaletteIndex = (value: string, paletteSize: number): number => {
  if (paletteSize <= 0) {
    throw new Error("paletteSize must be positive");
  }
  let hash = FNV_1A_32_OFFSET_BASIS >>> 0;
  const bytes = new TextEncoder().encode(value);
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, FNV_1A_32_PRIME) >>> 0;
  });
  return hash % paletteSize;
};

export const resolveSyntheticVisualRgba = (visualNode: Element): ParsedRgba => {
  const fingerprint = urdfVisualFingerprint(visualNode).toLowerCase();
  const semanticColor = SEMANTIC_SYNTHETIC_COLORS.find(({ terms }) =>
    terms.some((term) => fingerprint.includes(term))
  );
  if (semanticColor) {
    return tupleRgba(semanticColor.rgba);
  }
  return tupleRgba(
    SYNTHETIC_COLOR_PALETTE[
      stablePaletteIndex(fingerprint, SYNTHETIC_COLOR_PALETTE.length)
    ]
  );
};
