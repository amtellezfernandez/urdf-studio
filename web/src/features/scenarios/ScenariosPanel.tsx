import { useMemo, useState } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { scenarioRunReportUrl, type ScenarioRunStatus } from "@/features/scenarios/scenariosApi";
import { useScenariosController } from "@/features/scenarios/useScenariosController";

const AVAILABLE_SIMS = ["mujoco", "genesis"] as const;

const STATUS_TONE: Record<ScenarioRunStatus, string> = {
  queued: "text-muted-foreground",
  running: "text-amber-500",
  completed: "text-emerald-500",
  failed: "text-red-500",
};

export const ScenariosPanel = () => {
  const {
    scenarios,
    runs,
    packs,
    activeRun,
    isLoading,
    refresh,
    launchRun,
    selectRun,
    publishPack,
    pullPack,
  } = useScenariosController();
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [sims, setSims] = useState<string[]>(["mujoco", "genesis"]);
  const [packVersion, setPackVersion] = useState("1.0.0");

  const scenario = useMemo(
    () => scenarios.find((entry) => entry.scenario_id === selectedScenario) ?? scenarios[0] ?? null,
    [scenarios, selectedScenario]
  );

  const toggleSim = (sim: string) =>
    setSims((previous) =>
      previous.includes(sim) ? previous.filter((entry) => entry !== sim) : [...previous, sim]
    );

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Scenarios</h2>
          <p className="text-xs text-muted-foreground">
            Run a task across simulators and compare results.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={isLoading}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Library
          </h3>
          <ScrollArea className="h-40 rounded-md border border-border/70">
            <ul className="divide-y divide-border/60">
              {scenarios.map((entry) => (
                <li key={entry.scenario_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedScenario(entry.scenario_id)}
                    className={`w-full px-3 py-2 text-left transition-colors hover:bg-muted/40 ${
                      scenario?.scenario_id === entry.scenario_id ? "bg-muted/50" : ""
                    }`}
                  >
                    <div className="font-medium">{entry.title ?? entry.scenario_id}</div>
                    <div className="text-xs text-muted-foreground">{entry.instruction}</div>
                  </button>
                </li>
              ))}
              {scenarios.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {isLoading ? "Loading…" : "No scenarios found."}
                </li>
              )}
            </ul>
          </ScrollArea>

          {scenario && (
            <div className="space-y-3 rounded-md border border-border/70 p-3">
              <div className="text-xs text-muted-foreground">
                {scenario.task_family} · {scenario.success_condition_count} success condition(s) ·
                {" "}
                {scenario.episodes} episode(s)
              </div>
              <div className="flex flex-wrap gap-3">
                {AVAILABLE_SIMS.map((sim) => (
                  <label key={sim} className="flex items-center gap-2">
                    <Checkbox
                      checked={sims.includes(sim)}
                      onCheckedChange={() => toggleSim(sim)}
                    />
                    <span>{sim}</span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void launchRun(scenario.scenario_id, sims)}
                  disabled={sims.length === 0}
                >
                  Run across {sims.length} simulator{sims.length === 1 ? "" : "s"}
                </Button>
                <input
                  value={packVersion}
                  onChange={(event) => setPackVersion(event.target.value)}
                  className="h-8 w-20 rounded border border-border/70 bg-background px-2 text-xs"
                  aria-label="Pack version"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void publishPack(scenario.scenario_id, packVersion.trim())}
                  disabled={!packVersion.trim()}
                >
                  Publish pack
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Runs
          </h3>
          <ScrollArea className="h-40 rounded-md border border-border/70">
            <ul className="divide-y divide-border/60">
              {runs.map((run) => (
                <li key={run.run_id}>
                  <button
                    type="button"
                    onClick={() => selectRun(run.run_id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-muted/40 ${
                      activeRun?.run_id === run.run_id ? "bg-muted/50" : ""
                    }`}
                  >
                    <span>
                      <span className="font-medium">{run.scenario_id}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {run.sims.join(", ")}
                      </span>
                    </span>
                    <span className={`text-xs ${STATUS_TONE[run.status]}`}>{run.status}</span>
                  </button>
                </li>
              ))}
              {runs.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No runs yet.
                </li>
              )}
            </ul>
          </ScrollArea>

          {activeRun && <RunResult run={activeRun} />}
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Packs (content-addressed)
        </h3>
        <ScrollArea className="h-28 rounded-md border border-border/70">
          <ul className="divide-y divide-border/60">
            {packs.map((pack) => (
              <li
                key={`${pack.package_id}@${pack.version}`}
                className="flex items-center justify-between px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {pack.package_id}@{pack.version}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    sha256:{pack.digest_sha256.slice(0, 12)}…
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void pullPack(pack.package_id, pack.version)}
                >
                  Pull
                </Button>
              </li>
            ))}
            {packs.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                No packs published. Publish a scenario to share it as one digest.
              </li>
            )}
          </ul>
        </ScrollArea>
      </section>
    </div>
  );
};

const RunResult = ({ run }: { run: ReturnType<typeof useScenariosController>["activeRun"] }) => {
  if (!run) return null;
  const comparison = run.comparison;
  return (
    <div className="space-y-3 rounded-md border border-border/70 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{run.scenario_id}</span>
        <Badge variant="outline" className={STATUS_TONE[run.status]}>
          {run.status}
        </Badge>
      </div>
      {run.error && <p className="text-xs text-red-500">{run.error}</p>}

      {comparison && (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left">simulator</th>
              <th className="py-1 text-right">success</th>
              <th className="py-1 text-right">rate</th>
              <th className="py-1 text-right">mean t</th>
            </tr>
          </thead>
          <tbody>
            {comparison.backends.map((backend) => {
              const summary = comparison.summary[backend];
              return (
                <tr key={backend} className="border-t border-border/50">
                  <td className="py-1">{backend}</td>
                  <td className="py-1 text-right tabular-nums">
                    {summary?.success_count ?? 0}/{summary?.completed ?? 0}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {summary ? `${Math.round(summary.success_rate * 100)}%` : "–"}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {summary?.mean_time_to_success_s != null
                      ? `${summary.mean_time_to_success_s.toFixed(2)}s`
                      : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {comparison &&
        Object.entries(comparison.divergence).map(([pair, data]) => (
          <p key={pair} className="text-xs text-muted-foreground">
            {pair.replace("_vs_", " vs ")}: agreement{" "}
            {data.success_agreement_rate != null
              ? `${Math.round(data.success_agreement_rate * 100)}%`
              : "–"}
            {data.episodes[0] &&
              Object.entries(data.episodes[0].final_object_pose_delta).map(([objectId, delta]) => (
                <span key={objectId}>
                  {" "}
                  · {objectId} Δ{(delta.position_m * 1000).toFixed(0)}mm
                </span>
              ))}
          </p>
        ))}

      {run.has_report && (
        <a
          href={scenarioRunReportUrl(run.run_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex text-xs font-medium text-emerald-500 hover:underline"
        >
          Open visual comparison report →
        </a>
      )}
    </div>
  );
};
