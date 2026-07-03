import { numberToHexColor } from "@/shared/lib/color";
import {
  SIMULATION_PREP_SYMMETRY_OVERLAY_AFFECTED_MARKER_COLOR,
  SIMULATION_PREP_SYMMETRY_OVERLAY_MISALIGNMENT_COLOR,
  SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_GUIDE_COLOR,
} from "@/features/viewer/symmetryVisualizationParams";

export const SYMMETRY_OVERLAY_LEGEND_ITEMS = [
  {
    key: "ideal-slots",
    label: "ideal slots",
    color: numberToHexColor(SIMULATION_PREP_SYMMETRY_OVERLAY_SLOT_GUIDE_COLOR),
  },
  {
    key: "misalignment",
    label: "misalignment",
    color: numberToHexColor(SIMULATION_PREP_SYMMETRY_OVERLAY_MISALIGNMENT_COLOR),
  },
  {
    key: "affected",
    label: "affected links",
    color: numberToHexColor(SIMULATION_PREP_SYMMETRY_OVERLAY_AFFECTED_MARKER_COLOR),
  },
] as const;

export const SYMMETRY_OVERLAY_TOOLTIP_LINES = [
  "ideal slots: the equal-spacing targets for the branch family, such as 120° slots for a 3-way radial family.",
  "misalignment: direct error line from the active branch toward its ideal placement.",
  "affected links: yellow markers stay on the outlier branch links being reviewed.",
] as const;
