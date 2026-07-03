import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  analyzeUrdfDocument,
  type ParsedSensor,
  type UrdfAnalysis,
} from "@/shared/lib/urdfCore";
import {
  isSupportedMeshResource,
  isXacroPath,
  normalizeExpandedUrdfPath,
} from "@/shared/lib/urdfCore";
import {
  normalizeMeshPathForMatch,
  parseURDF,
  type JointAxisMap,
  type JointLimits,
} from "@/shared/lib/urdfBrowser";
import { findAutoEndEffectorLinksFromAnalysis } from "@/features/layout/page/utils";
import { DEFAULT_URDF_FILENAME } from "@/features/layout/page/constants";
import type { DebugMeshInfo, MeshFiles } from "@/shared/types/feature";
import {
  collectXacroSupportFiles,
  expandXacro,
} from "@/features/urdf/xacro/xacroClient";
import { aliasRepeatedLinkMeshFiles } from "@/features/urdf/loader/repeatedMeshAlias";
import type { LoadUrdfTextOptions } from "@/features/urdf/loader/urdfLoaderTypes";
import { formatUrdfMeshLoadDiagnostics } from "@/features/urdf/loader/urdfLoaderDiagnostics";
import {
  summarizeUrdfLoadIssues,
  type UrdfLoadIssueSummary,
} from "@/features/urdf/loader/urdfLoadIssues";
import { buildDebugMeshInfo } from "@/features/urdf/loader/urdfMeshDebugInfo";
import {
  getFileRelativePath,
  indexMeshResources,
} from "@/features/urdf/loader/urdfMeshIndex";
import {
  createExpandedXacroUrdfFile,
  createLoadedUrdfFile,
} from "@/features/urdf/loader/urdfFileFactory";
import {
  buildPackageRootsFromFiles,
  getBasePathFromRelativePath,
  readUrdfDocumentsFromFiles,
} from "@/features/urdf/loader/urdfLoaderFiles";

type UseUrdfLoaderOptions = {
  onClearSelection?: () => void;
  onAutoSelectEndEffector?: (link: string | null) => void;
};

type HydrateLoadedAssetsOptions = {
  activePath?: string | null;
  shouldApply?: () => boolean;
  urdfContent?: string;
};

type ApplyLoadedUrdfStateParams = {
  activePath: string;
  analysis: UrdfAnalysis;
  autoEndEffector: string | null;
  basePath: string;
  debugMeshInfo: DebugMeshInfo[];
  filename: string;
  issueSummary: UrdfLoadIssueSummary;
  jointAxes: JointAxisMap;
  meshFiles: MeshFiles;
  packageRoots: Record<string, string[]>;
  sensors: ParsedSensor[];
  urdfContent: string;
  urdfDocuments: Record<string, string>;
  validationError: string | null;
};

export const useUrdfLoader = (options: UseUrdfLoaderOptions = {}) => {
  const [urdfLoadRevision, setUrdfLoadRevision] = useState(0);
  const [urdfFile, setUrdfFile] = useState<File | null>(null);
  const [activeUrdfPath, setActiveUrdfPath] = useState<string | null>(null);
  const [urdfDocuments, setUrdfDocuments] = useState<Record<string, string>>({});
  const [meshFiles, setMeshFiles] = useState<MeshFiles>({});
  const [urdfBasePath, setUrdfBasePath] = useState<string>("");
  const [packageRoots, setPackageRoots] = useState<Record<string, string[]>>({});
  const [sensors, setSensors] = useState<ParsedSensor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedFiles, setHasLoadedFiles] = useState(false);
  const [jointLimits, setJointLimits] = useState<JointLimits>({});
  const [jointAxes, setJointAxes] = useState<JointAxisMap>({});
  const [originalJointAxes, setOriginalJointAxes] = useState<JointAxisMap>({});
  const [availableLinks, setAvailableLinks] = useState<string[]>([]);
  const [originalUrdfContent, setOriginalUrdfContent] = useState<string>("");
  const [vizUrdfContent, setVizUrdfContent] = useState<string>("");
  const [originalVizUrdfContent, setOriginalVizUrdfContent] = useState<string>("");
  const [savedVizUrdfContent, setSavedVizUrdfContent] = useState<string>("");
  const [debugMeshInfo, setDebugMeshInfo] = useState<DebugMeshInfo[]>([]);
  const [unmatchedURDFRefs, setUnmatchedURDFRefs] = useState<string[]>([]);
  const [absoluteFileMeshRefs, setAbsoluteFileMeshRefs] = useState<string[]>([]);
  const [urdfAnalysis, setUrdfAnalysis] = useState<UrdfAnalysis | null>(null);
  const [urdfValidationError, setUrdfValidationError] = useState<string | null>(null);
  const [showLoadIssues, setShowLoadIssues] = useState(false);
  const [missingPackageRefs, setMissingPackageRefs] = useState<string[]>([]);

  const createUrdfFile = useCallback(
    (content: string, filename = DEFAULT_URDF_FILENAME, timestamp?: number): File =>
      createLoadedUrdfFile(content, filename, timestamp),
    []
  );

  const updateUrdfFile = useCallback(
    (content: string, filename = DEFAULT_URDF_FILENAME) => {
      const parsed = parseURDF(content);
      const analysis = analyzeUrdfDocument(parsed.document);
      const issueSummary = summarizeUrdfLoadIssues({
        analysis,
        packageRoots,
        meshFiles,
        parsedIsValid: parsed.isValid,
        urdfBasePath,
      });
      setVizUrdfContent(content);
      setJointLimits(analysis.jointLimits);
      setJointAxes(analysis.jointAxes);
      setAvailableLinks(analysis.linkNames);
      setSensors(analysis.sensors);
      setUrdfAnalysis(analysis);
      setUrdfValidationError(parsed.isValid ? null : parsed.error ?? "Invalid URDF");
      setUrdfFile(createUrdfFile(content, filename));
      if (activeUrdfPath) {
        const normalizedActivePath = normalizeMeshPathForMatch(activeUrdfPath) || activeUrdfPath;
        setUrdfDocuments((previous) => ({
          ...previous,
          [normalizedActivePath]: content,
        }));
      }
      setMissingPackageRefs(issueSummary.missingPackages);
      setUnmatchedURDFRefs(issueSummary.unmatchedRefs);
      setAbsoluteFileMeshRefs(issueSummary.absoluteFileRefs);
      setShowLoadIssues(issueSummary.hasIssues);
    },
    [activeUrdfPath, createUrdfFile, meshFiles, packageRoots, urdfBasePath]
  );

  const { onAutoSelectEndEffector, onClearSelection } = options;
  const advanceUrdfLoadRevision = useCallback(() => {
    setUrdfLoadRevision((current) => current + 1);
  }, []);
  const applyLoadedUrdfState = useCallback(
    ({
      activePath,
      analysis,
      autoEndEffector,
      basePath,
      debugMeshInfo,
      filename,
      issueSummary,
      jointAxes: nextJointAxes,
      meshFiles: nextMeshFiles,
      packageRoots: nextPackageRoots,
      sensors: nextSensors,
      urdfContent,
      urdfDocuments: nextUrdfDocuments,
      validationError,
    }: ApplyLoadedUrdfStateParams) => {
      setUrdfBasePath(basePath);
      setUrdfDocuments(nextUrdfDocuments);
      setActiveUrdfPath(activePath);
      setPackageRoots(nextPackageRoots);
      setMeshFiles(nextMeshFiles);
      setOriginalUrdfContent(urdfContent);
      setJointLimits(analysis.jointLimits);
      setJointAxes(nextJointAxes);
      setOriginalJointAxes(nextJointAxes);
      setAvailableLinks(analysis.linkNames);
      setSensors(nextSensors);
      setUrdfAnalysis(analysis);
      setVizUrdfContent(urdfContent);
      setOriginalVizUrdfContent(urdfContent);
      setSavedVizUrdfContent(urdfContent);
      setUrdfFile(createUrdfFile(urdfContent, filename));
      setDebugMeshInfo(debugMeshInfo);
      setMissingPackageRefs(issueSummary.missingPackages);
      setUnmatchedURDFRefs(issueSummary.unmatchedRefs);
      setAbsoluteFileMeshRefs(issueSummary.absoluteFileRefs);
      setUrdfValidationError(validationError);
      setShowLoadIssues(issueSummary.hasIssues);
      setHasLoadedFiles(true);
      advanceUrdfLoadRevision();
      onClearSelection?.();
      onAutoSelectEndEffector?.(autoEndEffector);
    },
    [advanceUrdfLoadRevision, createUrdfFile, onAutoSelectEndEffector, onClearSelection]
  );

  const resetLoadedUrdf = useCallback(() => {
    setUrdfFile(null);
    setActiveUrdfPath(null);
    setUrdfDocuments({});
    setMeshFiles({});
    setUrdfBasePath("");
    setPackageRoots({});
    setSensors([]);
    setIsLoading(false);
    setHasLoadedFiles(false);
    setJointLimits({});
    setJointAxes({});
    setOriginalJointAxes({});
    setAvailableLinks([]);
    setOriginalUrdfContent("");
    setVizUrdfContent("");
    setOriginalVizUrdfContent("");
    setSavedVizUrdfContent("");
    setDebugMeshInfo([]);
    setUnmatchedURDFRefs([]);
    setAbsoluteFileMeshRefs([]);
    setMissingPackageRefs([]);
    setUrdfAnalysis(null);
    setUrdfValidationError(null);
    setShowLoadIssues(false);
    advanceUrdfLoadRevision();
    onClearSelection?.();
    onAutoSelectEndEffector?.(null);
  }, [advanceUrdfLoadRevision, onAutoSelectEndEffector, onClearSelection]);

  const loadUrdfText = useCallback(
    (content: string, options: LoadUrdfTextOptions = {}) => {
      const runtimeContent = content;
      const filename = options.filename || DEFAULT_URDF_FILENAME;
      const rawActivePath = options.activePath || filename;
      const normalizedActivePath = normalizeMeshPathForMatch(rawActivePath) || rawActivePath;
      const nextBasePath = options.basePath ?? getBasePathFromRelativePath(normalizedActivePath);
      const nextMeshFiles = aliasRepeatedLinkMeshFiles(runtimeContent, options.meshFiles ?? {});
      const nextPackageRoots = options.packageRoots ?? {};
      const nextUrdfDocuments = {
        ...(options.urdfDocuments ?? {}),
        [normalizedActivePath]: runtimeContent,
      };

      const parsedUrdf = parseURDF(runtimeContent);
      const analysis = analyzeUrdfDocument(parsedUrdf.document);
      const autoEndEffectorCandidates = parsedUrdf.isValid
        ? findAutoEndEffectorLinksFromAnalysis(analysis)
        : [];
      const autoEndEffector =
        autoEndEffectorCandidates.length === 1 ? autoEndEffectorCandidates[0] : null;
      const issueSummary = summarizeUrdfLoadIssues({
        analysis,
        meshFiles: nextMeshFiles,
        packageRoots: nextPackageRoots,
        parsedIsValid: parsedUrdf.isValid,
        urdfBasePath: nextBasePath,
      });

      applyLoadedUrdfState({
        activePath: normalizedActivePath,
        analysis,
        autoEndEffector,
        basePath: nextBasePath,
        debugMeshInfo: [],
        filename,
        issueSummary,
        jointAxes: analysis.jointAxes,
        meshFiles: nextMeshFiles,
        packageRoots: nextPackageRoots,
        sensors: analysis.sensors,
        urdfContent: runtimeContent,
        urdfDocuments: nextUrdfDocuments,
        validationError: parsedUrdf.isValid ? null : parsedUrdf.error ?? "Invalid URDF",
      });
    },
    [applyLoadedUrdfState]
  );

  const loadFilesFromFolder = useCallback(
    async (fileList: FileList) => {
      try {
        setIsLoading(true);
        setPackageRoots({});

        const allFiles = Array.from(fileList);
        const urdfFiles = allFiles.filter((file) => file.name.toLowerCase().endsWith(".urdf"));
        const xacroFiles = allFiles.filter((file) => isXacroPath(file.name));

        if (urdfFiles.length === 0 && xacroFiles.length === 0) {
          throw new Error("No URDF or Xacro file found in selected folder");
        }

        if (urdfFiles.length > 1) {
          console.warn(
            `Multiple URDF files found (${urdfFiles.length}), using only the first one: ${urdfFiles[0].name}`
          );
        }

        if (urdfFiles.length === 0 && xacroFiles.length > 1) {
          console.warn(
            `Multiple Xacro files found (${xacroFiles.length}), using only the first one: ${xacroFiles[0].name}`
          );
        }

        let urdfFile: File;
        let originalContent = "";
        let urdfFilename = DEFAULT_URDF_FILENAME;
        let urdfRelativePath = "";
        const nextUrdfDocuments: Record<string, string> = {};

        if (urdfFiles.length > 0) {
          const urdfEntries = await Promise.all(
            urdfFiles.map(async (candidateFile) => {
              const rawPath = getFileRelativePath(candidateFile);
              const normalizedPath = normalizeMeshPathForMatch(rawPath) || candidateFile.name;
              const content = await candidateFile.text();
              return {
                file: candidateFile,
                path: normalizedPath,
                content,
              };
            })
          );
          urdfEntries.forEach((entry) => {
            nextUrdfDocuments[entry.path] = entry.content;
          });
          urdfFile = urdfEntries[0].file;
          originalContent = urdfEntries[0].content;
          urdfFilename = urdfFile.name;
          urdfRelativePath = urdfEntries[0].path;
        } else {
          const xacroFile = xacroFiles[0];
          const xacroRelativePath = getFileRelativePath(xacroFile);
          const supportFiles = collectXacroSupportFiles(fileList);
          try {
            const { urdf } = await expandXacro(xacroRelativePath, supportFiles);
            originalContent = urdf;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to expand xacro file";
            throw new Error(message);
          }
          urdfRelativePath = normalizeExpandedUrdfPath(xacroRelativePath);
          urdfFilename = normalizeExpandedUrdfPath(xacroFile.name);
          const normalizedUrdfPath = normalizeMeshPathForMatch(urdfRelativePath) || urdfRelativePath;
          nextUrdfDocuments[normalizedUrdfPath] = originalContent;
          urdfRelativePath = normalizedUrdfPath;
          urdfFile = createExpandedXacroUrdfFile({
            content: originalContent,
            filename: urdfFilename,
            relativePath: urdfRelativePath,
          });
          toast.info("Expanded Xacro to URDF");
        }
        const resolvedBasePath = getBasePathFromRelativePath(urdfRelativePath);
        const packageRootsRecord = await buildPackageRootsFromFiles(allFiles);

        const parsedUrdf = parseURDF(originalContent);
        const analysis = analyzeUrdfDocument(parsedUrdf.document);
        const autoEndEffectorCandidates = parsedUrdf.isValid
          ? findAutoEndEffectorLinksFromAnalysis(analysis)
          : [];
        const autoEndEffector =
          autoEndEffectorCandidates.length === 1 ? autoEndEffectorCandidates[0] : null;

        const resourceFiles = allFiles.filter((file) => isSupportedMeshResource(file.name));
        const { meshAssets, meshes } = await indexMeshResources(resourceFiles, {}, {
          logFailures: true,
          logRegistrations: true,
        });

        const runtimeMeshFiles = aliasRepeatedLinkMeshFiles(originalContent, meshes);
        const urdfMeshReferences = analysis.meshReferences;
        const debugInfo = buildDebugMeshInfo(meshAssets, runtimeMeshFiles, urdfMeshReferences);

        const issueSummary = summarizeUrdfLoadIssues({
          analysis,
          meshFiles: runtimeMeshFiles,
          packageRoots: packageRootsRecord,
          parsedIsValid: parsedUrdf.isValid,
          urdfBasePath: resolvedBasePath,
        });

        applyLoadedUrdfState({
          activePath: urdfRelativePath,
          analysis,
          autoEndEffector,
          basePath: resolvedBasePath,
          debugMeshInfo: debugInfo,
          filename: urdfFilename,
          issueSummary,
          jointAxes: analysis.jointAxes,
          meshFiles: runtimeMeshFiles,
          packageRoots: packageRootsRecord,
          sensors: analysis.sensors,
          urdfContent: originalContent,
          urdfDocuments: nextUrdfDocuments,
          validationError: parsedUrdf.isValid ? null : parsedUrdf.error ?? "Invalid URDF",
        });

        if (import.meta.env.DEV) {
          formatUrdfMeshLoadDiagnostics({
            debugMeshInfo: debugInfo,
            loadedMeshAssetCount: meshAssets.length,
            totalPathVariationCount: Object.keys(meshes).length,
            unmatchedRefCount: issueSummary.unmatchedRefs.length,
            urdfMeshReferenceCount: urdfMeshReferences.length,
          }).forEach((line) => {
            console.debug(line);
          });
          if (issueSummary.unmatchedRefs.length > 0) {
            console.warn("Unmatched URDF references:", issueSummary.unmatchedRefs);
          }
        }

        toast.success(`Loaded ${urdfFilename} with ${meshAssets.length} mesh files`);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to load robot files:", error);
        }
        setActiveUrdfPath(null);
        setUrdfDocuments({});
        const loadError =
          error instanceof Error ? error : new Error("Failed to load robot files");
        setUrdfValidationError(loadError.message);
        setShowLoadIssues(true);
        setSensors([]);
        setUnmatchedURDFRefs([]);
        setAbsoluteFileMeshRefs([]);
        setMissingPackageRefs([]);
        toast.error(loadError.message);
        throw loadError;
      } finally {
        setIsLoading(false);
      }
    },
    [applyLoadedUrdfState]
  );

  const hydrateLoadedAssetsFromFiles = useCallback(
    async (fileList: FileList, options: HydrateLoadedAssetsOptions = {}) => {
      const allFiles = Array.from(fileList);
      const nextContent = options.urdfContent ?? vizUrdfContent;
      const rawActivePath = options.activePath ?? activeUrdfPath ?? DEFAULT_URDF_FILENAME;
      const normalizedActivePath = normalizeMeshPathForMatch(rawActivePath) || rawActivePath;
      const nextBasePath = getBasePathFromRelativePath(normalizedActivePath);

      const [nextUrdfDocuments, packageRootsRecord] = await Promise.all([
        readUrdfDocumentsFromFiles(allFiles),
        buildPackageRootsFromFiles(allFiles),
      ]);

      const resourceFiles = allFiles.filter((file) => isSupportedMeshResource(file.name));
      const { meshAssets, meshes } = await indexMeshResources(resourceFiles, {}, {
        logFailures: true,
        logRegistrations: true,
      });

      const parsedUrdf = parseURDF(nextContent);
      const analysis = analyzeUrdfDocument(parsedUrdf.document);
      const issueSummary = summarizeUrdfLoadIssues({
        analysis,
        meshFiles: meshes,
        packageRoots: packageRootsRecord,
        parsedIsValid: parsedUrdf.isValid,
        urdfBasePath: nextBasePath,
      });

      if (options.shouldApply && !options.shouldApply()) {
        return false;
      }

      setUrdfBasePath(nextBasePath);
      setActiveUrdfPath(normalizedActivePath);
      setUrdfDocuments((previous) => ({
        ...previous,
        ...nextUrdfDocuments,
        [normalizedActivePath]: nextContent,
      }));
      setPackageRoots(packageRootsRecord);
      setMeshFiles(meshes);
      setDebugMeshInfo(buildDebugMeshInfo(meshAssets, meshes, analysis.meshReferences));
      setMissingPackageRefs(issueSummary.missingPackages);
      setUnmatchedURDFRefs(issueSummary.unmatchedRefs);
      setAbsoluteFileMeshRefs(issueSummary.absoluteFileRefs);
      setShowLoadIssues(issueSummary.hasIssues);
      setHasLoadedFiles(true);

      return true;
    },
    [activeUrdfPath, vizUrdfContent]
  );

  const addMeshFilesFromFiles = useCallback(
    async (input: FileList | File[], urdfContentOverride?: string) => {
      const files = Array.from(input);
      const resourceFiles = files.filter((file) => isSupportedMeshResource(file.name));
      if (resourceFiles.length === 0) return 0;

      const { meshAssets, meshes } = await indexMeshResources(resourceFiles, meshFiles);

      setMeshFiles(meshes);

      const content = urdfContentOverride ?? vizUrdfContent;
      if (content.trim()) {
        const parsed = parseURDF(content);
        const analysis = analyzeUrdfDocument(parsed.document);
        const issueSummary = summarizeUrdfLoadIssues({
          analysis,
          meshFiles: meshes,
          packageRoots,
          parsedIsValid: parsed.isValid,
          urdfBasePath,
        });
        setMissingPackageRefs(issueSummary.missingPackages);
        setUnmatchedURDFRefs(issueSummary.unmatchedRefs);
        setAbsoluteFileMeshRefs(issueSummary.absoluteFileRefs);
        setShowLoadIssues(issueSummary.hasIssues);

        if (meshAssets.length > 0) {
          const urdfMeshReferences = analysis.meshReferences;
          const debugInfo = buildDebugMeshInfo(meshAssets, meshes, urdfMeshReferences);

          setDebugMeshInfo((prev) => {
            const existing = new Set(prev.map((info) => `${info.webkitRelativePath}::${info.filename}`));
            const additions = debugInfo.filter(
              (info) => !existing.has(`${info.webkitRelativePath}::${info.filename}`)
            );
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
        }
      }

      return resourceFiles.length;
    },
    [meshFiles, packageRoots, urdfBasePath, vizUrdfContent]
  );

  return {
    urdfFile,
    activeUrdfPath,
    urdfDocuments,
    urdfBasePath,
    packageRoots,
    meshFiles,
    sensors,
    urdfAnalysis,
    isLoading,
    hasLoadedFiles,
    urdfLoadRevision,
    jointLimits,
    jointAxes,
    originalJointAxes,
    availableLinks,
    originalUrdfContent,
    vizUrdfContent,
    originalVizUrdfContent,
    savedVizUrdfContent,
    debugMeshInfo,
    unmatchedURDFRefs,
    absoluteFileMeshRefs,
    missingPackageRefs,
    urdfValidationError,
    showLoadIssues,
    setShowLoadIssues,
    setSavedVizUrdfContent,
    setOriginalVizUrdfContent,
    setJointLimits,
    setJointAxes,
    setOriginalJointAxes,
    setVizUrdfContent,
    setUrdfFile,
    createUrdfFile,
    updateUrdfFile,
    resetLoadedUrdf,
    loadUrdfText,
    loadFilesFromFolder,
    hydrateLoadedAssetsFromFiles,
    addMeshFilesFromFiles,
  };
};
