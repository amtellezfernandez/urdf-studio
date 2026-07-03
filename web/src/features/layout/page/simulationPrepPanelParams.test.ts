import { describe, expect, it } from "vitest";
import {
  SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
  SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
  SIMULATION_PREP_PANEL_WIDTH_PX,
  clampSimulationPrepPanelPosition,
  getSimulationPrepPanelInitialPosition,
  getSimulationPrepPanelWidthPx,
} from "@/features/layout/page/simulationPrepPanelParams";

describe("simulationPrepPanelParams", () => {
  it("places the panel at the viewport margin by default", () => {
    expect(getSimulationPrepPanelInitialPosition(1200)).toEqual({
      left: SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
      top: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
    });
  });

  it("clamps panel position to the visible viewport", () => {
    expect(
      clampSimulationPrepPanelPosition({
        nextLeft: -100,
        nextTop: -100,
        panelWidth: SIMULATION_PREP_PANEL_WIDTH_PX,
        panelHeight: 500,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toEqual({
      left: SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
      top: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
    });

    expect(
      clampSimulationPrepPanelPosition({
        nextLeft: 5000,
        nextTop: 5000,
        panelWidth: SIMULATION_PREP_PANEL_WIDTH_PX,
        panelHeight: 500,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toEqual({
      left: 1200 - SIMULATION_PREP_PANEL_WIDTH_PX - SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
      top: 900 - 500 - SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
    });
  });

  it("keeps the panel reachable in narrow or short viewports", () => {
    const viewportWidth = SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX;
    expect(getSimulationPrepPanelWidthPx(viewportWidth)).toBe(0);
    expect(
      clampSimulationPrepPanelPosition({
        nextLeft: 5000,
        nextTop: 5000,
        panelWidth: SIMULATION_PREP_PANEL_WIDTH_PX,
        panelHeight: 500,
        viewportWidth,
        viewportHeight: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
      })
    ).toEqual({
      left: SIMULATION_PREP_PANEL_VIEWPORT_MARGIN_PX,
      top: SIMULATION_PREP_PANEL_DEFAULT_TOP_PX,
    });
  });
});
