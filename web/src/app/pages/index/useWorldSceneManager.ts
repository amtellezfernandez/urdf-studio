import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import { requireFeatureGate } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { DEMO_AUTOLOAD, DEMO_MODE } from "@/shared/config/demo";
import { DEFAULT_WORLD_LAYOUT_URL } from "@/shared/config/scenes";
import { WORLD_HUB_WEB_BASE_URL } from "@/shared/config/worldHub";
import type { Camera } from "@/shared/types/camera";
import { shouldAutoImportDefaultWorldLayout } from "@/features/world-share/defaultSceneAutoLoadPolicy";
import { WORLD_SCENE_PACKAGE_DEFAULT_VERSION } from "@/features/world-share/worldScenePackageParams";
import {
  WORLD_ROLLOUT_IMPORT_ACCEPT,
  WORLD_ROLLOUT_JOB_MAX_POLLS,
  WORLD_ROLLOUT_JOB_POLL_INTERVAL_MS,
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
import type { WorldScenePublishDraft } from "@/features/world-share/WorldPublishDialog";
import { resolveWorldObjectGeometry, type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
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
  buildWorldRolloutConfigFromDraft,
  buildWorldScenePackageManifestFromState,
  buildWorldRolloutCampaignManifest,
  createWorldRolloutCheckerProfile,
  createWorldRolloutJobFromState,
  createWorldSceneLayerExportDocument,
  downloadWorldRolloutCampaignManifest,
  downloadWorldScenePackageManifest,
  fetchWorldRolloutJob,
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

type UseWorldSceneManagerParams = {
  addCamera: (camera: Omit<Camera, "id">) => void;
  addObject: (
    object: Omit<CreatedObject, "id">,
    options?: { trackHistory?: boolean; select?: boolean }
  ) => void;
  cameras: Camera[];
  clearCameras: () => void;
  clearObjects: () => void;
  hasExplicitWorldImport: boolean;
  hasExplicitWorldLayoutImport: boolean;
  hasLoadedFiles: boolean;
  jointValues: Record<string, number>;
  objects: CreatedObject[];
  originalUrdfContent: string;
  resolvedRobotName: string | null;
  skipDefaultWorldLayoutAutoImportRef: MutableRefObject<boolean>;
  setJointValues: (values: Record<string, number>) => void;
  updateUrdfFile: (content: string, filename?: string) => void;
  vizUrdfContent: string;
  worldImportParams: WorldImportParams;
};

const downloadJsonDocument = (payload: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const readWorldRolloutConfigDraft = (
  defaultCheckerProfile: ReturnType<typeof createWorldRolloutCheckerProfile>
) => {
  const defaultDraft = JSON.stringify(
    {
      checker_profile: defaultCheckerProfile,
      rollout_params: {},
      runner_params: {},
    },
    null,
    2
  );
  const raw = window.prompt("World rollout config JSON", defaultDraft);
  if (raw === null) return null;
  return buildWorldRolloutConfigFromDraft(JSON.parse(raw) as unknown, defaultCheckerProfile);
};

const waitForWorldRolloutJob = async (jobId: string) => {
  let latest = await fetchWorldRolloutJob(jobId);
  for (let pollIndex = 0; pollIndex < WORLD_ROLLOUT_JOB_MAX_POLLS; pollIndex += 1) {
    if (latest.status === "completed" || latest.status === "failed") return latest;
    await new Promise((resolve) => setTimeout(resolve, WORLD_ROLLOUT_JOB_POLL_INTERVAL_MS));
    latest = await fetchWorldRolloutJob(jobId);
  }
  return latest;
};

export const downloadTextDocument = (payload: string, filename: string, mimeType: string) => {
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

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
      return buildWorldScenePackageManifestFromState({
        resolvedRobotName,
        vizUrdfContent,
        originalUrdfContent,
        jointValues,
        cameras,
        objects,
        demoMode: DEMO_MODE,
        overrides,
      });
    },
    [resolvedRobotName, vizUrdfContent, originalUrdfContent, jointValues, cameras, objects]
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

  const toImportedObjectParams = useCallback(
    (object: WorldScenePackageManifest["world_snapshot"]["objects"][number]): Omit<CreatedObject, "id"> => {
      const ikTargetType: NonNullable<CreatedObject["ikTargetType"]> =
        object.ik_target_type === "orbit" ? "orbit" : "punctual";
      const geometry = resolveWorldObjectGeometry({
        type: object.type,
        position: { x: object.position_xyz[0], y: object.position_xyz[1], z: object.position_xyz[2] },
        size: { x: object.size_xyz[0], y: object.size_xyz[1], z: object.size_xyz[2] },
      });
      const importedObject: Omit<CreatedObject, "id"> = {
        type: object.type,
        position: geometry.position,
        rotation: normalizeWorldObjectRotationEuler(
          object.rotation_rpy_rad
            ? {
                x: object.rotation_rpy_rad[0],
                y: object.rotation_rpy_rad[1],
                z: object.rotation_rpy_rad[2],
              }
            : null
        ),
        size: geometry.size,
        color: object.color,
        isHidden: object.is_hidden === true,
        source: object.source ?? "user",
        trackedJointName: object.tracked_joint_name ?? null,
        isIkTarget: object.is_ik_target !== false,
        ikTargetType,
      };
      if (ikTargetType === "orbit") {
        importedObject.orbitRadius = object.orbit_radius;
        importedObject.orbitInclination = object.orbit_inclination_deg;
        importedObject.orbitPhase = object.orbit_phase_deg;
        importedObject.orbitSecondaryOffset = object.orbit_secondary_offset_deg;
        importedObject.orbitTargetPoint = object.orbit_target_point;
      }
      return importedObject;
    },
    []
  );

  const applyWorldSceneObjects = useCallback(
    (sceneObjects: WorldScenePackageManifest["world_snapshot"]["objects"]) => {
      clearObjects();
      sceneObjects.forEach((object) => {
        addObject(toImportedObjectParams(object), {
          trackHistory: false,
          select: false,
        });
      });
    },
    [addObject, clearObjects, toImportedObjectParams]
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

  const handleLoadGeneratedWorldScenePackage = useCallback(
    (manifest: WorldScenePackageManifest) => {
      applyImportedWorldScenePackage(manifest);
      setWorldRegistryOpen(false);
    },
    [applyImportedWorldScenePackage]
  );

  const handlePublishGeneratedWorldScenePackage = useCallback(
    async (manifest: WorldScenePackageManifest) => {
      requireFeatureGate(FEATURE_GATES.worldsRegistry, "Generated world package publish");
      const publish = await publishWorldScenePackage(manifest, "registry");
      toast.success(
        `Published ${publish.package_id}@${publish.version} (${publish.digest_sha256.slice(0, 12)}...)`
      );
      await refreshWorldRegistry();
    },
    [refreshWorldRegistry]
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
    async (worldLayoutUrl: string, contextLabel: string) => {
      const { worldLayout, embeddedCameras } = await readWorldSceneLayerFromUrl(
        worldLayoutUrl,
        contextLabel
      );
      applyImportedWorldSceneLayer(worldLayout);
      if (embeddedCameras > 0) {
        toast.info("World layout includes cameras, but camera state is preserved in world-layout mode.");
      }
    },
    [applyImportedWorldSceneLayer]
  );

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
      await importWorldLayoutFromUrl(DEFAULT_WORLD_LAYOUT_URL, "Default world layout");
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
        await importWorldLayoutFromUrl(DEFAULT_WORLD_LAYOUT_URL, "Default world layout import");
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
    setWorldRolloutReviewOpen,
    worldRolloutReview,
    worldRolloutReviewOpen,
    handleListWorldScenePackages,
    handleLoadGeneratedWorldScenePackage,
    handleLoadWorldScenePackageFromRegistry,
    handleOpenWorldHubBrowser,
    handlePublishCurrentWorldScenePackage,
    handlePublishCurrentWorldScenePackageToHub,
    handlePublishGeneratedWorldScenePackage,
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
