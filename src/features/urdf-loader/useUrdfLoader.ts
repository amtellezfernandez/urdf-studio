import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { FileWithPath } from "@/types/file";
import {
  createVizFilename,
  parseJointAxesFromURDF,
  parseJointLimitsFromURDF,
  parseLinkNames,
  type JointAxisMap,
  type JointLimits,
} from "@/features/urdf";
import { findDeepestLeafLink } from "@/pages/index/utils";
import { COMMON_MESH_FOLDERS, DEFAULT_URDF_FILENAME } from "@/pages/index/constants";
import type { DebugMeshInfo, MeshFiles } from "@/features/types";

type UseUrdfLoaderOptions = {
  onClearSelection?: () => void;
  onAutoSelectEndEffector?: (link: string | null) => void;
};

export const useUrdfLoader = (options: UseUrdfLoaderOptions = {}) => {
  const [urdfFile, setUrdfFile] = useState<File | null>(null);
  const [meshFiles, setMeshFiles] = useState<MeshFiles>({});
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
  const [showDebugDialog, setShowDebugDialog] = useState(false);

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
      setVizUrdfContent(content);
      setJointLimits(parseJointLimitsFromURDF(content));
      setJointAxes(parseJointAxesFromURDF(content));
      setUrdfFile(createUrdfFile(content, filename));
    },
    [createUrdfFile]
  );

  const extractMeshReferencesFromURDF = useCallback((urdfContent: string): string[] => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    const meshReferences = new Set<string>();

    xmlDoc.querySelectorAll("mesh").forEach((mesh) => {
      const filename = mesh.getAttribute("filename");
      if (filename) {
        const normalizedFilename = filename.replace(/^package:\/\/[^/]+\//, "").replace(/^file:\/\//, "").trim();
        if (normalizedFilename) {
          meshReferences.add(normalizedFilename);
        }
      }
    });

    return Array.from(meshReferences);
  }, []);

  const loadFilesFromFolder = useCallback(
    async (fileList: FileList) => {
      try {
        setIsLoading(true);

        const urdfFiles = Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith(".urdf"));

        if (urdfFiles.length === 0) {
          throw new Error("No URDF file found in selected folder");
        }

        if (urdfFiles.length > 1) {
          console.warn(
            `Multiple URDF files found (${urdfFiles.length}), using only the first one: ${urdfFiles[0].name}`
          );
        }

        const urdfFile = urdfFiles[0];
        const originalContent = await urdfFile.text();
        const urdfFilename = urdfFile.name;

        const parsedLimits = parseJointLimitsFromURDF(originalContent);
        const parsedAxes = parseJointAxesFromURDF(originalContent);
        const parsedLinks = parseLinkNames(originalContent);
        const autoEndEffector = findDeepestLeafLink(originalContent);

        setOriginalUrdfContent(originalContent);
        setJointLimits(parsedLimits);
        setJointAxes(parsedAxes);
        setOriginalJointAxes(parsedAxes);
        setAvailableLinks(parsedLinks);
        setVizUrdfContent(originalContent);
        setOriginalVizUrdfContent(originalContent);
        setSavedVizUrdfContent(originalContent);
        setUrdfFile(createUrdfFile(originalContent, urdfFilename));

        options.onClearSelection?.();
        options.onAutoSelectEndEffector?.(autoEndEffector);

        const stlFiles = Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith(".stl"));
        const meshes: MeshFiles = {};
        const blobCache = new Map<string, Blob>();

        await Promise.all(
          stlFiles.map(async (file) => {
            try {
              const fileWithPath = file as FileWithPath;
              const relativePath = fileWithPath.webkitRelativePath || file.name;
              const filename = file.name;

              let blob = blobCache.get(filename);
              if (!blob) {
                blob = new Blob([await file.arrayBuffer()]);
                blobCache.set(filename, blob);
              }

              const normalizedPath = relativePath.replace(/^\/+|\/+$/g, "");
              const pathParts = normalizedPath.split("/").filter(Boolean);

              meshes[filename] = blob;
              meshes[normalizedPath] = blob;
              meshes[`/${normalizedPath}`] = blob;

              if (relativePath !== normalizedPath) {
                meshes[relativePath] = blob;
                const noLeadingSlash = relativePath.replace(/^\/+/, "");
                if (noLeadingSlash !== relativePath && noLeadingSlash !== normalizedPath) {
                  meshes[noLeadingSlash] = blob;
                }
              }

              if (pathParts.length > 1) {
                const lastFolderAndFile = `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`;
                if (lastFolderAndFile !== normalizedPath) {
                  meshes[lastFolderAndFile] = blob;
                  meshes[`/${lastFolderAndFile}`] = blob;
                }

                for (let i = 0; i < pathParts.length; i++) {
                  const suffixPath = pathParts.slice(i).join("/");
                  meshes[suffixPath] = blob;
                  meshes[`/${suffixPath}`] = blob;
                }

                if (pathParts.length > 1) {
                  const withoutFirst = pathParts.slice(1).join("/");
                  meshes[withoutFirst] = blob;
                  meshes[`/${withoutFirst}`] = blob;
                }
              }

              try {
                const decodedPath = decodeURIComponent(normalizedPath);
                if (decodedPath !== normalizedPath) {
                  meshes[decodedPath] = blob;
                  meshes[`/${decodedPath}`] = blob;
                }
              } catch {
                // Ignore decode errors
              }

              for (const folder of COMMON_MESH_FOLDERS) {
                meshes[`${folder}/${filename}`] = blob;
                meshes[`/${folder}/${filename}`] = blob;
              }

              if (import.meta.env.DEV) {
                console.log(
                  `Mesh ${filename} registered with webkitRelativePath: "${relativePath}" (normalized: "${normalizedPath}")`
                );
              }
            } catch (err) {
              if (import.meta.env.DEV) {
                console.warn(`Failed to load mesh: ${file.name}`, err);
              }
            }
          })
        );

        setMeshFiles(meshes);
        setHasLoadedFiles(true);

        const urdfMeshReferences = extractMeshReferencesFromURDF(originalContent);
        const debugInfo: DebugMeshInfo[] = [];

        for (const file of stlFiles) {
          const fileWithPath = file as FileWithPath;
          const relativePath = fileWithPath.webkitRelativePath || file.name;
          const filename = file.name;

          const fileBlob = meshes[filename];
          const registeredPaths = Object.keys(meshes).filter((key) => meshes[key] === fileBlob);

          let found = false;
          let matchedReference: string | undefined;

          for (const urdfRef of urdfMeshReferences) {
            const refFilename = urdfRef.split("/").pop() || urdfRef;
            const pathVariations = [urdfRef, refFilename, urdfRef.replace(/^.*?\//, ""), urdfRef.replace(/^package:\/\/[^/]+\//, "")];

            try {
              pathVariations.push(decodeURIComponent(urdfRef));
              pathVariations.push(decodeURIComponent(refFilename));
            } catch {
              // Ignore decode errors
            }

            const normalizedVariations = pathVariations
              .filter(Boolean)
              .map((v) => v.replace(/^\/+|\/+$/g, ""));

            const matchingPath = registeredPaths.find((p) => {
              const normalizedPath = p.replace(/^\/+|\/+$/g, "");
              return normalizedVariations.some(
                (v) => normalizedPath === v || normalizedPath.endsWith("/" + v) || normalizedPath === v.replace(/^\//, "")
              );
            });

            if (matchingPath) {
              found = true;
              matchedReference = urdfRef;
              break;
            }
          }

          debugInfo.push({
            filename,
            webkitRelativePath: relativePath,
            found,
            urdfReference: matchedReference,
            registeredPaths: registeredPaths.slice(0, 20),
          });
        }

        const unmatchedRefs = urdfMeshReferences.filter((ref) => !debugInfo.some((info) => info.urdfReference === ref));

        setDebugMeshInfo(debugInfo);
        setUnmatchedURDFRefs(unmatchedRefs);
        setShowDebugDialog(true);

        if (import.meta.env.DEV) {
          console.log(`Loaded ${stlFiles.length} mesh files with ${Object.keys(meshes).length} total path variations`);
          console.log(
            `URDF references: ${urdfMeshReferences.length} total, ${
              debugInfo.filter((m) => m.found).length
            } matched, ${unmatchedRefs.length} unmatched`
          );
          if (unmatchedRefs.length > 0) {
            console.warn("Unmatched URDF references:", unmatchedRefs);
          }
          const pathsByFile = new Map<string, string[]>();
          for (const file of stlFiles) {
            const pathsForFile = Object.keys(meshes).filter((key) => meshes[key] === meshes[file.name]);
            pathsByFile.set(file.name, pathsForFile);
          }
          pathsByFile.forEach((paths, filename) => {
            console.log(`  ${filename}: ${paths.length} path variations`);
            console.log(`    Primary: ${paths[0] || "N/A"}`);
            if (paths.length > 1) {
              console.log(`    Others: ${paths.slice(1, 10).join(", ")}${paths.length > 10 ? "..." : ""}`);
            }
          });
        }

        toast.success(`Loaded ${urdfFilename} with ${stlFiles.length} mesh files`);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to load robot files:", error);
        }
        toast.error(error instanceof Error ? error.message : "Failed to load robot files");
      } finally {
        setIsLoading(false);
      }
    },
    [createUrdfFile, extractMeshReferencesFromURDF, options.onAutoSelectEndEffector, options.onClearSelection]
  );

  return {
    urdfFile,
    meshFiles,
    isLoading,
    hasLoadedFiles,
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
    showDebugDialog,
    setShowDebugDialog,
    setSavedVizUrdfContent,
    setOriginalVizUrdfContent,
    setJointLimits,
    setJointAxes,
    setOriginalJointAxes,
    setVizUrdfContent,
    setUrdfFile,
    createUrdfFile,
    updateUrdfFile,
    loadFilesFromFolder,
  };
};
