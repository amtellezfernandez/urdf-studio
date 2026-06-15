import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import { requireFeatureGate } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { DEMO_AUTOLOAD, DEMO_MODE } from "@/shared/config/demo";
import { DEFAULT_WORLD_LAYOUT_URL } from "@/shared/config/scenes";
import { WORLD_HUB_WEB_BASE_URL } from "@/shared/config/worldHub";
import type { Camera } from "@/shared/types/camera";
import { shouldAutoImportDefaultWorldLayout } from "@/features/world-share/defaultSceneAutoLoadPolicy";
import {
  WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
  WORLD_SCENE_PACKAGE_DEFAULT_VERSION,
} from "@/features/world-share/worldScenePackageParams";
import {
  WORLD_ROLLOUT_IMPORT_ACCEPT,
} from "@/features/world-share/worldRolloutParams";
import type { WorldSceneLayerSnapshot } from "@/features/world-share/worldSceneManifest";
import type {
  WorldRolloutImportResponse,
} from "@/features/world-share/worldRolloutTypes";
import type {
  WorldScenePackageListEntry,
  WorldScenePackageManifest,
  WorldScenePackageVersionRecord,
} from "@/features/world-share/worldScenePackageTypes";
import { applyWorkspaceChangeSet } from "@/features/world-share/workspaceTransferApi";
import type { WorldScenePublishDraft } from "@/features/world-share/WorldPublishDialog";
import type { CreatedObject } from "@/features/objects";
import {
  APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE,
  isApplyWorldLayoutMessage,
} from "@/shared/contracts/previewBridge";
import {
  DEFAULT_WORLD_SCENE_PACKAGE_TITLE,
  WORLD_SCENE_PACKAGE_IMPORT_ACCEPT,
  createDefaultWorldPublishDraft,
  toWorldRegistryRecordKey,
  type WorldPublishTarget,
} from "@/app/pages/index/indexPageHelpers";
import type { WorldImportParams } from "@/app/pages/index/useIndexPageParams";
import {
  buildWorldScenePackageManifestFromState,
  buildWorldRolloutCampaignManifest,
  createWorldRolloutCheckerProfile,
  createWorldRolloutJobFromState,
  createWorldSceneLayerExportDocument,
  downloadWorldRolloutCampaignManifest,
  downloadWorldScenePackageManifest,
  fetchWorldRegistryPackages,
  fetchWorldScenePackageVersion,
  importWorldRolloutResultPayload,
  parseWorldSceneManifestText,
  publishWorldScenePackage,
  readWorldSceneLayerFromUrl,
  readWorldSceneManifestPayload,
  resolveWorldRolloutImportPayload,
  validateWorldScenePackageLocally,
  validateWorldScenePackageRemotely,
} from "@/app/pages/index/worldSceneRuntime";
import {
  downloadJsonDocument,
  downloadTextDocument,
  readWorldRolloutConfigDraft,
  toImportedObjectParams,
  waitForWorldRolloutJob,
} from "@/app/pages/index/worldSceneManagerHelpers";

type UseWorldSceneManagerParams = {
  addCamera: (camera: Omit<Camera, "id">) => void;
  addObject: (
    object: Omit<CreatedObject, "id"> & Partial<Pick<CreatedObject, "id">>,
    options?: { trackHistory?: boolean; select?: boolean }
  ) => void;
  cameras: Camera[];
  clearCameras: () => void;
  clearObjects: () => void;
  hasExplicitWorldImport: boolean;
  hasExplicitWorldLayoutImport: boolean;
  hasLoadedFiles: boolean;
  jointValues: Record<string, number>;
  getObjectsForTransfer?: () => CreatedObject[];
  objects: CreatedObject[];
  originalUrdfContent: string;
  resolvedRobotName: string | null;
  skipDefaultWorldLayoutAutoImportRef: MutableRefObject<boolean>;
  setJointValues: (values: Record<string, number>) => void;
  updateUrdfFile: (content: string, filename?: string) => void;
  vizUrdfContent: string;
  worldImportParams: WorldImportParams;
};

export { downloadTextDocument };

export const useWorldSceneManager = ({
  addCamera,
  addObject,
  cameras,
  clearCameras,
  clearObjects,
  hasExplicitWorldImport,
  hasExplicitWorldLayoutImport,
  hasLoadedFiles,
  jointValues,
  getObjectsForTransfer,
  objects,
  originalUrdfContent,
  resolvedRobotName,
  skipDefaultWorldLayoutAutoImportRef,
  setJointValues,
  updateUrdfFile,
  vizUrdfContent,
  worldImportParams,
}: UseWorldSceneManagerParams) => {
  const worldImportHandledRef = useRef(false);
  const worldLayoutImportHandledRef = useRef(false);
  const defaultWorldLayoutAppliedRef = useRef(false);
  const objectsRef = useRef(objects);

  const [worldRegistryOpen, setWorldRegistryOpen] = useState(false);
  const [worldRegistryFilterText, setWorldRegistryFilterText] = useState("");
  const [worldRegistryEntries, setWorldRegistryEntries] = useState<WorldScenePackageListEntry[]>([]);
  const [worldRegistryVersionCache, setWorldRegistryVersionCache] = useState<
    Record<string, WorldScenePackageVersionRecord>
  >({});
  const [worldRegistryLoading, setWorldRegistryLoading] = useState(false);
  const [worldPublishDialogOpen, setWorldPublishDialogOpen] = useState(false);
  const [worldPublishTarget, setWorldPublishTarget] = useState<WorldPublishTarget>("registry");
  const [worldPublishDraft, setWorldPublishDraft] = useState<WorldScenePublishDraft>(() =>
    createDefaultWorldPublishDraft(null)
  );
  const [isPublishingWorldPackage, setIsPublishingWorldPackage] = useState(false);
  const [worldLayoutImportDialogOpen, setWorldLayoutImportDialogOpen] = useState(false);
  const [worldLayoutImportUrlDraft, setWorldLayoutImportUrlDraft] = useState("");
  const [isImportingWorldLayout, setIsImportingWorldLayout] = useState(false);
  const [worldRolloutReviewOpen, setWorldRolloutReviewOpen] = useState(false);
  const [worldRolloutReview, setWorldRolloutReview] = useState<WorldRolloutImportResponse | null>(null);
  const [activeWorldSnapshotRef, setActiveWorldSnapshotRef] = useState<{
    package_id: string;
    version: string;
  } | null>(null);

  const buildCurrentWorldScenePackageManifest = useCallback(
    async (
      overrides?: Partial<
        Pick<WorldScenePackageManifest, "package_id" | "title" | "version" | "description">
      >
    ) => {
      const transferObjects = getObjectsForTransfer?.() ?? objectsRef.current;
      objectsRef.current = transferObjects;
      return buildWorldScenePackageManifestFromState({
        resolvedRobotName,
        vizUrdfContent,
        originalUrdfContent,
        jointValues,
        cameras,
        objects: transferObjects,
        demoMode: DEMO_MODE,
        overrides,
      });
    },
    [
      cameras,
      getObjectsForTransfer,
      jointValues,
      originalUrdfContent,
      resolvedRobotName,
      vizUrdfContent,
    ]
  );

  const handleValidateCurrentWorldScenePackage = useCallback(async () => {
    try {
      const manifest = await buildCurrentWorldScenePackageManifest();
      const { combinedErrors, modeLabel } = await validateWorldScenePackageLocally(manifest);
      if (combinedErrors.length > 0) {
        toast.error(`World package invalid: ${combinedErrors.join("; ")}`);
        return;
      }

      if (!FEATURE_GATES.worldsRegistry.enabled) {
        toast.success(`World package valid locally (${modeLabel})`);
        return;
      }

      try {
        const validation = await validateWorldScenePackageRemotely(manifest);
        if (validation.valid) {
          toast.success(
            `World package valid (${modeLabel}, ${validation.digest_sha256.slice(0, 12)}...)`
          );
        } else {
          const remoteErrors =
            validation.errors.length > 0
              ? validation.errors.join("; ")
              : "registry rejected manifest";
          toast.error(`World package invalid in registry: ${remoteErrors}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "registry validation unavailable";
        toast.warning(`Local validation passed (${modeLabel}). Registry check failed: ${message}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to validate world package");
    }
  }, [buildCurrentWorldScenePackageManifest]);

  const handleExportCurrentWorldScenePackage = useCallback(async () => {
    try {
      const manifest = await buildCurrentWorldScenePackageManifest();
      await downloadWorldScenePackageManifest(manifest, downloadJsonDocument);
      toast.success("World package exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export world package");
    }
  }, [buildCurrentWorldScenePackageManifest]);

  const buildWorldRolloutInputs = useCallback(async () => {
    const defaultCheckerProfile = createWorldRolloutCheckerProfile({
      resolvedRobotName,
      params: {},
    });
    const config = readWorldRolloutConfigDraft(defaultCheckerProfile);
    if (!config) return null;
    const worldPackage = await buildCurrentWorldScenePackageManifest();
    return {
      worldPackage,
      checkerProfile: config.checkerProfile,
      rolloutParams: config.rolloutParams,
      runnerParams: config.runnerParams,
    };
  }, [buildCurrentWorldScenePackageManifest, resolvedRobotName]);

  const handleExportWorldRolloutCampaign = useCallback(async () => {
    try {
      const inputs = await buildWorldRolloutInputs();
      if (!inputs) return;
      const campaign = buildWorldRolloutCampaignManifest(inputs);
      downloadWorldRolloutCampaignManifest(campaign, downloadJsonDocument);
      toast.success("World rollout campaign exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export rollout campaign");
    }
  }, [buildWorldRolloutInputs]);

  const handleRunLocalWorldRollout = useCallback(async () => {
    try {
      const inputs = await buildWorldRolloutInputs();
      if (!inputs) return;
      const created = await createWorldRolloutJobFromState(inputs);
      toast.info(`World rollout job started: ${created.job_id}`);
      const completed = await waitForWorldRolloutJob(created.job_id);
      if (completed.status === "failed") {
        toast.error(completed.error || "World rollout job failed");
        return;
      }
      if (completed.status !== "completed") {
        toast.warning(`World rollout job still ${completed.status}: ${completed.job_id}`);
        return;
      }
      toast.success(
        `World rollout completed: ${completed.decision_count} decisions, ${completed.stop_count} stops, ${completed.escalation_count} escalations`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run world rollout");
    }
  }, [buildWorldRolloutInputs]);

  const handleImportWorldRolloutResults = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = WORLD_ROLLOUT_IMPORT_ACCEPT;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      try {
        const payload = resolveWorldRolloutImportPayload(
          await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })))
        );
        const imported = await importWorldRolloutResultPayload(payload);
        setWorldRolloutReview(imported);
        setWorldRolloutReviewOpen(true);
        toast.success(
          `World rollout imported: ${imported.decision_count} decisions, ${imported.stop_count} stops, ${imported.escalation_count} escalations`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import rollout results");
      }
    };
    input.click();
  }, []);

  const handleExportCurrentWorldSceneLayer = useCallback(async () => {
    try {
      const suggestedName = `world-layout-${new Date().toISOString().slice(0, 10)}`;
      const draftName = window.prompt("World layout name", suggestedName);
      if (draftName === null) return;
      const worldLayoutName = draftName.trim();
      if (!worldLayoutName) {
        toast.error("World layout name is required");
        return;
      }
      const { filename, payload } = await createWorldSceneLayerExportDocument(worldLayoutName, objects);
      downloadJsonDocument(payload, filename);
      toast.success(`World layout exported: ${worldLayoutName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export world layout");
    }
  }, [objects]);

  const openWorldPublishDialog = useCallback(
    (target: WorldPublishTarget) => {
      setWorldPublishTarget(target);
      setWorldPublishDraft(createDefaultWorldPublishDraft(resolvedRobotName));
      setWorldPublishDialogOpen(true);
    },
    [resolvedRobotName]
  );

  const handlePublishCurrentWorldScenePackage = useCallback(() => {
    openWorldPublishDialog("registry");
  }, [openWorldPublishDialog]);

  const handlePublishCurrentWorldScenePackageToHub = useCallback(() => {
    openWorldPublishDialog("hub");
  }, [openWorldPublishDialog]);

  const handleSubmitWorldPublishDialog = useCallback(async () => {
    const packageId = worldPublishDraft.packageId.trim();
    if (!packageId) {
      toast.error("Package ID is required");
      return;
    }
    const version = worldPublishDraft.version.trim() || WORLD_SCENE_PACKAGE_DEFAULT_VERSION;
    const title =
      worldPublishDraft.title.trim() || resolvedRobotName || DEFAULT_WORLD_SCENE_PACKAGE_TITLE;
    const description = worldPublishDraft.description.trim() || undefined;

    setIsPublishingWorldPackage(true);
    try {
      if (worldPublishTarget === "hub") {
        requireFeatureGate(FEATURE_GATES.worldsHubRegistry, "URDF Star publish");
      } else {
        requireFeatureGate(FEATURE_GATES.worldsRegistry, "World package publish");
      }
      const manifest = await buildCurrentWorldScenePackageManifest({
        package_id: packageId,
        version,
        title,
        description,
      });
      const publish = await publishWorldScenePackage(manifest, worldPublishTarget);
      const destinationLabel = worldPublishTarget === "hub" ? "Published to URDF Star" : "Published";
      toast.success(
        `${destinationLabel} ${publish.package_id}@${publish.version} (${publish.digest_sha256.slice(0, 12)}...)`
      );
      setWorldPublishDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : worldPublishTarget === "hub"
            ? "Failed to publish to URDF Star"
            : "Failed to publish world package"
      );
    } finally {
      setIsPublishingWorldPackage(false);
    }
  }, [buildCurrentWorldScenePackageManifest, resolvedRobotName, worldPublishDraft, worldPublishTarget]);

  const handleImportWorldLayoutFromUrl = useCallback(() => {
    setWorldLayoutImportUrlDraft("");
    setWorldLayoutImportDialogOpen(true);
  }, []);

  const handleOpenWorldHubBrowser = useCallback(() => {
    const target = WORLD_HUB_WEB_BASE_URL || "https://urdf-star.vercel.app/worlds";
    window.open(target, "_blank", "noopener,noreferrer");
  }, []);

  const applyCreatedObjects = useCallback(
    (nextObjects: CreatedObject[]) => {
      objectsRef.current = nextObjects;
      clearObjects();
      nextObjects.forEach((object) => {
        addObject(object, {
          trackHistory: false,
          select: false,
        });
      });
    },
    [addObject, clearObjects]
  );

  const applyWorldSceneObjects = useCallback(
    (sceneObjects: WorldScenePackageManifest["world_snapshot"]["objects"]) => {
      const nextObjects = sceneObjects.map((object) => ({
        id: object.id,
        ...toImportedObjectParams(object),
      }));
      applyCreatedObjects(nextObjects);
    },
    [applyCreatedObjects]
  );

  const applyImportedWorldSceneLayer = useCallback(
    (worldLayout: WorldSceneLayerSnapshot) => {
      applyWorldSceneObjects(worldLayout.objects);
      setActiveWorldSnapshotRef(null);
    },
    [applyWorldSceneObjects, setActiveWorldSnapshotRef]
  );

  const applyImportedWorldScenePackage = useCallback(
    (manifest: WorldScenePackageManifest) => {
      const snapshot = manifest.world_snapshot;
      updateUrdfFile(snapshot.urdf_xml, `${manifest.package_id}-${manifest.version}.urdf`);
      clearCameras();
      snapshot.cameras.forEach((camera) => {
        addCamera({
          name: camera.name,
          parent_joint: camera.parent_joint,
          pose: camera.pose,
          intrinsics: camera.intrinsics,
        });
      });
      applyWorldSceneObjects(snapshot.objects);
      setJointValues(snapshot.joint_positions);
      setActiveWorldSnapshotRef({
        package_id: manifest.package_id,
        version: manifest.version,
      });
      toast.success(`Loaded world package ${manifest.package_id}@${manifest.version}`);
    },
    [
      addCamera,
      applyWorldSceneObjects,
      clearCameras,
      setActiveWorldSnapshotRef,
      setJointValues,
      updateUrdfFile,
    ]
  );

  const handleImportWorldScenePackage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = WORLD_SCENE_PACKAGE_IMPORT_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const raw = await file.text();
        const manifest = await parseWorldSceneManifestText(raw);
        applyImportedWorldScenePackage(manifest);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import world package");
      }
    };
    input.click();
  }, [applyImportedWorldScenePackage]);

  const handleImportWorkspaceChangeSet = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = WORLD_SCENE_PACKAGE_IMPORT_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const currentWorldPackage = await buildCurrentWorldScenePackageManifest();
        const changeSet = JSON.parse(await file.text()) as unknown;
        const applied = await applyWorkspaceChangeSet(currentWorldPackage, changeSet);
        applyWorldSceneObjects(applied.world_package.world_snapshot.objects);
        setActiveWorldSnapshotRef(null);
        const reviewOnly =
          applied.reviewOnlyCount > 0 ? `, ${applied.reviewOnlyCount} review-only` : "";
        toast.success(
          `Imported workspace changes: ${applied.appliedChangeCount} object changes${reviewOnly}`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import workspace changes");
      }
    };
    input.click();
  }, [applyWorldSceneObjects, buildCurrentWorldScenePackageManifest, setActiveWorldSnapshotRef]);

  const refreshWorldRegistry = useCallback(async () => {
    try {
      requireFeatureGate(FEATURE_GATES.worldsRegistry, "World registry refresh");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "World registry unavailable");
      return;
    }
    setWorldRegistryLoading(true);
    try {
      const worlds = await fetchWorldRegistryPackages();
      setWorldRegistryEntries(worlds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh world registry");
    } finally {
      setWorldRegistryLoading(false);
    }
  }, []);

  const handleLoadWorldScenePackageFromRegistry = useCallback(
    async (entry: WorldScenePackageListEntry) => {
      try {
        requireFeatureGate(FEATURE_GATES.worldsRegistry, "World registry load");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "World package load unavailable");
        return;
      }
      const cacheKey = toWorldRegistryRecordKey(entry.package_id, entry.latest_version);
      const cached = worldRegistryVersionCache[cacheKey];
      if (cached) {
        applyImportedWorldScenePackage(cached.manifest);
        setWorldRegistryOpen(false);
        return;
      }
      try {
        const record = await fetchWorldScenePackageVersion(entry.package_id, entry.latest_version);
        setWorldRegistryVersionCache((previous) => ({ ...previous, [cacheKey]: record }));
        applyImportedWorldScenePackage(record.manifest);
        setWorldRegistryOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load world package");
      }
    },
    [applyImportedWorldScenePackage, worldRegistryVersionCache]
  );

  const handleListWorldScenePackages = useCallback(async () => {
    try {
      requireFeatureGate(FEATURE_GATES.worldsRegistry, "World registry");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "World registry unavailable");
      return;
    }
    setWorldRegistryOpen(true);
    if (worldRegistryLoading) return;
    await refreshWorldRegistry();
  }, [refreshWorldRegistry, worldRegistryLoading]);

  const importWorldLayoutFromUrl = useCallback(
    async (
      worldLayoutUrl: string,
      contextLabel: string,
      options: { sourceOverride?: NonNullable<CreatedObject["source"]> } = {}
    ) => {
      const { worldLayout, embeddedCameras } = await readWorldSceneLayerFromUrl(
        worldLayoutUrl,
        contextLabel
      );
      applyImportedWorldSceneLayer({
        ...worldLayout,
        objects: worldLayout.objects.map((object) => ({
          ...object,
          source: options.sourceOverride ?? object.source,
        })),
      });
      if (embeddedCameras > 0) {
        toast.info("World layout includes cameras, but camera state is preserved in world-layout mode.");
      }
    },
    [applyImportedWorldSceneLayer]
  );

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const handleImportWorldLayoutFromLinkDialog = useCallback(async () => {
    setIsImportingWorldLayout(true);
    try {
      await importWorldLayoutFromUrl(worldLayoutImportUrlDraft, "World layout import link");
      setWorldLayoutImportDialogOpen(false);
      setWorldLayoutImportUrlDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import world layout");
    } finally {
      setIsImportingWorldLayout(false);
    }
  }, [importWorldLayoutFromUrl, worldLayoutImportUrlDraft]);

  const handleImportDefaultWorldLayoutFromDialog = useCallback(async () => {
    setIsImportingWorldLayout(true);
    try {
      await importWorldLayoutFromUrl(DEFAULT_WORLD_LAYOUT_URL, "Default world layout", {
        sourceOverride: WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
      });
      setWorldLayoutImportDialogOpen(false);
      setWorldLayoutImportUrlDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import default world layout");
    } finally {
      setIsImportingWorldLayout(false);
    }
  }, [importWorldLayoutFromUrl]);

  const handleImportWorldLayoutFromEntry = useCallback(
    async (worldLayoutUrl: string) => {
      await importWorldLayoutFromUrl(worldLayoutUrl, "World layout import link");
    },
    [importWorldLayoutFromUrl]
  );

  const ensureWorldLayoutForTransfer = useCallback(async () => {
    if (
      objectsRef.current.some(
        (object) => object.source === WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE
      )
    ) {
      return;
    }
    if (
      (hasExplicitWorldImport || hasExplicitWorldLayoutImport) &&
      objectsRef.current.length > 0
    ) {
      return;
    }
    const { worldLayout } = await readWorldSceneLayerFromUrl(
      DEFAULT_WORLD_LAYOUT_URL,
      "Default world layout transfer"
    );
    const layoutObjects = worldLayout.objects.map((object) => ({
      id: object.id,
      ...toImportedObjectParams({
        ...object,
        source: WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
      }),
    }));
    if (layoutObjects.length === 0) return;
    const layoutIds = new Set(layoutObjects.map((object) => object.id));
    const preservedObjects = objectsRef.current.filter(
      (object) =>
        object.source !== WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE &&
        !layoutIds.has(object.id)
    );
    applyCreatedObjects([...preservedObjects, ...layoutObjects]);
  }, [
    applyCreatedObjects,
    hasExplicitWorldImport,
    hasExplicitWorldLayoutImport,
  ]);

  useEffect(() => {
    if (worldImportHandledRef.current || !hasExplicitWorldImport) return;
    worldImportHandledRef.current = true;
    const loadFromLink = async () => {
      try {
        let manifest: WorldScenePackageManifest | null = null;
        if (worldImportParams.importUrl) {
          const response = await fetch(worldImportParams.importUrl, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            throw new Error(`Import link failed (HTTP ${response.status})`);
          }
          manifest = await readWorldSceneManifestPayload(await response.json());
        } else if (worldImportParams.packageId && worldImportParams.version) {
          const record = await fetchWorldScenePackageVersion(
            worldImportParams.packageId,
            worldImportParams.version
          );
          manifest = record.manifest;
        }
        if (!manifest) {
          throw new Error("Import link did not contain a valid world package manifest.");
        }
        applyImportedWorldScenePackage(manifest);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import world link");
      }
    };
    void loadFromLink();
  }, [applyImportedWorldScenePackage, hasExplicitWorldImport, worldImportParams]);

  useEffect(() => {
    if (worldLayoutImportHandledRef.current || !hasExplicitWorldLayoutImport) return;
    worldLayoutImportHandledRef.current = true;
    const loadWorldLayoutFromLink = async () => {
      try {
        await importWorldLayoutFromUrl(
          worldImportParams.worldLayoutImportUrl,
          "World layout import link"
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import world layout");
      }
    };
    void loadWorldLayoutFromLink();
  }, [hasExplicitWorldLayoutImport, importWorldLayoutFromUrl, worldImportParams.worldLayoutImportUrl]);

  useEffect(() => {
    if (skipDefaultWorldLayoutAutoImportRef.current) return;
    const shouldAutoLoad = shouldAutoImportDefaultWorldLayout({
      alreadyApplied: defaultWorldLayoutAppliedRef.current,
      hasLoadedFiles,
      defaultWorldLayoutUrl: DEFAULT_WORLD_LAYOUT_URL,
      demoMode: DEMO_MODE,
      demoAutoload: DEMO_AUTOLOAD,
      hasExplicitWorldImport,
      hasExplicitWorldLayoutImport,
    });
    if (!shouldAutoLoad) return;
    defaultWorldLayoutAppliedRef.current = true;
    void (async () => {
      try {
        await importWorldLayoutFromUrl(DEFAULT_WORLD_LAYOUT_URL, "Default world layout import", {
          sourceOverride: WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
        });
      } catch (error) {
        toast.warning(
          error instanceof Error
            ? `Default world layout unavailable: ${error.message}`
            : "Default world layout unavailable"
        );
      }
    })();
  }, [
    hasExplicitWorldImport,
    hasExplicitWorldLayoutImport,
    hasLoadedFiles,
    importWorldLayoutFromUrl,
    skipDefaultWorldLayoutAutoImportRef,
  ]);

  useEffect(() => {
    const postWorldLayoutResult = (
      target: MessageEventSource | null,
      origin: string,
      requestId: string | undefined,
      ok: boolean,
      message: string
    ) => {
      if (!target || typeof (target as Window).postMessage !== "function") {
        return;
      }
      (target as Window).postMessage(
        { type: APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE, requestId, ok, message },
        origin === "null" ? "*" : origin
      );
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin && event.origin !== "null") return;
      if (!isApplyWorldLayoutMessage(event.data)) return;

      const requestId = event.data.requestId;
      const worldLayoutUrl =
        typeof event.data.worldLayoutUrl === "string" ? event.data.worldLayoutUrl.trim() : "";
      if (!worldLayoutUrl) {
        postWorldLayoutResult(event.source, event.origin, requestId, false, "World layout URL is required.");
        return;
      }

      void (async () => {
        try {
          await importWorldLayoutFromUrl(worldLayoutUrl, "World layout message");
          postWorldLayoutResult(event.source, event.origin, requestId, true, "World layout applied.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to import world layout";
          postWorldLayoutResult(event.source, event.origin, requestId, false, message);
        }
      })();
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [importWorldLayoutFromUrl]);

  return {
    activeWorldSnapshotRef,
    buildCurrentWorldScenePackageManifest,
    ensureWorldLayoutForTransfer,
    handleExportCurrentWorldSceneLayer,
    handleExportCurrentWorldScenePackage,
    handleImportDefaultWorldLayoutFromDialog,
    handleImportWorldLayoutFromEntry,
    handleImportWorldLayoutFromLinkDialog,
    handleImportWorldLayoutFromUrl,
    handleImportWorldScenePackage,
    handleExportWorldRolloutCampaign,
    handleRunLocalWorldRollout,
    handleImportWorldRolloutResults,
    handleImportWorkspaceChangeSet,
    setWorldRolloutReviewOpen,
    worldRolloutReview,
    worldRolloutReviewOpen,
    handleListWorldScenePackages,
    handleLoadWorldScenePackageFromRegistry,
    handleOpenWorldHubBrowser,
    handlePublishCurrentWorldScenePackage,
    handlePublishCurrentWorldScenePackageToHub,
    handleSubmitWorldPublishDialog,
    handleValidateCurrentWorldScenePackage,
    isImportingWorldLayout,
    isPublishingWorldPackage,
    refreshWorldRegistry,
    setWorldLayoutImportDialogOpen,
    setWorldLayoutImportUrlDraft,
    setIsImportingWorldLayout,
    setWorldPublishDialogOpen,
    setWorldPublishDraft,
    setWorldRegistryFilterText,
    setWorldRegistryOpen,
    publishTargetLabel:
      worldPublishTarget === "hub" ? "URDF Star Hub" : "World Registry",
    worldLayoutImportDialogOpen,
    worldLayoutImportUrlDraft,
    worldPublishDialogOpen,
    worldPublishDraft,
    worldPublishTarget,
    worldRegistryEntries,
    worldRegistryFilterText,
    worldRegistryLoading,
    worldRegistryOpen,
  };
};
