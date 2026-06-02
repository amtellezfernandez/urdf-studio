import { useEffect, useState } from "react";
import * as THREE from "three";

import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import {
  isRunRuntimeDemoScanMessage,
  isSetRuntimeDemoRestrictedAreaMessage,
  isSetRuntimeDemoTrajectoryMessage,
} from "@/shared/contracts/previewBridge";
import { useObjectStore } from "@/features/objects";
import {
  RUNTIME_DEMO_SCAN_DURATION_MS,
  RUNTIME_PREVIEW_BUTTERCLAW_OBJECTS_POLL_INTERVAL_MS,
  readRuntimeDemoTrajectorySelection,
} from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";
import {
  RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS,
  type RuntimeDemoObjectSnapshot,
  buildRuntimeDemoObjects,
  buildRuntimeDemoRestrictedAreaObjects,
  buildRuntimeDemoTrajectoryObjects,
  type RuntimeDemoRestrictedAreaId,
} from "@/studio_ui/runtimeviz/runtimeDemoScene";

type ButterClawRuntimeObjectsResponse = {
  source_path: string;
  objects: RuntimeDemoObjectSnapshot[];
};

const BUTTERCLAW_RUNTIME_OBJECTS_ENDPOINT =
  `${API_BASE_URL}/runtime/sessions/integrations/butterclaw/objects`;
const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

const RUNTIME_DETECTION_SOURCE = "runtime-detection" as const;
const RUNTIME_DEMO_SOURCE = "runtime-demo" as const;
const RUNTIME_RESTRICTED_AREA_SOURCE = "runtime-restricted-area" as const;
const RUNTIME_TRAJECTORY_SOURCE = "runtime-trajectory" as const;
const RUNTIME_OBJECT_REFRESH_EVENT = "urdfstudio:runtime-object-refresh";

const clearRuntimeObjectSources = (
  replaceObjectsBySource: ReturnType<typeof useObjectStore.getState>["replaceObjectsBySource"]
) => {
  replaceObjectsBySource(RUNTIME_DETECTION_SOURCE, []);
  replaceObjectsBySource(RUNTIME_DEMO_SOURCE, []);
  replaceObjectsBySource(RUNTIME_RESTRICTED_AREA_SOURCE, []);
  replaceObjectsBySource(RUNTIME_TRAJECTORY_SOURCE, []);
};

const syncButterClawRuntimeObjects = async (
  replaceObjectsBySource: ReturnType<typeof useObjectStore.getState>["replaceObjectsBySource"]
) => {
  const response = await guardedFetch(BUTTERCLAW_RUNTIME_OBJECTS_ENDPOINT, undefined, {
    ...CORE_API_OPTIONS,
    context: "ButterClaw runtime objects",
  });
  if (!response.ok) {
    throw new Error(`ButterClaw runtime object request failed: ${response.status}`);
  }
  const payload = (await response.json()) as ButterClawRuntimeObjectsResponse;
  replaceObjectsBySource(
    RUNTIME_DETECTION_SOURCE,
    payload.objects.map((object) => ({
      label: object.class_label,
      type: "cube" as const,
      position: new THREE.Vector3(...object.position_xyz),
      size: new THREE.Vector3(...object.size_xyz),
      color: object.color_hex,
      trackedJointName: null,
      source: RUNTIME_DETECTION_SOURCE,
      isIkTarget: false,
    }))
  );
  replaceObjectsBySource(RUNTIME_DEMO_SOURCE, []);
  replaceObjectsBySource(RUNTIME_TRAJECTORY_SOURCE, []);
};

const syncRuntimeDemoObjects = (
  replaceObjectsBySource: ReturnType<typeof useObjectStore.getState>["replaceObjectsBySource"],
  selection: ReturnType<typeof readRuntimeDemoTrajectorySelection>,
  restrictedAreaIds: readonly RuntimeDemoRestrictedAreaId[]
) => {
  replaceObjectsBySource(RUNTIME_DEMO_SOURCE, buildRuntimeDemoObjects());
  replaceObjectsBySource(
    RUNTIME_RESTRICTED_AREA_SOURCE,
    buildRuntimeDemoRestrictedAreaObjects(restrictedAreaIds)
  );
  replaceObjectsBySource(
    RUNTIME_TRAJECTORY_SOURCE,
    buildRuntimeDemoTrajectoryObjects(selection)
  );
  replaceObjectsBySource(RUNTIME_DETECTION_SOURCE, []);
};

export const useButterClawRuntimeObjects = ({
  enabled,
  demoMode,
}: {
  enabled: boolean;
  demoMode: boolean;
}) => {
  const replaceObjectsBySource = useObjectStore((state) => state.replaceObjectsBySource);
  const [demoTrajectorySelection, setDemoTrajectorySelection] = useState(() =>
    readRuntimeDemoTrajectorySelection(window.location.search)
  );
  const [demoRestrictedAreaIds, setDemoRestrictedAreaIds] = useState<RuntimeDemoRestrictedAreaId[]>(
    () => [...RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS]
  );
  const [demoSceneReady, setDemoSceneReady] = useState(true);

  useEffect(() => {
    if (!enabled || !demoMode) {
      setDemoSceneReady(false);
      setDemoRestrictedAreaIds([...RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS]);
    }
  }, [demoMode, enabled]);

  useEffect(() => {
    if (!enabled) {
      clearRuntimeObjectSources(replaceObjectsBySource);
      return;
    }

    if (demoMode) {
      if (demoSceneReady) {
        syncRuntimeDemoObjects(
          replaceObjectsBySource,
          demoTrajectorySelection,
          demoRestrictedAreaIds
        );
      } else {
        clearRuntimeObjectSources(replaceObjectsBySource);
      }
      let timeoutId: number | null = null;
      const triggerImmediateDemoRefresh = () => {
        if (!demoSceneReady) {
          return;
        }
        syncRuntimeDemoObjects(
          replaceObjectsBySource,
          demoTrajectorySelection,
          demoRestrictedAreaIds
        );
      };
      const handleDemoScanMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) {
          return;
        }
        if (!isRunRuntimeDemoScanMessage(event.data)) {
          return;
        }
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        clearRuntimeObjectSources(replaceObjectsBySource);
        setDemoTrajectorySelection({ fromLabel: null, toLabel: null });
        setDemoSceneReady(false);
        timeoutId = window.setTimeout(() => {
          setDemoSceneReady(true);
        }, RUNTIME_DEMO_SCAN_DURATION_MS);
      };
      const handleTrajectoryMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) {
          return;
        }
        if (!isSetRuntimeDemoTrajectoryMessage(event.data)) {
          return;
        }
        setDemoTrajectorySelection({
          fromLabel: event.data.fromLabel?.trim() || null,
          toLabel: event.data.toLabel?.trim() || null,
        });
      };
      const handleRestrictedAreaMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) {
          return;
        }
        if (!isSetRuntimeDemoRestrictedAreaMessage(event.data)) {
          return;
        }
        setDemoRestrictedAreaIds(
          Array.isArray(event.data.areaIds)
            ? (event.data.areaIds as RuntimeDemoRestrictedAreaId[])
            : []
        );
      };
      window.addEventListener(RUNTIME_OBJECT_REFRESH_EVENT, triggerImmediateDemoRefresh);
      window.addEventListener("message", handleDemoScanMessage);
      window.addEventListener("message", handleTrajectoryMessage);
      window.addEventListener("message", handleRestrictedAreaMessage);
      return () => {
        window.removeEventListener(RUNTIME_OBJECT_REFRESH_EVENT, triggerImmediateDemoRefresh);
        window.removeEventListener("message", handleDemoScanMessage);
        window.removeEventListener("message", handleTrajectoryMessage);
        window.removeEventListener("message", handleRestrictedAreaMessage);
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        clearRuntimeObjectSources(replaceObjectsBySource);
      };
    }

    let isDisposed = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        await syncButterClawRuntimeObjects(replaceObjectsBySource);
      } catch {
        if (!isDisposed) {
          clearRuntimeObjectSources(replaceObjectsBySource);
        }
      } finally {
        if (!isDisposed) {
          timeoutId = window.setTimeout(
            poll,
            RUNTIME_PREVIEW_BUTTERCLAW_OBJECTS_POLL_INTERVAL_MS
          );
        }
      }
    };

    const triggerImmediateRefresh = () => {
      if (isDisposed) {
        return;
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      void poll();
    };

    void poll();
    window.addEventListener(RUNTIME_OBJECT_REFRESH_EVENT, triggerImmediateRefresh);

    return () => {
      isDisposed = true;
      window.removeEventListener(RUNTIME_OBJECT_REFRESH_EVENT, triggerImmediateRefresh);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      clearRuntimeObjectSources(replaceObjectsBySource);
    };
  }, [
    demoMode,
    demoRestrictedAreaIds,
    demoSceneReady,
    demoTrajectorySelection,
    enabled,
    replaceObjectsBySource,
  ]);
};
