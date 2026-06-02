import { TOP_NAV_HEIGHT_PX } from "@/features/layout/page/constants";

export const SIMULATION_PREP_PANEL_WIDTH_PX = 440;
export const SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX = 16;
const SIMULATION_PREP_PANEL_TOP_GAP_PX = 20;
export const SIMULATION_PREP_PANEL_DEFAULT_TOP_PX = TOP_NAV_HEIGHT_PX + SIMULATION_PREP_PANEL_TOP_GAP_PX;

export const getSimulationPrepPanelWidthPx = (viewportWidth: number): number =>
  Math.max(
    0,
    Math.min(
      SIMULATION_PREP_PANEL_WIDTH_PX,
      viewportWidth - SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX * 2
    )
  );

export const getSimulationPrepPanelInitialPosition = (
  viewportWidth: number
): { left: number; top: number } => {
  return {
    left: SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
    top: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
  };
};
