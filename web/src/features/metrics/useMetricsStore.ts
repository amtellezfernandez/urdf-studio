/**
 * Zustand store for metrics visualization state management.
 */

import { create } from "zustand";
import type { MetricSeries, ChartConfig, MetricsSnapshot } from "./types";
import { DEFAULT_CHART_CONFIG, METRIC_COLORS } from "./types";

// ============================================================================
// Types
// ============================================================================

interface MetricsState {
  // Active job being monitored
  activeJobId: string | null;

  // Metrics series data
  series: Record<string, MetricSeries>;

  // Chart configuration
  chartConfig: ChartConfig;

  // Real-time updates
  isStreaming: boolean;
  lastUpdate: number | null;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Actions
  setActiveJobId: (jobId: string | null) => void;

  // Series management
  setSeries: (series: Record<string, MetricSeries>) => void;
  addDataPoint: (metricName: string, point: { step: number; epoch: number; timestamp: number; value: number }) => void;
  addSnapshot: (snapshot: MetricsSnapshot) => void;
  toggleSeriesVisibility: (metricName: string) => void;
  clearSeries: () => void;

  // Chart config
  setChartConfig: (config: Partial<ChartConfig>) => void;
  resetChartConfig: () => void;

  // Streaming
  setIsStreaming: (streaming: boolean) => void;

  // Loading
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Reset
  reset: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const getColorForIndex = (index: number): string => {
  return METRIC_COLORS[index % METRIC_COLORS.length];
};

const formatMetricLabel = (name: string): string => {
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// ============================================================================
// Store
// ============================================================================

export const useMetricsStore = create<MetricsState>((set, get) => ({
  // Initial state
  activeJobId: null,
  series: {},
  chartConfig: { ...DEFAULT_CHART_CONFIG },
  isStreaming: false,
  lastUpdate: null,
  isLoading: false,
  error: null,

  // Actions
  setActiveJobId: (activeJobId) => set({ activeJobId }),

  setSeries: (series) => set({ series, lastUpdate: Date.now() }),

  addDataPoint: (metricName, point) => {
    const { series } = get();
    const existingSeries = series[metricName];

    if (existingSeries) {
      // Add to existing series
      set({
        series: {
          ...series,
          [metricName]: {
            ...existingSeries,
            data: [...existingSeries.data, point],
          },
        },
        lastUpdate: Date.now(),
      });
    } else {
      // Create new series
      const colorIndex = Object.keys(series).length;
      set({
        series: {
          ...series,
          [metricName]: {
            name: metricName,
            label: formatMetricLabel(metricName),
            color: getColorForIndex(colorIndex),
            data: [point],
            visible: true,
          },
        },
        lastUpdate: Date.now(),
      });
    }
  },

  addSnapshot: (snapshot) => {
    const { series } = get();
    const newSeries = { ...series };
    let colorIndex = Object.keys(series).length;

    for (const [metricName, value] of Object.entries(snapshot.metrics)) {
      const point = {
        step: snapshot.step,
        epoch: snapshot.epoch,
        timestamp: snapshot.timestamp,
        value,
      };

      if (newSeries[metricName]) {
        newSeries[metricName] = {
          ...newSeries[metricName],
          data: [...newSeries[metricName].data, point],
        };
      } else {
        newSeries[metricName] = {
          name: metricName,
          label: formatMetricLabel(metricName),
          color: getColorForIndex(colorIndex),
          data: [point],
          visible: true,
        };
        colorIndex++;
      }
    }

    set({ series: newSeries, lastUpdate: Date.now() });
  },

  toggleSeriesVisibility: (metricName) => {
    const { series } = get();
    const targetSeries = series[metricName];

    if (targetSeries) {
      set({
        series: {
          ...series,
          [metricName]: {
            ...targetSeries,
            visible: !targetSeries.visible,
          },
        },
      });
    }
  },

  clearSeries: () => set({ series: {}, lastUpdate: null }),

  setChartConfig: (config) => set((state) => ({
    chartConfig: { ...state.chartConfig, ...config },
  })),

  resetChartConfig: () => set({ chartConfig: { ...DEFAULT_CHART_CONFIG } }),

  setIsStreaming: (isStreaming) => set({ isStreaming }),

  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  reset: () => set({
    activeJobId: null,
    series: {},
    chartConfig: { ...DEFAULT_CHART_CONFIG },
    isStreaming: false,
    lastUpdate: null,
    isLoading: false,
    error: null,
  }),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectVisibleSeries = (state: MetricsState): MetricSeries[] => {
  return Object.values(state.series).filter((s) => s.visible);
};

export const selectAllSeriesNames = (state: MetricsState): string[] => {
  return Object.keys(state.series);
};

export const selectLatestValues = (state: MetricsState): Record<string, number> => {
  const latest: Record<string, number> = {};

  for (const [name, series] of Object.entries(state.series)) {
    if (series.data.length > 0) {
      latest[name] = series.data[series.data.length - 1].value;
    }
  }

  return latest;
};
