import { TOP_NAV_HEIGHT_PX } from "@/features/layout/page/constants";

export const SIMULATION_PREP_PANEL_WIDTH_PX = 440;
export const SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX = 16;
const SIMULATION_PREP_PANEL_TOP_GAP_PX = 20;
export const SIMULATION_PREP_PANEL_DEFAULT_TOP_PX = TOP_NAV_HEIGHT_PX + SIMULATION_PREP_PANEL_TOP_GAP_PX;

export type SimulationPrepPanelPosition = {
  left: number;
  top: number;
};

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
): SimulationPrepPanelPosition => {
  return {
    left: SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
    top: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
  };
};

export const clampSimulationPrepPanelPosition = ({
  nextLeft,
  nextTop,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
}: {
  nextLeft: number;
  nextTop: number;
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): SimulationPrepPanelPosition => {
  const minLeft = SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX;
  const minTop = SIMULATION_PREP_PANEL_DEFAULT_TOP_PX;
  const maxLeft = Math.max(
    SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
    viewportWidth - panelWidth - SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX
  );
  const maxTop = Math.max(
    SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
    viewportHeight - panelHeight - SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX
  );

  return {
    left: Math.min(Math.max(nextLeft, minLeft), maxLeft),
    top: Math.min(Math.max(nextTop, minTop), maxTop),
  };
};
