import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  FramePreflightSession,
  PhysicsPreflightSession,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  resolveSimulationPrepPreflightRequestDecision,
  resolveSimulationPrepPreparationRefreshStatus,
  type SimulationPrepPreparationRefreshResult,
} from "@/features/layout/page/simulationPrepState";
import {
  framePreflightViaBackend,
  generatePhysicsPreflightViaBackend,
} from "@/features/urdf/inertia/robotMasteringApi";
import { ROBOT_MASTERING_PREFLIGHT_DEBOUNCE_MS } from "@/features/urdf/inertia/robotMasteringApiParams";

type SimulationPrepPreflightLoadOptions = {
  force?: boolean;
  sourceUrdf?: string;
};

type PhysicsPreflightLoadOptions = SimulationPrepPreflightLoadOptions & {
  showErrorToast?: boolean;
};

type UseSimulationPrepPreflightOptions = {
  autoLoad?: boolean;
  debounceMs?: number;
  hasLoadedFiles: boolean;
  meshFiles: Record<string, Blob>;
  meshFilesCacheKey: string;
  packageRoots?: Record<string, string[]>;
  packageRootsCacheKey: string;
  physicsGenerationSourceContent: string;
  urdfBasePath?: string;
  vizUrdfContent: string;
};

export type UseSimulationPrepPreflightResult = {
  framePreflightSession: FramePreflightSession | null;
  handleOpenGeneratePhysicsDialog: () => Promise<void>;
  isFramePreflightLoading: boolean;
  isPhysicsPreflightLoading: boolean;
  loadFramePreflight: (
    options?: SimulationPrepPreflightLoadOptions
  ) => Promise<SimulationPrepPreparationRefreshResult>;
  loadPhysicsPreflight: (
    options?: PhysicsPreflightLoadOptions
  ) => Promise<SimulationPrepPreparationRefreshResult>;
  physicsPreflightSession: PhysicsPreflightSession | null;
  refreshSimulationPrepPreparation: ({
    sourceUrdf,
  }: {
    sourceUrdf: string;
  }) => Promise<{
    frameResult: SimulationPrepPreparationRefreshResult;
    ok: boolean;
    physicsResult: SimulationPrepPreparationRefreshResult;
    status: "complete" | "failed" | "pending";
  }>;
};

const defaultErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Failed to load backend physics audit.";

export const useSimulationPrepPreflight = ({
  autoLoad = true,
  debounceMs = ROBOT_MASTERING_PREFLIGHT_DEBOUNCE_MS,
  hasLoadedFiles,
  meshFiles,
  meshFilesCacheKey,
  packageRoots,
  packageRootsCacheKey,
  physicsGenerationSourceContent,
  urdfBasePath,
  vizUrdfContent,
}: UseSimulationPrepPreflightOptions): UseSimulationPrepPreflightResult => {
  const [framePreflightSession, setFramePreflightSession] =
    useState<FramePreflightSession | null>(null);
  const [isFramePreflightLoading, setIsFramePreflightLoading] = useState(false);
  const framePreflightRequestIdRef = useRef(0);
  const framePreflightRequestedSourceRef = useRef<string | null>(null);

  const [physicsPreflightSession, setPhysicsPreflightSession] =
    useState<PhysicsPreflightSession | null>(null);
  const [isPhysicsPreflightLoading, setIsPhysicsPreflightLoading] = useState(false);
  const physicsPreflightRequestIdRef = useRef(0);
  const physicsPreflightRequestedSourceRef = useRef<string | null>(null);

  const hasPhysicsPreflightInputReady =
    hasLoadedFiles && physicsGenerationSourceContent.trim().length > 0;

  const resetFramePreflightState = useCallback(() => {
    framePreflightRequestIdRef.current += 1;
    framePreflightRequestedSourceRef.current = null;
    setFramePreflightSession(null);
    setIsFramePreflightLoading(false);
  }, []);

  const resetPhysicsPreflightState = useCallback(() => {
    physicsPreflightRequestIdRef.current += 1;
    physicsPreflightRequestedSourceRef.current = null;
    setPhysicsPreflightSession(null);
    setIsPhysicsPreflightLoading(false);
  }, []);

  const loadFramePreflight = useCallback(
    async ({
      force = false,
      sourceUrdf = vizUrdfContent,
    }: SimulationPrepPreflightLoadOptions = {}) => {
      if (sourceUrdf.trim().length === 0) {
        resetFramePreflightState();
        return "skipped" as const;
      }

      const requestDecision = resolveSimulationPrepPreflightRequestDecision({
        force,
        matchesCurrentSession: framePreflightSession?.sourceContent === sourceUrdf,
        isSameSourceInFlight: framePreflightRequestedSourceRef.current === sourceUrdf,
      });
      if (requestDecision !== "start") {
        return requestDecision;
      }

      const requestId = framePreflightRequestIdRef.current + 1;
      framePreflightRequestIdRef.current = requestId;
      framePreflightRequestedSourceRef.current = sourceUrdf;
      setIsFramePreflightLoading(true);

      try {
        const result = await framePreflightViaBackend({ sourceUrdf });
        if (framePreflightRequestIdRef.current !== requestId) {
          return "superseded" as const;
        }
        setFramePreflightSession({
          sourceContent: sourceUrdf,
          ...result,
        });
        return "success" as const;
      } catch {
        if (framePreflightRequestIdRef.current !== requestId) {
          return "superseded" as const;
        }
        return "failed" as const;
      } finally {
        if (framePreflightRequestIdRef.current === requestId) {
          framePreflightRequestedSourceRef.current = null;
          setIsFramePreflightLoading(false);
        }
      }
    },
    [framePreflightSession, resetFramePreflightState, vizUrdfContent]
  );

  const loadPhysicsPreflight = useCallback(
    async ({
      force = false,
      showErrorToast = false,
      sourceUrdf = physicsGenerationSourceContent,
    }: PhysicsPreflightLoadOptions = {}) => {
      if (!hasLoadedFiles || sourceUrdf.trim().length === 0) {
        resetPhysicsPreflightState();
        return "skipped" as const;
      }

      const requestDecision = resolveSimulationPrepPreflightRequestDecision({
        force,
        matchesCurrentSession:
          physicsPreflightSession?.sourceContent === sourceUrdf &&
          physicsPreflightSession.urdfBasePath === urdfBasePath &&
          physicsPreflightSession.meshFilesCacheKey === meshFilesCacheKey &&
          physicsPreflightSession.packageRootsCacheKey === packageRootsCacheKey,
        isSameSourceInFlight: physicsPreflightRequestedSourceRef.current === sourceUrdf,
      });
      if (requestDecision !== "start") {
        return requestDecision;
      }

      const requestId = physicsPreflightRequestIdRef.current + 1;
      physicsPreflightRequestIdRef.current = requestId;
      physicsPreflightRequestedSourceRef.current = sourceUrdf;
      setIsPhysicsPreflightLoading(true);

      try {
        const result = await generatePhysicsPreflightViaBackend({
          sourceUrdf,
          meshFiles,
          urdfBasePath,
          packageRoots,
        });
        if (physicsPreflightRequestIdRef.current !== requestId) {
          return "superseded" as const;
        }
        setPhysicsPreflightSession({
          sourceContent: sourceUrdf,
          urdfBasePath,
          meshFilesCacheKey,
          packageRootsCacheKey,
          ...result,
        });
        return "success" as const;
      } catch (error) {
        if (physicsPreflightRequestIdRef.current !== requestId) {
          return "superseded" as const;
        }
        if (showErrorToast) {
          toast.error(defaultErrorMessage(error));
        }
        return "failed" as const;
      } finally {
        if (physicsPreflightRequestIdRef.current === requestId) {
          physicsPreflightRequestedSourceRef.current = null;
          setIsPhysicsPreflightLoading(false);
        }
      }
    },
    [
      hasLoadedFiles,
      meshFiles,
      meshFilesCacheKey,
      packageRoots,
      packageRootsCacheKey,
      physicsGenerationSourceContent,
      physicsPreflightSession,
      resetPhysicsPreflightState,
      urdfBasePath,
    ]
  );

  const handleOpenGeneratePhysicsDialog = useCallback(async () => {
    if (isPhysicsPreflightLoading) {
      return;
    }
    await loadPhysicsPreflight({ showErrorToast: true });
  }, [isPhysicsPreflightLoading, loadPhysicsPreflight]);

  const refreshSimulationPrepPreparation = useCallback(
    async ({ sourceUrdf }: { sourceUrdf: string }) => {
      const [frameResult, physicsResult] = await Promise.all([
        loadFramePreflight({ force: true, sourceUrdf }),
        loadPhysicsPreflight({ force: true, sourceUrdf }),
      ]);
      const refreshStatus = resolveSimulationPrepPreparationRefreshStatus({
        frameResult,
        physicsResult,
      });
      return {
        frameResult,
        physicsResult,
        ...refreshStatus,
      };
    },
    [loadFramePreflight, loadPhysicsPreflight]
  );

  useEffect(() => {
    if (hasPhysicsPreflightInputReady) {
      return;
    }
    resetPhysicsPreflightState();
  }, [hasPhysicsPreflightInputReady, resetPhysicsPreflightState]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadFramePreflight();
    }, debounceMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoLoad, debounceMs, loadFramePreflight]);

  useEffect(() => {
    if (!autoLoad || !hasPhysicsPreflightInputReady) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadPhysicsPreflight();
    }, debounceMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoLoad, debounceMs, hasPhysicsPreflightInputReady, loadPhysicsPreflight]);

  return {
    framePreflightSession,
    handleOpenGeneratePhysicsDialog,
    isFramePreflightLoading,
    isPhysicsPreflightLoading,
    loadFramePreflight,
    loadPhysicsPreflight,
    physicsPreflightSession,
    refreshSimulationPrepPreparation,
  };
};
