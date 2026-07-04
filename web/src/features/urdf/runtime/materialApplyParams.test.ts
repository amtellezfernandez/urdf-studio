import { describe, expect, it } from "vitest";
import {
  MATERIAL_APPLY_PARAMS,
  parseMaterialApplyParams,
} from "@runtime-private/urdf/materialApplyParams";

const createValidMaterialParams = () => ({
  defaultAlpha: 1,
  rgbComponentCount: 3,
  rgbaComponentCount: 4,
  syntheticColorPalette: [[0.1, 0.2, 0.3, 1]],
  semanticSyntheticColors: [
    {
      terms: ["wheel"],
      rgba: [0.04, 0.045, 0.05, 1],
    },
  ],
  fnv1a32OffsetBasis: 2166136261,
  fnv1a32Prime: 16777619,
});

describe("material apply params", () => {
  it("parses the bundled material policy config", () => {
    expect(MATERIAL_APPLY_PARAMS.syntheticColorPalette.length).toBeGreaterThan(0);
    expect(MATERIAL_APPLY_PARAMS.semanticSyntheticColors.length).toBeGreaterThan(0);
  });

  it("normalizes semantic search terms", () => {
    const params = parseMaterialApplyParams({
      ...createValidMaterialParams(),
      semanticSyntheticColors: [
        {
          terms: [" wheel "],
          rgba: [0.04, 0.045, 0.05, 1],
        },
      ],
    });

    expect(params.semanticSyntheticColors[0].terms).toEqual(["wheel"]);
  });

  it("rejects malformed RGBA palette entries", () => {
    expect(() =>
      parseMaterialApplyParams({
        ...createValidMaterialParams(),
        syntheticColorPalette: [[0.1, 0.2, 0.3]],
      })
    ).toThrow(/syntheticColorPalette\[0\]/);
  });

  it("rejects empty semantic search terms", () => {
    expect(() =>
      parseMaterialApplyParams({
        ...createValidMaterialParams(),
        semanticSyntheticColors: [
          {
            terms: [""],
            rgba: [0.04, 0.045, 0.05, 1],
          },
        ],
      })
    ).toThrow(/semanticSyntheticColors\[0\]\.terms/);
  });
});
