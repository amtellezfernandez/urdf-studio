/**
 * TypeScript types for the metrics feature.
 */

// ============================================================================
// Data Point Types
// ============================================================================

export interface MetricDataPoint {
  step: number;
  epoch: number;
  timestamp: number;
  value: number;
}

export interface MetricSeries {
  name: string;
  label: string;
  color: string;
  data: MetricDataPoint[];
  visible: boolean;
}

// ============================================================================
// Chart Configuration
// ============================================================================

export interface ChartConfig {
  xAxis: "step" | "epoch" | "time";
  yAxisScale: "linear" | "log";
  showGrid: boolean;
  showLegend: boolean;
  animate: boolean;
  smoothing: number; // 0-1, exponential moving average factor
}

// ============================================================================
// Metrics State
// ============================================================================

export interface MetricsSnapshot {
  jobId: string;
  step: number;
  epoch: number;
  timestamp: number;
  metrics: Record<string, number>;
}

// ============================================================================
// API Types
// ============================================================================

export interface MetricsHistoryResponse {
  jobId: string;
  metrics: Record<string, MetricDataPoint[]>;
  lastStep: number;
  lastEpoch: number;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  xAxis: "step",
  yAxisScale: "linear",
  showGrid: true,
  showLegend: true,
  animate: true,
  smoothing: 0,
};

export const METRIC_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#f97316", // orange
];
