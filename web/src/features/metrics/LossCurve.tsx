/**
 * LossCurve - Loss curve visualization with real-time updates
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Settings,
  RefreshCw,
  Play,
  Pause,
  Download,
  Maximize2,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";
import { cn } from "@/shared/lib/utils";

import { MetricsChart } from "./MetricsChart";
import { useMetricsStore, selectVisibleSeries, selectLatestValues, selectAllSeriesNames } from "./useMetricsStore";
import type { ChartConfig, MetricsSnapshot } from "./types";
import { API_BASE_URL } from "@/shared/config/api";

// ============================================================================
// Types
// ============================================================================

interface LossCurveProps {
  jobId: string;
  className?: string;
  initialPolling?: boolean;
}

// ============================================================================
// Settings Panel
// ============================================================================

interface SettingsPanelProps {
  config: ChartConfig;
  onConfigChange: (config: Partial<ChartConfig>) => void;
  seriesNames: string[];
  visibleSeries: Set<string>;
  onToggleSeries: (name: string) => void;
}

function SettingsPanel({
  config,
  onConfigChange,
  seriesNames,
  visibleSeries,
  onToggleSeries,
}: SettingsPanelProps) {
  return (
    <div className="p-4 space-y-4">
      {/* X-Axis */}
      <div className="space-y-2">
        <Label className="text-xs">X-Axis</Label>
        <Select
          value={config.xAxis}
          onValueChange={(value) => onConfigChange({ xAxis: value as ChartConfig["xAxis"] })}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="step">Step</SelectItem>
            <SelectItem value="epoch">Epoch</SelectItem>
            <SelectItem value="time">Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Y-Axis Scale */}
      <div className="space-y-2">
        <Label className="text-xs">Y-Axis Scale</Label>
        <Select
          value={config.yAxisScale}
          onValueChange={(value) => onConfigChange({ yAxisScale: value as ChartConfig["yAxisScale"] })}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">Linear</SelectItem>
            <SelectItem value="log">Logarithmic</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Smoothing */}
      <div className="space-y-2">
        <Label className="text-xs">Smoothing</Label>
        <Select
          value={String(config.smoothing)}
          onValueChange={(value) => onConfigChange({ smoothing: parseFloat(value) })}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">None</SelectItem>
            <SelectItem value="0.6">Light (0.6)</SelectItem>
            <SelectItem value="0.8">Medium (0.8)</SelectItem>
            <SelectItem value="0.95">Heavy (0.95)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggle options */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Grid</Label>
          <Switch
            checked={config.showGrid}
            onCheckedChange={(checked) => onConfigChange({ showGrid: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Legend</Label>
          <Switch
            checked={config.showLegend}
            onCheckedChange={(checked) => onConfigChange({ showLegend: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Animate</Label>
          <Switch
            checked={config.animate}
            onCheckedChange={(checked) => onConfigChange({ animate: checked })}
          />
        </div>
      </div>

      {/* Series visibility */}
      {seriesNames.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Visible Metrics</Label>
          <div className="space-y-2">
            {seriesNames.map((name) => (
              <div key={name} className="flex items-center justify-between">
                <Label className="text-xs font-normal capitalize">
                  {name.replace(/_/g, " ")}
                </Label>
                <Switch
                  checked={visibleSeries.has(name)}
                  onCheckedChange={() => onToggleSeries(name)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Latest Values Display
// ============================================================================

function LatestValues() {
  const latestValues = useMetricsStore(selectLatestValues);
  const series = useMetricsStore((state) => state.series);

  if (Object.keys(latestValues).length === 0) return null;

  return (
    <div className="flex flex-wrap gap-4">
      {Object.entries(latestValues).map(([name, value]) => {
        const color = series[name]?.color || "#888";
        return (
          <div key={name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-muted-foreground capitalize">
              {name.replace(/_/g, " ")}:
            </span>
            <span className="text-sm font-mono font-medium">
              {typeof value === "number"
                ? value < 0.001
                  ? value.toExponential(3)
                  : value.toFixed(4)
                : value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function LossCurve({ jobId, className, initialPolling = true }: LossCurveProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [isPolling, setIsPolling] = useState(initialPolling);
  const pollIntervalRef = useRef<number | null>(null);

  const {
    series,
    chartConfig,
    isLoading,
    error,
    setActiveJobId,
    addSnapshot,
    clearSeries,
    setChartConfig,
    toggleSeriesVisibility,
    setIsLoading,
    setError,
  } = useMetricsStore();

  const visibleSeries = useMetricsStore(selectVisibleSeries);
  const seriesNames = useMetricsStore(selectAllSeriesNames);
  const visibleSeriesSet = new Set(visibleSeries.map((s) => s.name));

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/training/metrics/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch metrics");

      const data = await response.json();

      // Convert to snapshot format and add
      if (data.metrics) {
        for (const [metricName, points] of Object.entries(data.metrics)) {
          const pointArray = points as Array<{ step: number; epoch: number; timestamp: number; value: number }>;
          for (const point of pointArray) {
            addSnapshot({
              jobId,
              step: point.step,
              epoch: point.epoch,
              timestamp: point.timestamp,
              metrics: { [metricName]: point.value },
            });
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    }
  }, [jobId, addSnapshot, setError]);

  // Initial load and setup polling
  useEffect(() => {
    setActiveJobId(jobId);
    clearSeries();
    setIsLoading(true);

    fetchMetrics().finally(() => setIsLoading(false));

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [jobId, setActiveJobId, clearSeries, setIsLoading, fetchMetrics]);

  // Handle polling
  useEffect(() => {
    if (isPolling) {
      pollIntervalRef.current = window.setInterval(fetchMetrics, 3000);
    } else if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isPolling, fetchMetrics]);

  // Export data
  const handleExport = useCallback(() => {
    const data = {
      jobId,
      exportedAt: new Date().toISOString(),
      series: Object.fromEntries(
        Object.entries(series).map(([name, s]) => [name, s.data])
      ),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metrics-${jobId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [jobId, series]);

  return (
    <div className={cn("flex flex-col bg-card border rounded-lg overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h3 className="text-sm font-medium">Training Metrics</h3>
          <p className="text-xs text-muted-foreground">
            {isPolling ? "Live updates enabled" : "Updates paused"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsPolling(!isPolling)}
            title={isPolling ? "Pause updates" : "Resume updates"}
          >
            {isPolling ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchMetrics()}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={Object.keys(series).length === 0}
            title="Export data"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex">
        {/* Chart */}
        <div className={cn("flex-1 p-4", showSettings && "pr-0")}>
          <MetricsChart
            height={300}
            series={visibleSeries}
            config={chartConfig}
          />
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="w-64 border-l overflow-auto">
            <SettingsPanel
              config={chartConfig}
              onConfigChange={setChartConfig}
              seriesNames={seriesNames}
              visibleSeries={visibleSeriesSet}
              onToggleSeries={toggleSeriesVisibility}
            />
          </div>
        )}
      </div>

      {/* Latest values */}
      <div className="px-4 py-3 border-t bg-muted/30">
        <LatestValues />
      </div>
    </div>
  );
}
