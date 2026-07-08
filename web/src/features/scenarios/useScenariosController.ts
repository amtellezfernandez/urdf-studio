import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import {
  createScenarioRun,
  getScenarioRun,
  listScenarioPacks,
  listScenarioRuns,
  listScenarios,
  publishScenarioPack,
  pullScenarioPack,
  type ScenarioPackSummary,
  type ScenarioRunDetail,
  type ScenarioRunSummary,
  type ScenarioSummary,
} from "@/features/scenarios/scenariosApi";

const ACTIVE_RUN_POLL_MS = 1500;

export type UseScenariosController = ReturnType<typeof useScenariosController>;

export const useScenariosController = () => {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [runs, setRuns] = useState<ScenarioRunSummary[]>([]);
  const [packs, setPacks] = useState<ScenarioPackSummary[]>([]);
  const [activeRun, setActiveRun] = useState<ScenarioRunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [scenarioList, runList, packList] = await Promise.all([
        listScenarios(),
        listScenarioRuns(),
        listScenarioPacks(),
      ]);
      setScenarios(scenarioList);
      setRuns(runList);
      setPacks(packList);
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to load scenarios."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const publishPack = useCallback(
    async (scenarioId: string, version: string) => {
      try {
        const summary = await publishScenarioPack(scenarioId, version);
        setPacks((previous) => [summary, ...previous]);
        toast.success(`Published ${summary.package_id}@${summary.version}`);
      } catch (error) {
        toast.error(readUnknownErrorMessage(error, "Failed to publish pack."));
      }
    },
    []
  );

  const pullPack = useCallback(
    async (packageId: string, version: string) => {
      try {
        const summary = await pullScenarioPack(packageId, version);
        toast.success(`Pulled ${summary.package_id}@${summary.version}. Refreshing…`);
        await refresh();
      } catch (error) {
        toast.error(readUnknownErrorMessage(error, "Failed to pull pack."));
      }
    },
    [refresh]
  );

  const pollRun = useCallback(async (runId: string) => {
    try {
      const detail = await getScenarioRun(runId);
      setActiveRun(detail);
      setRuns((previous) =>
        previous.map((run) => (run.run_id === runId ? { ...run, ...detail } : run))
      );
      if (detail.status === "queued" || detail.status === "running") {
        pollRef.current = setTimeout(() => void pollRun(runId), ACTIVE_RUN_POLL_MS);
      } else if (detail.status === "failed") {
        toast.error(detail.error || "Scenario run failed.");
      } else {
        toast.success(`Run complete: ${detail.scenario_id}`);
      }
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to poll scenario run."));
    }
  }, []);

  const launchRun = useCallback(
    async (scenarioId: string, sims: string[], episodes?: number) => {
      if (sims.length === 0) {
        toast.error("Select at least one simulator.");
        return;
      }
      try {
        const summary = await createScenarioRun(scenarioId, sims, episodes);
        setRuns((previous) => [summary, ...previous]);
        setActiveRun({ ...summary, comparison: null, has_report: false });
        toast.success(`Launched ${scenarioId} on ${sims.join(", ")}`);
        if (pollRef.current) clearTimeout(pollRef.current);
        pollRef.current = setTimeout(() => void pollRun(summary.run_id), ACTIVE_RUN_POLL_MS);
      } catch (error) {
        toast.error(readUnknownErrorMessage(error, "Failed to launch scenario run."));
      }
    },
    [pollRun]
  );

  const selectRun = useCallback(
    (runId: string) => {
      if (pollRef.current) clearTimeout(pollRef.current);
      void pollRun(runId);
    },
    [pollRun]
  );

  useEffect(() => {
    void refresh();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [refresh]);

  return {
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
  };
};
