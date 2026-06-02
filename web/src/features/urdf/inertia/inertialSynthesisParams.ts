export const INERTIAL_SYNTHESIS_MASS_PRECISION_DECIMALS = 9;
export const INERTIAL_SYNTHESIS_ORIGIN_PRECISION_DECIMALS = 9;
export const INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS = 12;
export const INERTIAL_SYNTHESIS_MIN_VOLUME_M3 = 1e-12;
export const INERTIAL_SYNTHESIS_MIN_MASS_KG = 1e-9;
export const INERTIAL_SYNTHESIS_ZERO_EPSILON = 1e-9;
export const INERTIAL_SYNTHESIS_PLAUSIBILITY_LOW_DENSITY_PRESET_ID = "pla";
export const INERTIAL_SYNTHESIS_PLAUSIBILITY_HIGH_DENSITY_PRESET_ID = "steel";
export const INERTIAL_SYNTHESIS_PLAUSIBILITY_MIN_COMPARABLE_LINKS = 3;
export const INERTIAL_SYNTHESIS_PLAUSIBILITY_MAX_HEAVY_RATIO = 1.1;
export const INERTIAL_SYNTHESIS_PLAUSIBILITY_MIN_LIGHT_RATIO = 0.2;
export const INERTIAL_SYNTHESIS_PLAUSIBILITY_MAX_TOP_OFFENDERS = 5;
export const INERTIAL_SYNTHESIS_GHOST_GEOMETRY_MASS_LOSS_RATIO = 0.95;
export const INERTIAL_SYNTHESIS_REPEATED_MESH_WARNING_LABEL = "Repeated mesh canonicalization";

export const INERTIAL_SYNTHESIS_DENSITY_PRESETS = {
  pla: {
    label: "PLA",
    densityKgPerM3: 1240,
  },
  aluminum: {
    label: "Aluminum",
    densityKgPerM3: 2700,
  },
  steel: {
    label: "Steel",
    densityKgPerM3: 7850,
  },
} as const;

export type InertialDensityPresetId = keyof typeof INERTIAL_SYNTHESIS_DENSITY_PRESETS;

export const INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID: InertialDensityPresetId = "pla";
export const INERTIAL_SYNTHESIS_DEFAULT_MESH_SOLVE_MODE = "surface-then-voxel" as const;
export const INERTIAL_SYNTHESIS_VOXEL_RECOVERY_MESH_SOLVE_MODE = "voxel-only" as const;

export const INERTIAL_SYNTHESIS_DENSITY_PRESET_OPTIONS = (
  Object.entries(INERTIAL_SYNTHESIS_DENSITY_PRESETS) as Array<
    [InertialDensityPresetId, (typeof INERTIAL_SYNTHESIS_DENSITY_PRESETS)[InertialDensityPresetId]]
  >
).map(([id, preset]) => ({
  id,
  label: preset.label,
}));
