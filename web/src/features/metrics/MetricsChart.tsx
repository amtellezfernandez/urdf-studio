/**
 * MetricsChart - Recharts wrapper for time series visualization
 */

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/shared/lib/utils";

import { useMetricsStore, selectVisibleSeries } from "./useMetricsStore";
import type { MetricSeries, ChartConfig } from "./types";

// ============================================================================
// Types
// ============================================================================

interface MetricsChartProps {
  className?: string;
  height?: number;
  series?: MetricSeries[];
  config?: Partial<ChartConfig>;
}

// ============================================================================
// Helpers
// ============================================================================

function applySmoothing(data: number[], factor: number): number[] {
  if (factor === 0 || data.length === 0) return data;

  const smoothed: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    smoothed.push(factor * data[i] + (1 - factor) * smoothed[i - 1]);
  }
  return smoothed;
}

function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 1e6) {
    return `${(value / 1e6).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1e3) {
    return `${(value / 1e3).toFixed(1)}K`;
  }
  if (Math.abs(value) < 0.01 && value !== 0) {
    return value.toExponential(2);
  }
  return value.toFixed(2);
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ============================================================================
// Custom Tooltip
// ============================================================================

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string | number;
  xAxis: ChartConfig["xAxis"];
}

function CustomTooltip({ active, payload, label, xAxis }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const formatLabel = () => {
    if (xAxis === "time" && typeof label === "number") {
      return formatTimestamp(label);
    }
    if (xAxis === "epoch") {
      return `Epoch ${label}`;
    }
    return `Step ${label}`;
  };

  return (
    <div className="bg-popover border rounded-lg shadow-lg p-3 min-w-[150px]">
      <p className="text-sm font-medium mb-2">{formatLabel()}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-sm text-muted-foreground">{entry.name}</span>
            </div>
            <span className="text-sm font-mono">{formatAxisValue(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function MetricsChart({
  className,
  height = 300,
  series: propSeries,
  config: propConfig,
}: MetricsChartProps) {
  const storeSeries = useMetricsStore(selectVisibleSeries);
  const { chartConfig: storeConfig } = useMetricsStore();

  const series = propSeries || storeSeries;
  const config = { ...storeConfig, ...propConfig };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (series.length === 0) return [];

    // Get all unique x values (steps, epochs, or timestamps)
    const xKey = config.xAxis === "time" ? "timestamp" : config.xAxis === "epoch" ? "epoch" : "step";
    const allXValues = new Set<number>();

    for (const s of series) {
      for (const point of s.data) {
        allXValues.add(point[xKey]);
      }
    }

    const sortedX = Array.from(allXValues).sort((a, b) => a - b);

    // Build data points for each x value
    return sortedX.map((x) => {
      const point: Record<string, number> = { [xKey]: x };

      for (const s of series) {
        const dataPoint = s.data.find((d) => d[xKey] === x);
        if (dataPoint) {
          point[s.name] = dataPoint.value;
        }
      }

      return point;
    });
  }, [series, config.xAxis]);

  // Apply smoothing if configured
  const smoothedData = useMemo(() => {
    if (config.smoothing === 0 || chartData.length === 0) return chartData;

    const smoothed = chartData.map((point) => ({ ...point }));

    for (const s of series) {
      const values = chartData.map((d) => d[s.name]).filter((v) => v !== undefined) as number[];
      const smoothedValues = applySmoothing(values, config.smoothing);

      let valueIndex = 0;
      for (const point of smoothed) {
        if (point[s.name] !== undefined) {
          point[s.name] = smoothedValues[valueIndex];
          valueIndex++;
        }
      }
    }

    return smoothed;
  }, [chartData, series, config.smoothing]);

  const xKey = config.xAxis === "time" ? "timestamp" : config.xAxis === "epoch" ? "epoch" : "step";

  if (series.length === 0 || chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/30 rounded-lg text-muted-foreground",
          className
        )}
        style={{ height }}
      >
        <p className="text-sm">No metrics data to display</p>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={smoothedData}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          {config.showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              className="text-muted/30"
            />
          )}
          <XAxis
            dataKey={xKey}
            stroke="currentColor"
            className="text-muted-foreground"
            fontSize={12}
            tickFormatter={config.xAxis === "time" ? formatTimestamp : undefined}
          />
          <YAxis
            stroke="currentColor"
            className="text-muted-foreground"
            fontSize={12}
            tickFormatter={formatAxisValue}
            scale={config.yAxisScale}
            domain={config.yAxisScale === "log" ? ["auto", "auto"] : undefined}
          />
          <Tooltip
            content={<CustomTooltip xAxis={config.xAxis} />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }}
          />
          {config.showLegend && (
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="line"
            />
          )}
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={config.animate}
              animationDuration={300}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
