import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { DEMO_AUTOLOAD, DEMO_MODE } from "@/shared/config/demo";
import { DEFAULT_WORLD_LAYOUT_URL } from "@/shared/config/scenes";
import { WORLD_HUB_WEB_BASE_URL } from "@/shared/config/worldHub";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import type { Camera } from "@/shared/types/camera";
import { shouldAutoImportDefaultWorldLayout } from "@/features/world-share/defaultSceneAutoLoadPolicy";
import {
  WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
} from "@/features/world-share/worldScenePackageParams";
import type { WorldSceneLayerSnapshot } from "@/features/world-share/worldSceneManifest";
import type {
  WorldScenePackageManifest,
} from "@/features/world-share/worldScenePackageTypes";
import { applyWorkspaceChangeSet } from "@/features/world-share/workspaceTransferApi";
import type { CreatedObject } from "@/features/objects";
import {
  isTrustedWorldLayoutBridgeOrigin,
  postWorldLayoutBridgeResult,
  readWorldLayoutBridgeRequest,
} from "@/app/pages/index/worldSceneManagerBridge";
import {
  WORLD_SCENE_PACKAGE_IMPORT_ACCEPT,
} from "@/app/pages/index/indexPageHelpers";
import type { WorldImportParams } from "@/app/pages/index/useIndexPageParams";
import {
  buildWorldScenePackageManifestFromState,
  createWorldSceneLayerExportDocument,
  downloadWorldScenePackageManifest,
  loadWorldScenePackageFromImportParams,
  parseWorldSceneManifestText,
  readWorldSceneLayerFromUrl,
  validateWorldScenePackageLocally,
  validateWorldScenePackageRemotely,
} from "@/app/pages/index/worldSceneRuntime";
import {
  downloadJsonDocument,
  downloadTextDocument,
  openFileSelectionDialog,
  applyWorldSceneLayerObjectSourceOverride,
  toImportedCreatedObjects,
  toImportedWorldSceneCameras,
  type MeshUriResolutionContext,
} from "@/app/pages/index/worldSceneManagerHelpers";
import { useWorldPublishController } from "@/app/pages/index/useWorldPublishController";
import { useWorldRegistryController } from "@/app/pages/index/useWorldRegistryController";
import { useWorldRolloutController } from "@/app/pages/index/useWorldRolloutController";

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
  suppressDefaultWorldLayoutAutoImport?: boolean;
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
  suppressDefaultWorldLayoutAutoImport = false,
  setJointValues,
  updateUrdfFile,
  vizUrdfContent,
  worldImportParams,
}: UseWorldSceneManagerParams) => {
  const worldImportHandledRef = useRef(false);
  const worldLayoutImportHandledRef = useRef(false);
  const defaultWorldLayoutAppliedRef = useRef(false);
  const objectsRef = useRef(objects);

  const [worldLayoutImportDialogOpen, setWorldLayoutImportDialogOpen] = useState(false);
  const [worldLayoutImportUrlDraft, setWorldLayoutImportUrlDraft] = useState("");
  const [isImportingWorldLayout, setIsImportingWorldLayout] = useState(false);
  const [worldScenePackageImportDialogOpen, setWorldScenePackageImportDialogOpen] =
    useState(false);
  const [isImportingWorldScenePackage, setIsImportingWorldScenePackage] = useState(false);
  const [activeWorldSnapshotRef, setActiveWorldSnapshotRef] = useState<{
    package_id: string;
    version: string;
  } | null>(null);

  const closeWorldLayoutImportDialog = useCallback(() => {
    setWorldLayoutImportDialogOpen(false);
    setWorldLayoutImportUrlDraft("");
  }, []);

  const closeWorldScenePackageImportDialog = useCallback(() => {
    setWorldScenePackageImportDialogOpen(false);
  }, []);

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
        const message = readUnknownErrorMessage(error, "registry validation unavailable");
        toast.warning(`Local validation passed (${modeLabel}). Registry check failed: ${message}`);
      }
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to validate world package"));
    }
  }, [buildCurrentWorldScenePackageManifest]);

  const handleExportCurrentWorldScenePackage = useCallback(async () => {
    try {
      const manifest = await buildCurrentWorldScenePackageManifest();
      await downloadWorldScenePackageManifest(manifest, downloadJsonDocument);
      toast.success("World package exported");
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to export world package"));
    }
  }, [buildCurrentWorldScenePackageManifest]);

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
      const manifest = await buildCurrentWorldScenePackageManifest({
        title: worldLayoutName,
      });
      const includeRobotState = window.confirm(
        "Include robot state, joint positions, and cameras in the world layout export?"
      );
      const { filename, payload } = await createWorldSceneLayerExportDocument(
        worldLayoutName,
        manifest,
        { includeRobotState }
      );
      downloadJsonDocument(payload, filename);
      toast.success(`World layout exported: ${worldLayoutName}`);
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to export world layout"));
    }
  }, [buildCurrentWorldScenePackageManifest]);

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
    (
      sceneObjects: WorldScenePackageManifest["world_snapshot"]["objects"],
      meshUriContext?: MeshUriResolutionContext
    ) => {
      applyCreatedObjects(toImportedCreatedObjects(sceneObjects, meshUriContext));
    },
    [applyCreatedObjects]
  );

  const applyImportedWorldSceneLayer = useCallback(
    (worldLayout: WorldSceneLayerSnapshot, meshUriContext?: MeshUriResolutionContext) => {
      applyWorldSceneObjects(worldLayout.objects, meshUriContext);
      setActiveWorldSnapshotRef(null);
    },
    [applyWorldSceneObjects, setActiveWorldSnapshotRef]
  );

  const applyImportedWorldScenePackage = useCallback(
    (manifest: WorldScenePackageManifest) => {
      const snapshot = manifest.world_snapshot;
      updateUrdfFile(snapshot.urdf_xml, `${manifest.package_id}-${manifest.version}.urdf`);
      clearCameras();
      toImportedWorldSceneCameras(snapshot.cameras).forEach((camera) => {
        addCamera(camera);
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
    setWorldScenePackageImportDialogOpen(true);
  }, []);

  const handleImportWorldScenePackageFromFileDialog = useCallback(() => {
    openFileSelectionDialog({
      accept: WORLD_SCENE_PACKAGE_IMPORT_ACCEPT,
      onFiles: async ([file]) => {
        if (!file) return;
        setIsImportingWorldScenePackage(true);
        try {
          const raw = await file.text();
          const manifest = await parseWorldSceneManifestText(raw);
          applyImportedWorldScenePackage(manifest);
          closeWorldScenePackageImportDialog();
        } catch (error) {
          toast.error(readUnknownErrorMessage(error, "Failed to import world package"));
        } finally {
          setIsImportingWorldScenePackage(false);
        }
      },
    });
  }, [applyImportedWorldScenePackage, closeWorldScenePackageImportDialog]);

  const handleImportWorkspaceChangeSet = useCallback(() => {
    openFileSelectionDialog({
      accept: WORLD_SCENE_PACKAGE_IMPORT_ACCEPT,
      onFiles: async ([file]) => {
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
          toast.error(readUnknownErrorMessage(error, "Failed to import workspace changes"));
        }
      },
    });
  }, [applyWorldSceneObjects, buildCurrentWorldScenePackageManifest, setActiveWorldSnapshotRef]);

  const {
    handlePublishCurrentWorldScenePackage,
    handlePublishCurrentWorldScenePackageToHub,
    handleSubmitWorldPublishDialog,
    isPublishingWorldPackage,
    publishTargetLabel,
    setWorldPublishDialogOpen,
    setWorldPublishDraft,
    worldPublishDialogOpen,
    worldPublishDraft,
    worldPublishTarget,
  } = useWorldPublishController({
    buildCurrentWorldScenePackageManifest,
    resolvedRobotName,
  });

  const {
    handleListWorldScenePackages,
    handleLoadWorldScenePackageFromRegistry,
    refreshWorldRegistry,
    setWorldRegistryFilterText,
    setWorldRegistryOpen,
    worldRegistryEntries,
    worldRegistryFilterText,
    worldRegistryLoading,
    worldRegistryOpen,
  } = useWorldRegistryController({
    applyWorldScenePackage: applyImportedWorldScenePackage,
  });

  const {
    handleExportWorldRolloutCampaign,
    handleImportWorldRolloutResults,
    handleRunLocalWorldRollout,
    setWorldRolloutReviewOpen,
    worldRolloutReview,
    worldRolloutReviewOpen,
  } = useWorldRolloutController({
    buildCurrentWorldScenePackageManifest,
    resolvedRobotName,
  });

  const importWorldLayoutFromUrl = useCallback(
    async (
      worldLayoutUrl: string,
      contextLabel: string,
      options: {
        meshUriAssetMap?: Record<string, string>;
        sourceOverride?: NonNullable<CreatedObject["source"]>;
      } = {}
    ) => {
      const { worldLayout, embeddedCameras, baseUrl } = await readWorldSceneLayerFromUrl(
        worldLayoutUrl,
        contextLabel
      );
      applyImportedWorldSceneLayer(
        applyWorldSceneLayerObjectSourceOverride(worldLayout, options.sourceOverride),
        {
          assetMap: options.meshUriAssetMap,
          baseUrl,
        }
      );
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
      closeWorldLayoutImportDialog();
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to import world layout"));
    } finally {
      setIsImportingWorldLayout(false);
    }
  }, [closeWorldLayoutImportDialog, importWorldLayoutFromUrl, worldLayoutImportUrlDraft]);

  const handleImportDefaultWorldLayoutFromDialog = useCallback(async () => {
    setIsImportingWorldLayout(true);
    try {
      await importWorldLayoutFromUrl(DEFAULT_WORLD_LAYOUT_URL, "Default world layout", {
        sourceOverride: WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
      });
      closeWorldLayoutImportDialog();
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to import default world layout"));
    } finally {
      setIsImportingWorldLayout(false);
    }
  }, [closeWorldLayoutImportDialog, importWorldLayoutFromUrl]);

  const handleImportWorldLayoutFromEntry = useCallback(
    async (worldLayoutUrl: string, options?: { meshUriAssetMap?: Record<string, string> }) => {
      await importWorldLayoutFromUrl(worldLayoutUrl, "World layout import link", options);
    },
    [importWorldLayoutFromUrl]
  );

  useEffect(() => {
    if (worldImportHandledRef.current || !hasExplicitWorldImport) return;
    worldImportHandledRef.current = true;
    const loadFromLink = async () => {
      try {
        const manifest = await loadWorldScenePackageFromImportParams(worldImportParams);
        applyImportedWorldScenePackage(manifest);
      } catch (error) {
        toast.error(readUnknownErrorMessage(error, "Failed to import world link"));
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
        toast.error(readUnknownErrorMessage(error, "Failed to import world layout"));
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
      suppressAutoImport: suppressDefaultWorldLayoutAutoImport,
    });
    if (!shouldAutoLoad) return;
    defaultWorldLayoutAppliedRef.current = true;
    void (async () => {
      try {
        await importWorldLayoutFromUrl(DEFAULT_WORLD_LAYOUT_URL, "Default world layout import", {
          sourceOverride: WORLD_SCENE_PACKAGE_DEFAULT_LAYOUT_OBJECT_SOURCE,
        });
      } catch (error) {
        const unavailableMessage = "Default world layout unavailable";
        const errorMessage = readUnknownErrorMessage(error, unavailableMessage);
        toast.warning(
          errorMessage === unavailableMessage
            ? unavailableMessage
            : `${unavailableMessage}: ${errorMessage}`
        );
      }
    })();
  }, [
    hasExplicitWorldImport,
    hasExplicitWorldLayoutImport,
    hasLoadedFiles,
    importWorldLayoutFromUrl,
    resolvedRobotName,
    skipDefaultWorldLayoutAutoImportRef,
    suppressDefaultWorldLayoutAutoImport,
  ]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isTrustedWorldLayoutBridgeOrigin(event.origin, window.location.origin)) return;
      const bridgeRequest = readWorldLayoutBridgeRequest(event.data);
      if (!bridgeRequest) return;
      if (bridgeRequest.kind === "invalid") {
        postWorldLayoutBridgeResult({
          target: event.source,
          origin: event.origin,
          requestId: bridgeRequest.requestId,
          ok: false,
          message: bridgeRequest.message,
        });
        return;
      }

      void (async () => {
        try {
          await importWorldLayoutFromUrl(bridgeRequest.worldLayoutUrl, "World layout message");
          postWorldLayoutBridgeResult({
            target: event.source,
            origin: event.origin,
            requestId: bridgeRequest.requestId,
            ok: true,
            message: "World layout applied.",
          });
        } catch (error) {
          const message = readUnknownErrorMessage(error, "Failed to import world layout");
          postWorldLayoutBridgeResult({
            target: event.source,
            origin: event.origin,
            requestId: bridgeRequest.requestId,
            ok: false,
            message,
          });
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
    handleExportCurrentWorldSceneLayer,
    handleExportCurrentWorldScenePackage,
    handleImportDefaultWorldLayoutFromDialog,
    handleImportWorldLayoutFromEntry,
    handleImportWorldLayoutFromLinkDialog,
    handleImportWorldLayoutFromUrl,
    handleImportWorldScenePackage,
    handleImportWorldScenePackageFromFileDialog,
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
    isImportingWorldScenePackage,
    isPublishingWorldPackage,
    refreshWorldRegistry,
    setWorldScenePackageImportDialogOpen,
    setWorldLayoutImportDialogOpen,
    setWorldLayoutImportUrlDraft,
    setIsImportingWorldLayout,
    setWorldPublishDialogOpen,
    setWorldPublishDraft,
    setWorldRegistryFilterText,
    setWorldRegistryOpen,
    publishTargetLabel,
    worldScenePackageImportDialogOpen,
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
