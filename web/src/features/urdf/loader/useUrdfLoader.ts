import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { FileWithPath } from "@/shared/types/file";
import {
  analyzeUrdfDocument,
  type ParsedSensor,
  type UrdfAnalysis,
} from "@/shared/lib/urdfCore";
import {
  buildPackageRootsFromRepositoryFiles,
  buildRepositoryFileEntriesFromPaths,
  extractPackageNameFromPackageXml,
  isSupportedMeshExtension,
  isSupportedMeshResource,
  isXacroPath,
  normalizeExpandedUrdfPath,
} from "@/shared/lib/urdfCore";
import {
  normalizeMeshPathForMatch,
  parseURDF,
  parseMeshReference,
  resolveMeshBlobFromReference,
  type JointAxisMap,
  type JointLimits,
} from "@/shared/lib/urdfBrowser";
import { findAutoEndEffectorLinksFromAnalysis } from "@/features/layout/page/utils";
import { COMMON_MESH_FOLDERS, DEFAULT_URDF_FILENAME } from "@/features/layout/page/constants";
import type { DebugMeshInfo, MeshFiles } from "@/shared/types/feature";
import { createVizFilename } from "../utils/addJointColors";
import {
  collectXacroSupportFiles,
  expandXacro,
} from "@/features/urdf/xacro/xacroClient";
import { aliasRepeatedLinkMeshFiles } from "@/features/urdf/loader/repeatedMeshAlias";
import type { LoadUrdfTextOptions } from "@/features/urdf/loader/urdfLoaderTypes";
import {
  formatMeshRegistrationDebugLine,
  formatUrdfMeshLoadDiagnostics,
} from "@/features/urdf/loader/urdfLoaderDiagnostics";

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

const getFileRelativePath = (file: File): string => {
  const fileWithPath = file as FileWithPath;
  return fileWithPath.webkitRelativePath || file.name;
};

const getBasePathFromRelativePath = (relativePath: string): string => {
  const normalized = normalizeMeshPathForMatch(relativePath);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  parts.pop();
  return parts.join("/");
};

const collectMissingPackages = (
  meshReferences: string[],
  packageRoots: Record<string, string[]>,
  meshFiles?: MeshFiles,
  urdfBasePath?: string
): string[] => {
  const missing = new Set<string>();
  meshReferences.forEach((ref) => {
    const refInfo = parseMeshReference(ref);
    if (refInfo.scheme !== "package" || !refInfo.packageName) return;
    if (packageRoots[refInfo.packageName]) return;
    if (meshFiles && resolveMeshBlobFromReference(ref, meshFiles, urdfBasePath, packageRoots)) {
      return;
    }
    if (!packageRoots[refInfo.packageName]) {
      missing.add(refInfo.packageName);
    }
  });
  return Array.from(missing);
};

type UrdfLoadIssueSummary = {
  unmatchedRefs: string[];
  absoluteFileRefs: string[];
  missingPackages: string[];
  hasIssues: boolean;
};

const summarizeUrdfLoadIssues = (
  analysis: UrdfAnalysis,
  parsedIsValid: boolean,
  meshFilesForLookup: MeshFiles,
  packageRootsForLookup: Record<string, string[]>,
  urdfBasePathForLookup: string
): UrdfLoadIssueSummary => {
  const unmatchedRefs = analysis.meshReferences.filter((ref) => {
    const refInfo = parseMeshReference(ref);
    if (refInfo.isAbsoluteFile) {
      return false;
    }
    return !resolveMeshBlobFromReference(
      ref,
      meshFilesForLookup,
      urdfBasePathForLookup,
      packageRootsForLookup
    );
  });
  const absoluteFileRefs = analysis.absoluteFileMeshRefs;
  const missingPackages = collectMissingPackages(
    analysis.meshReferences,
    packageRootsForLookup,
    meshFilesForLookup,
    urdfBasePathForLookup
  );
  const hasIssues =
    unmatchedRefs.length > 0 ||
    absoluteFileRefs.length > 0 ||
    missingPackages.length > 0 ||
    !parsedIsValid;

  return {
    unmatchedRefs,
    absoluteFileRefs,
    missingPackages,
    hasIssues,
  };
};

const registerMeshKey = (
  meshes: MeshFiles,
  collisionKeys: Set<string>,
  key: string,
  blob: Blob
) => {
  if (!key) return;
  if (collisionKeys.has(key)) {
    return;
  }
  const existing = meshes[key];
  if (existing && existing !== blob) {
    collisionKeys.add(key);
    delete meshes[key];
    return;
  }
  meshes[key] = blob;
};

const registerMeshFilePaths = (
  meshes: MeshFiles,
  collisionKeys: Set<string>,
  relativePath: string,
  filename: string,
  blob: Blob
) => {
  const normalizedPath = relativePath.replace(/^\/+|\/+$/g, "");
  const pathParts = normalizedPath.split("/").filter(Boolean);

  registerMeshKey(meshes, collisionKeys, filename, blob);
  registerMeshKey(meshes, collisionKeys, normalizedPath, blob);
  registerMeshKey(meshes, collisionKeys, `/${normalizedPath}`, blob);

  if (relativePath !== normalizedPath) {
    registerMeshKey(meshes, collisionKeys, relativePath, blob);
    const noLeadingSlash = relativePath.replace(/^\/+/, "");
    if (noLeadingSlash !== relativePath && noLeadingSlash !== normalizedPath) {
      registerMeshKey(meshes, collisionKeys, noLeadingSlash, blob);
    }
  }

  if (pathParts.length > 1) {
    const lastFolderAndFile = `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`;
    if (lastFolderAndFile !== normalizedPath) {
      registerMeshKey(meshes, collisionKeys, lastFolderAndFile, blob);
      registerMeshKey(meshes, collisionKeys, `/${lastFolderAndFile}`, blob);
    }

    for (let i = 0; i < pathParts.length; i++) {
      const suffixPath = pathParts.slice(i).join("/");
      registerMeshKey(meshes, collisionKeys, suffixPath, blob);
      registerMeshKey(meshes, collisionKeys, `/${suffixPath}`, blob);
    }

    const withoutFirst = pathParts.slice(1).join("/");
    registerMeshKey(meshes, collisionKeys, withoutFirst, blob);
    registerMeshKey(meshes, collisionKeys, `/${withoutFirst}`, blob);
  }

  try {
    const decodedPath = decodeURIComponent(normalizedPath);
    if (decodedPath !== normalizedPath) {
      registerMeshKey(meshes, collisionKeys, decodedPath, blob);
      registerMeshKey(meshes, collisionKeys, `/${decodedPath}`, blob);
    }
  } catch {
    // Ignore decode errors
  }

  for (const folder of COMMON_MESH_FOLDERS) {
    registerMeshKey(meshes, collisionKeys, `${folder}/${filename}`, blob);
    registerMeshKey(meshes, collisionKeys, `/${folder}/${filename}`, blob);
  }
};

type IndexedMeshAsset = {
  blob: Blob;
  filename: string;
  relativePath: string;
};

const warnOnAmbiguousMeshKeys = (collisionKeys: Set<string>) => {
  if (!import.meta.env.DEV || collisionKeys.size === 0) {
    return;
  }
  console.warn(
    `Skipped ${collisionKeys.size} ambiguous mesh key(s) due to basename collisions.`,
    Array.from(collisionKeys).slice(0, 10)
  );
};

const indexMeshResources = async (
  files: File[],
  initialMeshes: MeshFiles,
  options: {
    logFailures?: boolean;
    logRegistrations?: boolean;
  } = {}
): Promise<{ meshAssets: IndexedMeshAsset[]; meshes: MeshFiles }> => {
  const meshes: MeshFiles = { ...initialMeshes };
  const collisionKeys = new Set<string>();
  const meshAssets = (
    await Promise.all(
      files.map(async (file): Promise<IndexedMeshAsset | null> => {
        try {
          const relativePath = getFileRelativePath(file);
          const normalizedPath = relativePath.replace(/^\/+|\/+$/g, "");
          const blob = new Blob([await file.arrayBuffer()]);

          registerMeshFilePaths(meshes, collisionKeys, relativePath, file.name, blob);

          if (import.meta.env.DEV && options.logRegistrations) {
            console.debug(
              formatMeshRegistrationDebugLine({
                filename: file.name,
                normalizedPath,
                relativePath,
              })
            );
          }

          return isSupportedMeshExtension(file.name)
            ? {
                blob,
                filename: file.name,
                relativePath,
              }
            : null;
        } catch (error) {
          if (import.meta.env.DEV && options.logFailures) {
            console.warn(`Failed to load mesh: ${file.name}`, error);
          }
          return null;
        }
      })
    )
  ).filter((asset): asset is IndexedMeshAsset => asset !== null);

  warnOnAmbiguousMeshKeys(collisionKeys);

  return { meshAssets, meshes };
};

const buildPackageRootsFromFiles = async (files: File[]) => {
  const packageFiles = files.filter((file) => file.name.toLowerCase() === "package.xml");
  const packageNameByPath: Record<string, string> = {};

  await Promise.all(
    packageFiles.map(async (file) => {
      try {
        const relativePath = getFileRelativePath(file);
        const normalizedPath = normalizeMeshPathForMatch(relativePath);
        if (!normalizedPath) return;
        const text = await file.text();
        const packageName = extractPackageNameFromPackageXml(text);
        if (!packageName) return;
        packageNameByPath[normalizedPath] = packageName;
      } catch {
        // Ignore package.xml read errors
      }
    })
  );

  const repositoryFiles = buildRepositoryFileEntriesFromPaths(
    files.map((file) => getFileRelativePath(file))
  );

  return buildPackageRootsFromRepositoryFiles(repositoryFiles, {
    packageNameByPath,
  });
};

const readUrdfDocumentsFromFiles = async (files: File[]) => {
  const documentEntries = await Promise.all(
    files
      .filter(
        (file) => file.name.toLowerCase().endsWith(".urdf") || isXacroPath(getFileRelativePath(file))
      )
      .map(async (file) => {
        const rawPath = getFileRelativePath(file);
        const normalizedPath = normalizeMeshPathForMatch(rawPath) || file.name;
        return {
          content: await file.text(),
          path: normalizedPath,
        };
      })
  );

  return documentEntries.reduce<Record<string, string>>((documents, entry) => {
    documents[entry.path] = entry.content;
    return documents;
  }, {});
};

const buildDebugMeshInfo = (
  meshAssets: IndexedMeshAsset[],
  meshes: MeshFiles,
  urdfMeshReferences: string[]
): DebugMeshInfo[] => {
  const registeredPathsByBlob = new Map<Blob, string[]>();
  Object.entries(meshes).forEach(([path, blob]) => {
    const existingPaths = registeredPathsByBlob.get(blob);
    if (existingPaths) {
      existingPaths.push(path);
      return;
    }
    registeredPathsByBlob.set(blob, [path]);
  });

  const getReferenceMatchCandidates = (meshReference: string): string[] => {
    const refInfo = parseMeshReference(meshReference);
    if (refInfo.isAbsoluteFile) {
      return [];
    }

    const candidates = new Set<string>();
    const addPathCandidate = (value?: string) => {
      if (!value) return;
      const normalized = normalizeMeshPathForMatch(value)?.replace(/^\/+/, "");
      if (!normalized) return;
      candidates.add(normalized);
    };

    addPathCandidate(refInfo.path || refInfo.raw);

    try {
      addPathCandidate(decodeURIComponent(refInfo.path || refInfo.raw));
    } catch {
      // Ignore decode errors
    }

    return Array.from(candidates);
  };

  return meshAssets.map(({ blob, filename, relativePath }) => {
    const registeredPaths = registeredPathsByBlob.get(blob) ?? [];
    const matchedReference = urdfMeshReferences.find((reference) => {
      const matchCandidates = getReferenceMatchCandidates(reference);
      return registeredPaths.some((registeredPath) => {
        const normalizedRegisteredPath = registeredPath.replace(/^\/+|\/+$/g, "");
        return matchCandidates.some(
          (candidate) =>
            normalizedRegisteredPath === candidate ||
            normalizedRegisteredPath.endsWith(`/${candidate}`)
        );
      });
    });

    return {
      filename,
      webkitRelativePath: relativePath,
      found: matchedReference !== undefined,
      urdfReference: matchedReference,
      registeredPaths: registeredPaths.slice(0, 20),
    };
  });
};

export const extractMeshReferencesFromUrdfContent = (urdfContent: string): string[] => {
  if (!urdfContent.trim()) return [];
  const parsed = parseURDF(urdfContent);
  return analyzeUrdfDocument(parsed.document).meshReferences;
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
    (content: string, filename = DEFAULT_URDF_FILENAME, timestamp?: number): File => {
      const vizFilename = createVizFilename(filename);
      const uniqueFilename = timestamp ? `${vizFilename.replace(".urdf", "")}_${timestamp}.urdf` : vizFilename;
      const blob = new Blob([content], { type: "application/xml" });
      return new File([blob], uniqueFilename, { type: "application/xml" });
    },
    []
  );

  const updateUrdfFile = useCallback(
    (content: string, filename = DEFAULT_URDF_FILENAME) => {
      const parsed = parseURDF(content);
      const analysis = analyzeUrdfDocument(parsed.document);
      const issueSummary = summarizeUrdfLoadIssues(
        analysis,
        parsed.isValid,
        meshFiles,
        packageRoots,
        urdfBasePath
      );
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
      const issueSummary = summarizeUrdfLoadIssues(
        analysis,
        parsedUrdf.isValid,
        nextMeshFiles,
        nextPackageRoots,
        nextBasePath
      );

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
          const blob = new Blob([originalContent], { type: "application/xml" });
          urdfFile = new File([blob], urdfFilename, { type: "application/xml" });
          Object.defineProperty(urdfFile, "webkitRelativePath", {
            value: urdfRelativePath,
            writable: false,
            enumerable: true,
            configurable: false,
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

        const issueSummary = summarizeUrdfLoadIssues(
          analysis,
          parsedUrdf.isValid,
          runtimeMeshFiles,
          packageRootsRecord,
          resolvedBasePath
        );

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
      const issueSummary = summarizeUrdfLoadIssues(
        analysis,
        parsedUrdf.isValid,
        meshes,
        packageRootsRecord,
        nextBasePath
      );

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
        const issueSummary = summarizeUrdfLoadIssues(
          analysis,
          parsed.isValid,
          meshes,
          packageRoots,
          urdfBasePath
        );
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
