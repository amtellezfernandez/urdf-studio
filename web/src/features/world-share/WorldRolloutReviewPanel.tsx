import type { WorldRolloutImportResponse } from "@/features/world-share/worldRolloutTypes";
import { WORLD_ROLLOUT_REVIEW_MAX_DECISIONS } from "@/features/world-share/worldRolloutParams";

type WorldRolloutReviewPanelProps = {
  open: boolean;
  result: WorldRolloutImportResponse | null;
  onClose: () => void;
};

const formatMetricValue = (value: unknown) => {
  if (typeof value === "number") return Number.isInteger(value) ? `${value}` : value.toFixed(3);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
};

const summarizeMetrics = (metrics: Record<string, unknown>) =>
  Object.entries(metrics)
    .map(([key, value]) => {
      const formatted = formatMetricValue(value);
      return formatted ? `${key}: ${formatted}` : "";
    })
    .filter(Boolean)
    .join(", ");

const summarizeSemanticOutputs = (semanticOutputs: Record<string, unknown>) =>
  Object.keys(semanticOutputs).slice(0, 3).join(", ");

export function WorldRolloutReviewPanel({
  open,
  result,
  onClose,
}: WorldRolloutReviewPanelProps) {
  if (!open || !result) return null;
  const displayedDecisions = result.decisions.slice(0, WORLD_ROLLOUT_REVIEW_MAX_DECISIONS);
  return (
    <div className="fixed right-4 top-14 z-50 flex max-h-[calc(100vh-72px)] w-[420px] flex-col rounded-md border border-border/60 bg-background/95 shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-border/40 px-3 py-2">
        <div>
          <div className="text-sm font-medium text-foreground">Rollout Review</div>
          <div className="text-[11px] text-muted-foreground">
            {result.campaign.campaign_id} - {result.trace_record_count} trace records - {result.decision_count} decisions
          </div>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-5 gap-2 border-b border-border/30 px-3 py-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Rejects</div>
          <div className="font-medium text-red-400">{result.reject_count}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Stops</div>
          <div className="font-medium text-red-300">{result.stop_count}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Escalations</div>
          <div className="font-medium text-sky-300">{result.escalation_count}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Warnings</div>
          <div className="font-medium text-amber-300">{result.warn_count}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Target</div>
          <div className="truncate font-medium text-foreground">
            {result.campaign.checker_profile.target_id}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {displayedDecisions.length > 0 ? (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border/30 text-muted-foreground">
                <th className="px-3 py-2 font-normal">Time</th>
                <th className="px-3 py-2 font-normal">Module</th>
                <th className="px-3 py-2 font-normal">Decision</th>
                <th className="px-3 py-2 font-normal">Rule</th>
                <th className="px-3 py-2 font-normal">Metrics</th>
              </tr>
            </thead>
            <tbody>
              {displayedDecisions.map((decision, index) => (
                <tr key={`${decision.rule_id}-${decision.t_ms ?? "na"}-${index}`} className="border-b border-border/20">
                  <td className="px-3 py-2 text-muted-foreground">
                    {decision.t_ms ?? "n/a"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {decision.module_id || decision.tier || "n/a"}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">{decision.decision}</td>
                  <td className="px-3 py-2 text-foreground">{decision.rule_id}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {summarizeMetrics(decision.metrics) ||
                      summarizeSemanticOutputs(decision.semantic_outputs) ||
                      decision.message ||
                      "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            No checker decisions were included in this rollout result.
          </div>
        )}
      </div>
    </div>
  );
}
