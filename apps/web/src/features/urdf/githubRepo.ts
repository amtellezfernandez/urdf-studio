/**
 * GitHub repository utility functions
 */

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  path?: string;
}

export interface GitHubFile {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  content?: string; // Base64 encoded content (when from Contents API) OR blob SHA (when from Trees API)
  encoding?: string; // "base64" or "sha" (when from Trees API)
  size?: number;
  sha?: string; // Blob SHA from Trees API (preferred for content fetching)
}

const normalizedPathCache = new Map<string, string>();
const lowerCaseFileMapCache = new WeakMap<GitHubFile[], Map<string, GitHubFile>>();

function normalizePathCached(path: string): string {
  const cached = normalizedPathCache.get(path);
  if (cached) return cached;
  const normalized = normalizePath(path);
  normalizedPathCache.set(path, normalized);
  return normalized;
}

function getLowerCaseFileMap(files: GitHubFile[]): Map<string, GitHubFile> {
  const cached = lowerCaseFileMapCache.get(files);
  if (cached) return cached;

  const pathMap = new Map<string, GitHubFile>();
  for (const file of files) {
    if (file.type === "file") {
      const normalized = normalizePathCached(file.path);
      pathMap.set(normalized.toLowerCase(), file);
    }
  }
  lowerCaseFileMapCache.set(files, pathMap);
  return pathMap;
}

export interface URDFCandidate {
  path: string;
  name: string;
  hasMeshesFolder: boolean;
  meshesFolderPath?: string;
  hasUnsupportedFormats?: boolean;
  unsupportedFormats?: string[];
  unmatchedMeshReferences?: string[];
}

export interface RobotDescriptionStructure {
  rootPath: string;
  urdfFiles: URDFCandidate[];
  meshesPath?: string;
  assetsPath?: string;
}

interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha?: string;
}

/**
 * Parse GitHub repository URL
 * Supports formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - https://github.com/owner/repo/tree/branch/path
 * - owner/repo
 */
export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  // Remove trailing slash
  url = url.trim().replace(/\/$/, "");

  // Handle owner/repo format
  if (!url.includes("github.com")) {
    const parts = url.split("/");
    if (parts.length >= 2) {
      return {
        owner: parts[0],
        repo: parts[1],
        path: parts.length > 2 ? parts.slice(2).join("/") : undefined,
      };
    }
    return null;
  }

  // Parse full GitHub URL
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname !== "github.com" && urlObj.hostname !== "www.github.com") {
      return null;
    }

    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1];

    // Check if there's a tree path
    let path: string | undefined;
    if (pathParts.length > 2 && pathParts[2] === "tree") {
      // Skip branch name (pathParts[3]) and get the rest
      if (pathParts.length > 4) {
        path = pathParts.slice(4).join("/");
      }
    } else if (pathParts.length > 2) {
      path = pathParts.slice(2).join("/");
    }

    return { owner, repo, path };
  } catch {
    return null;
  }
}

/**
 * Get the default branch for a repository
 */
async function getDefaultBranch(
  owner: string,
  repo: string,
  accessToken?: string
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };

  if (accessToken) {
    headers.Authorization = `token ${accessToken}`;
  }

  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Repository not found");
      }
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        if (rateLimitRemaining === "0") {
          throw new Error("GitHub API rate limit exceeded. Please try again later.");
        }
        if (accessToken) {
          throw new Error("Token has no access to this repository. Please check your token permissions.");
        }
        throw new Error("Repository is private or access denied. Public repositories only.");
      }
      throw new Error(`Failed to fetch repository: ${response.statusText}`);
    }

    const data = await response.json();
    const branch = data.default_branch || "main";

    return branch;
  } catch (error) {
    if (error instanceof Error && (error.message.includes("rate limit") || error.message.includes("403") || error.message.includes("404"))) {
      throw error;
    }
    // Fallback to "main" if we can't determine the branch
    return "main";
  }
}

/**
 * Fetch repository contents using the Trees API (recursive)
 * This fetches ALL files in the repository in a SINGLE API call
 */
export async function fetchRepoContents(
  owner: string,
  repo: string,
  path: string = "",
  accessToken?: string
): Promise<GitHubFile[]> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };

  if (accessToken) {
    headers.Authorization = `token ${accessToken}`;
  }

  try {
    // Get the default branch first
    const defaultBranch = await getDefaultBranch(owner, repo, accessToken);
    
    // Build the Trees API URL
    // Format: /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1
    // For a specific path, use: {branch}:{path}
    // For root, use: {branch}
    const treeRef = path ? `${defaultBranch}:${path}` : defaultBranch;
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeRef}?recursive=1`;

    const response = await fetch(url, { headers });

    if (response.status === 404) {
      // If path was provided and tree not found, try root and filter
      if (path) {
        // Fallback to root if path doesn't exist
        const rootUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
        const rootResponse = await fetch(rootUrl, { headers });
        if (!rootResponse.ok) {
          throw new Error("Repository or path not found");
        }
        const rootData = (await rootResponse.json()) as { tree?: GitHubTreeEntry[] };
        if (!rootData.tree || !Array.isArray(rootData.tree)) {
          throw new Error("Invalid tree response from GitHub API");
        }
        // Filter to only include files that start with the path
        const filteredTree = rootData.tree.filter((entry) => entry.path.startsWith(path));
        return convertTreeToFiles(filteredTree, path);
      }
      throw new Error("Repository or path not found");
    }

    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
      if (rateLimitRemaining === "0") {
        throw new Error("GitHub API rate limit exceeded. Please try again later.");
      }
      if (accessToken) {
        throw new Error("Token has no access to this repository. Please check your token permissions.");
      }
      throw new Error("Repository is private or access denied. Public repositories only.");
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch repository tree: ${response.statusText}${errorText ? ` - ${errorText.substring(0, 200)}` : ''}`);
    }

    const data = await response.json();

    // Trees API returns a tree object with a tree array
    if (!data.tree || !Array.isArray(data.tree)) {
      throw new Error("Invalid tree response from GitHub API - missing tree array");
    }

    // Convert tree entries to GitHubFile format
    return convertTreeToFiles(data.tree, path);
  } catch (error) {
    if (error instanceof Error) {
      // Re-throw with more context
      if (error.message.includes("rate limit") || error.message.includes("403") || error.message.includes("404")) {
        throw error;
      }
      throw new Error(`Failed to fetch repository contents: ${error.message}`);
    }
    throw new Error("Failed to fetch repository contents: Unknown error");
  }
}

/**
 * Convert GitHub Trees API response to GitHubFile array
 */
function convertTreeToFiles(treeEntries: GitHubTreeEntry[], pathPrefix: string = ""): GitHubFile[] {
  const files: GitHubFile[] = [];
  const directories = new Set<string>();

  for (const entry of treeEntries) {
    // Filter by path prefix if specified
    if (pathPrefix && !entry.path.startsWith(pathPrefix)) {
      continue;
    }

    if (entry.type === "blob") {
      // It's a file - store the blob SHA for efficient content fetching
      const fileName = entry.path.split("/").pop() || entry.path;
      files.push({
        name: fileName,
        path: entry.path, // Always store the full repository path
        type: "file",
        download_url: null,
        size: entry.size || 0,
        sha: entry.sha, // Store SHA for Blob API
        encoding: "sha", // Indicate we have a SHA
      });
    } else if (entry.type === "tree") {
      // It's a directory - track it
      directories.add(entry.path);
    }
  }

  // Add directory entries for meshes folder detection
  for (const dirPath of directories) {
    const dirName = dirPath.split("/").pop() || dirPath;
    files.push({
      name: dirName,
      path: dirPath,
      type: "dir",
      download_url: null,
      size: 0,
    });
  }

  return files;
}

/**
 * Check if repository is public
 */
export async function checkRepoVisibility(
  owner: string,
  repo: string,
  accessToken?: string
): Promise<{ isPublic: boolean; error?: string }> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };

  if (accessToken) {
    headers.Authorization = `token ${accessToken}`;
  }

  try {
    const response = await fetch(url, { headers });

    if (response.status === 404) {
      if (accessToken) {
        return { isPublic: false, error: "Repository not found or token has no access" };
      }
      return { isPublic: false, error: "Repository not found" };
    }

    if (response.status === 403) {
      // Check if it's a rate limit or access issue
      const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
      if (rateLimitRemaining === "0") {
        return { isPublic: false, error: "GitHub API rate limit exceeded" };
      }
      if (accessToken) {
        return { isPublic: false, error: "Token has no access to this repository" };
      }
      return { isPublic: false, error: "Repository is private or access denied" };
    }

    if (!response.ok) {
      return { isPublic: false, error: `Failed to check repository: ${response.statusText}` };
    }

    const data = await response.json();
    return { isPublic: !data.private };
  } catch (error) {
    return {
      isPublic: false,
      error: error instanceof Error ? error.message : "Failed to check repository visibility",
    };
  }
}

/**
 * Find meshes or assets folder in a directory
 */
function findMeshFolder(files: GitHubFile[], dirPath: string): GitHubFile | undefined {
  return files.find(
    (f) =>
      f.type === "dir" &&
      (f.path.toLowerCase() === `${dirPath}/meshes`.toLowerCase() ||
       f.path.toLowerCase() === `${dirPath}/assets`.toLowerCase()) &&
      (f.name.toLowerCase() === "meshes" || f.name.toLowerCase() === "assets")
  );
}

/**
 * Find meshes folder for a URDF file using multiple strategies
 */
function findMeshesFolderForURDF(files: GitHubFile[], urdfDir: string): string | undefined {
  // Strategy 1: Check same directory
  const sameDir = findMeshFolder(files, urdfDir);
  if (sameDir) return sameDir.path;

  // Strategy 2: Check sibling folders (if URDF is in urdf/, check parent for meshes/)
  if (urdfDir) {
    const pathParts = urdfDir.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      const parentDir = pathParts.slice(0, -1).join("/");
      const sibling = findMeshFolder(files, parentDir);
      if (sibling) return sibling.path;
    }
  }

  // Strategy 3: Check parent directories (up to 3 levels up)
  const pathParts = urdfDir.split("/").filter(Boolean);
  for (let i = pathParts.length - 1; i >= Math.max(0, pathParts.length - 4); i--) {
    const checkPath = pathParts.slice(0, i + 1).join("/");
    const parent = findMeshFolder(files, checkPath);
    if (parent) return parent.path;
  }

  return undefined;
}

/**
 * Find all .urdf files and check if they're in folders with meshes
 */
export function findURDFCandidates(files: GitHubFile[]): URDFCandidate[] {
  const urdfFiles = files.filter(
    (file) => file.type === "file" && file.name.toLowerCase().endsWith(".urdf")
  );

  const candidates = urdfFiles.map((urdfFile) => {
    const urdfDir = dirname(urdfFile.path);
    const meshesFolderPath = findMeshesFolderForURDF(files, urdfDir);

    return {
      path: urdfFile.path,
      name: urdfFile.name,
      hasMeshesFolder: !!meshesFolderPath,
      meshesFolderPath,
    };
  });

  // Sort: prioritize files with meshes folders
  return candidates.sort((a, b) => {
    if (a.hasMeshesFolder && !b.hasMeshesFolder) return -1;
    if (!a.hasMeshesFolder && b.hasMeshesFolder) return 1;
    return 0;
  });
}

/**
 * Check URDF candidates for unsupported mesh formats and unmatched mesh references
 * This fetches URDF content and checks for unsupported formats and missing mesh files
 */
export async function checkCandidatesForUnsupportedFormats(
  candidates: URDFCandidate[],
  files: GitHubFile[],
  owner: string,
  repo: string,
  accessToken?: string
): Promise<URDFCandidate[]> {
  const pathMap = getLowerCaseFileMap(files);

  return Promise.all(
    candidates.map(async (candidate) => {
      const urdfFile = files.find(f => f.type === "file" && f.path === candidate.path);
      if (!urdfFile) {
        return candidate;
      }

      try {
        const blobSha = urdfFile.sha || (urdfFile.encoding === "sha" ? urdfFile.content : undefined);
        const { content } = await getGitHubFileContent(
          owner,
          repo,
          urdfFile.path,
          accessToken,
          blobSha
        );
        
        const urdfText = await content.text();
        const { hasUnsupported, formats } = checkUnsupportedFormats(urdfText);
        
        // If unsupported formats found, block it - don't check for unmatched references
        if (hasUnsupported) {
          return {
            ...candidate,
            hasUnsupportedFormats: true,
            unsupportedFormats: formats,
            unmatchedMeshReferences: undefined,
          };
        }
        
        // Only check for unmatched .stl files (supported formats)
        const meshReferences = extractMeshReferencesFromURDF(urdfText);
        const unmatchedRefs: string[] = [];
        
        for (const meshRef of meshReferences) {
          // Only check .stl files - ignore unsupported formats
          const normalized = meshRef
            .replace(/^package:\/\/[^/]+\//, "")
            .replace(/^file:\/\//, "")
            .trim();
          
          const match = normalized.toLowerCase().match(/\.([a-z0-9]+)$/);
          if (match) {
            const extWithDot = `.${match[1]}`;
            // Only check unmatched for supported formats
            if (SUPPORTED_MESH_EXTENSIONS.includes(extWithDot)) {
              const file = resolveMeshPathGeneric(candidate.path, meshRef, pathMap, pathMap, "");
              if (!file) {
                unmatchedRefs.push(meshRef);
              }
            }
          }
        }
        
        return {
          ...candidate,
          hasUnsupportedFormats: false,
          unsupportedFormats: undefined,
          unmatchedMeshReferences: unmatchedRefs.length > 0 ? unmatchedRefs : undefined,
        };
      } catch (error) {
        // If we can't fetch the URDF, don't mark it as unsupported
        // (it might be a network issue, not a format issue)
        if (import.meta.env.DEV) {
          console.warn(`[GitHub] Could not check formats for ${candidate.path}:`, error);
        }
        return candidate;
      }
    })
  );
}

/**
 * Find meshes or assets folder in a specific directory
 */
function findMeshOrAssetsFolder(files: GitHubFile[], rootPath: string): { meshes?: GitHubFile; assets?: GitHubFile } {
  const meshes = files.find(
    f => f.type === "dir" &&
    f.path.toLowerCase() === `${rootPath}/meshes`.toLowerCase() &&
    f.name.toLowerCase() === "meshes"
  );
  
  const assets = files.find(
    f => f.type === "dir" &&
    f.path.toLowerCase() === `${rootPath}/assets`.toLowerCase() &&
    f.name.toLowerCase() === "assets"
  );
  
  return { meshes, assets };
}

/**
 * Find and locate robot description structures matching the pattern:
 * robot_name_description/
 *   [any_folder]/ or *.urdf  (URDF files can be in any subdirectory)
 *   meshes/ or assets/
 * 
 * This function detects the standard ROS robot description package structure.
 */
export function findRobotDescriptionStructures(files: GitHubFile[]): RobotDescriptionStructure[] {
  const structures: RobotDescriptionStructure[] = [];
  const directories = files.filter(f => f.type === "dir");
  const urdfFiles = files.filter(f => f.type === "file" && f.name.toLowerCase().endsWith(".urdf"));
  
  // Check each directory as a potential root
  for (const dir of directories) {
    const rootPath = dir.path;
    
    // Find URDF files in root or any subdirectory
    const urdfInRoot = urdfFiles.filter(urdf => {
      const urdfDir = dirname(urdf.path);
      // URDF is in root or in any subdirectory of root
      return urdfDir.toLowerCase() === rootPath.toLowerCase() || 
             urdfDir.toLowerCase().startsWith(`${rootPath}/`.toLowerCase());
    });
    
    // Check for meshes/ or assets/ folders
    const { meshes: meshesFolder, assets: assetsFolder } = findMeshOrAssetsFolder(files, rootPath);
    
    if (urdfInRoot.length > 0 && (meshesFolder || assetsFolder)) {
      const candidates: URDFCandidate[] = urdfInRoot.map(urdf => ({
        path: urdf.path,
        name: urdf.name,
        hasMeshesFolder: true,
        meshesFolderPath: meshesFolder?.path || assetsFolder?.path,
      }));
      
      structures.push({
        rootPath,
        urdfFiles: candidates,
        meshesPath: meshesFolder?.path,
        assetsPath: assetsFolder?.path,
      });
    }
  }
  
  // Check root level structure
  const rootUrdfFiles = urdfFiles.filter(urdf => dirname(urdf.path) === "");
  if (rootUrdfFiles.length > 0) {
    const { meshes: rootMeshes, assets: rootAssets } = findMeshOrAssetsFolder(files, "");
    
    if (rootMeshes || rootAssets) {
      const candidates: URDFCandidate[] = rootUrdfFiles.map(urdf => ({
        path: urdf.path,
        name: urdf.name,
        hasMeshesFolder: true,
        meshesFolderPath: rootMeshes?.path || rootAssets?.path,
      }));
      
      structures.push({
        rootPath: "",
        urdfFiles: candidates,
        meshesPath: rootMeshes?.path,
        assetsPath: rootAssets?.path,
      });
    }
  }

  return structures;
}

/**
 * Get all URDF candidates from robot description structures
 */
export function getURDFCandidatesFromStructures(structures: RobotDescriptionStructure[]): URDFCandidate[] {
  return structures.flatMap(structure => structure.urdfFiles);
}

/**
 * Decode base64 string to ArrayBuffer
 */
function decodeBase64(base64String: string): ArrayBuffer {
  const binaryString = atob(base64String.replace(/\s/g, ""));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Get MIME type from file path
 */
function getMimeType(filePath: string): string {
  const fileName = filePath.split("/").pop() || filePath;
  const lowerFileName = fileName.toLowerCase();
  
  if (lowerFileName.endsWith('.urdf') || lowerFileName.endsWith('.xml')) {
    return 'application/xml';
  }
  if (lowerFileName.endsWith('.stl')) {
    return 'model/stl';
  }
  if (lowerFileName.endsWith('.txt')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}

/**
 * Get file content from GitHub using the Blob API (most efficient)
 * Falls back to Contents API if blob SHA is not available
 */
export async function getGitHubFileContent(
  owner: string,
  repo: string,
  filePath: string,
  accessToken?: string,
  blobSha?: string
): Promise<{ content: Blob; mimeType: string }> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    ...(accessToken && { Authorization: `token ${accessToken}` }),
  };

  const url = blobSha
    ? `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`
    : `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  const response = await fetch(url, { headers });
  
  if (response.status === 404) {
    throw new Error(`File not found: ${filePath}${blobSha ? ` (SHA: ${blobSha.substring(0, 7)}...)` : ''}`);
  }

  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (rateLimitRemaining === "0") {
      throw new Error("GitHub API rate limit exceeded. Please try again later.");
    }
    if (accessToken) {
      throw new Error("Token has no access to this file. Please check your token permissions.");
    }
    throw new Error("Access denied to file.");
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const data = await response.json();
  const mimeType = getMimeType(filePath);
  
  // Both Blob API and Contents API return base64 encoded content
  if (!data.content || data.encoding !== "base64") {
    throw new Error(`File content not available in expected format: ${filePath}`);
  }

  try {
    const content = decodeBase64(data.content);
    return { content: new Blob([content], { type: mimeType }), mimeType };
  } catch (error) {
    throw new Error(`Failed to decode file content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Supported mesh file extensions
 */
const SUPPORTED_MESH_EXTENSIONS = ['.stl'];

/**
 * Extract mesh references from URDF content
 */
export function extractMeshReferencesFromURDF(urdfContent: string): string[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
  const meshReferences = new Set<string>();
  
  // Find all mesh elements in visual and collision geometries
  const meshElements = xmlDoc.querySelectorAll("mesh");
  meshElements.forEach((mesh) => {
    const filename = mesh.getAttribute("filename");
    if (filename) {
      meshReferences.add(filename);
    }
  });
  
  return Array.from(meshReferences);
}

/**
 * Check if URDF content references unsupported mesh formats
 */
function checkUnsupportedFormats(urdfContent: string): { hasUnsupported: boolean; formats: string[] } {
  const meshReferences = extractMeshReferencesFromURDF(urdfContent);
  const unsupportedFormats = new Set<string>();
  
  for (const meshRef of meshReferences) {
    // Normalize mesh reference (remove package:// and file:// prefixes)
    const normalized = meshRef
      .replace(/^package:\/\/[^/]+\//, "")
      .replace(/^file:\/\//, "")
      .trim();
    
    // Extract file extension (case-insensitive)
    const match = normalized.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (match) {
      const extWithDot = `.${match[1]}`;
      if (!SUPPORTED_MESH_EXTENSIONS.includes(extWithDot)) {
        unsupportedFormats.add(extWithDot);
      }
    }
  }
  
  return {
    hasUnsupported: unsupportedFormats.size > 0,
    formats: Array.from(unsupportedFormats).sort(),
  };
}

/**
 * Resolve a mesh reference relative to the URDF's directory
 * This implements: resolvedPath = normalize(join(dirname(urdfPath), meshRef))
 * 
 * Handles:
 * - Relative paths: "meshes/base.stl"
 * - Parent directory references: "../common/wrist.stl"
 * - Package URIs: "package://so101/meshes/elbow.stl"
 */
function resolveMeshPath(urdfDir: string, meshRef: string): string {
  // Clean and normalize mesh reference in one pass
  const path = meshRef
    .replace(/^package:\/\/[^/]+\//, "")  // Remove package:// prefix
    .replace(/^file:\/\//, "")            // Remove file:// prefix
    .trim()                                // Trim whitespace
    .replace(/\\/g, "/")                   // Normalize separators
    .replace(/^\/+/, "");                  // Remove leading slashes (treat as relative)
  
  if (!path) {
    return "";
  }
  
  // If URDF is at root, return normalized path
  if (!urdfDir) {
    return normalizePathCached(path);
  }
  
  // Split paths into parts (filter empty parts)
  const urdfParts = urdfDir.split("/").filter(Boolean);
  const meshParts = path.split("/").filter(Boolean);
  
  // Start with URDF directory parts
  const resolvedParts: string[] = [...urdfParts];
  
  // Process mesh reference parts (handle .. and .)
  for (const part of meshParts) {
    if (part === "..") {
      // Go up one directory
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
    } else if (part !== "." && part !== "") {
      // Add part to resolved path (skip "." and empty)
      resolvedParts.push(part);
    }
  }
  
  // Join and normalize
  return normalizePathCached(resolvedParts.join("/"));
}

/**
 * Check if mesh reference starts with mesh folder prefix
 */
function startsWithMeshFolder(meshRef: string): boolean {
  const lower = meshRef.toLowerCase();
  return lower.startsWith("meshes/") || lower.startsWith("meshes\\") ||
         lower.startsWith("assets/") || lower.startsWith("assets\\");
}

/**
 * Try resolving mesh from parent directory (for URDF in any subdirectory)
 * This handles cases where URDF is in a folder (any name) and meshes are in sibling meshes/ or assets/ folder
 */
function tryResolveFromParent(
  urdfDir: string,
  meshRef: string,
  lowerCaseFileMap: Map<string, GitHubFile>
): GitHubFile | null {
  const urdfDirParts = urdfDir.split("/").filter(Boolean);
  // Need at least one directory level to have a parent
  if (urdfDirParts.length === 0) return null;

  const parentDir = urdfDirParts.slice(0, -1).join("/");
  const hasMeshPrefix = startsWithMeshFolder(meshRef);

  // If mesh ref starts with meshes/assets, resolve from parent
  if (hasMeshPrefix) {
    const resolved = resolveMeshPath(parentDir, meshRef);
    if (resolved) {
      const file = lowerCaseFileMap.get(resolved.toLowerCase());
      if (file) {
        return file;
      }
    }
  } else {
    // Try adding meshes/ or assets/ prefix
    for (const folderName of ["meshes", "assets"]) {
      const meshRefWithFolder = `${folderName}/${meshRef}`;
      const resolved = resolveMeshPath(parentDir, meshRefWithFolder);
      if (resolved) {
        const file = lowerCaseFileMap.get(resolved.toLowerCase());
        if (file) {
          return file;
        }
      }
    }
  }

  return null;
}

/**
 * Resolve mesh path using simple relative path resolution
 * Searches entire repository tree (case-insensitive)
 */
function resolveMeshPathGeneric(
  urdfPath: string,
  meshRef: string,
  _fileMap: Map<string, GitHubFile>, // Unused - kept for API compatibility
  lowerCaseFileMap: Map<string, GitHubFile>,
  _rootPrefix: string // Unused - kept for API compatibility
): GitHubFile | null {
  const urdfDir = dirname(urdfPath);
  const resolved = resolveMeshPath(urdfDir, meshRef);

  if (!resolved) {
    return null;
  }

  // Try direct lookup first
  let file = lowerCaseFileMap.get(resolved.toLowerCase());
  if (file) {
    return file;
  }

  // Try resolving from parent directory if URDF is in urdf/ subdirectory
  if (urdfDir) {
    file = tryResolveFromParent(urdfDir, meshRef, lowerCaseFileMap);
    if (file) return file;
  }

  // Not found
  return null;
}

/**
 * Normalize a path (remove leading/trailing slashes, collapse multiple slashes)
 */
function normalizePath(path: string): string {
  if (!path) return "";
  // Collapse multiple slashes, then trim leading/trailing
  return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Get directory name from path (like dirname)
 */
function dirname(path: string): string {
  const lastSlashIndex = path.lastIndexOf("/");
  return lastSlashIndex >= 0 ? path.substring(0, lastSlashIndex) : "";
}


/**
 * Convert GitHub files to FileList format
 * Resolves mesh paths from URDF content and matches them against repository files
 */
export async function convertGitHubFilesToFileList(
  files: GitHubFile[],
  urdfPath: string,
  owner: string,
  repo: string,
  accessToken?: string
): Promise<FileList> {
  const dataTransfer = new DataTransfer();

  // Get URDF file from repository
  const urdfFile = files.find(f => f.type === "file" && f.path === urdfPath);
  if (!urdfFile) {
    throw new Error(`URDF file not found: ${urdfPath}`);
  }

  // Fetch URDF content first to extract mesh references
  const blobSha = urdfFile.sha || (urdfFile.encoding === "sha" ? urdfFile.content : undefined);
  const { content: urdfContent, mimeType: urdfMimeType } = await getGitHubFileContent(
    owner, 
    repo, 
    urdfFile.path, 
    accessToken,
    blobSha
  );

  // Extract URDF content as text
  const urdfText = await urdfContent.text();
  
  // Extract mesh references from URDF
  const meshReferences = extractMeshReferencesFromURDF(urdfText);

  // Create case-insensitive path map for efficient lookup
  // Only need one map since we always do case-insensitive lookups
  const pathMap = getLowerCaseFileMap(files);
  const seenPaths = new Set<string>(); // Track unique file paths to avoid duplicates

  // Resolve each mesh reference using simple path resolution
  // NO filtering by folder/basePath - searches entire repository tree
  const matchedFiles: GitHubFile[] = [];

  for (const meshRef of meshReferences) {
    const file = resolveMeshPathGeneric(urdfPath, meshRef, pathMap, pathMap, "");

    if (file && !seenPaths.has(file.path)) {
      matchedFiles.push(file);
      seenPaths.add(file.path);
    }
  }

  // Add URDF file to FileList
  // Use full repository path as webkitRelativePath for consistency
  const urdfRelativePath = urdfPath;

  const urdfFileObj = new File([urdfContent], urdfFile.name, { type: urdfMimeType });
  Object.defineProperty(urdfFileObj, "webkitRelativePath", {
    value: urdfRelativePath,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  dataTransfer.items.add(urdfFileObj);

  // Process matched mesh files in batches to avoid overwhelming the API
  const BATCH_SIZE = 15;

  for (let i = 0; i < matchedFiles.length; i += BATCH_SIZE) {
    const batch = matchedFiles.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    await Promise.all(
      batch.map(async (file) => {
        if (file.type !== "file") return;

        try {
          // Use blob SHA if available (from Trees API), otherwise fall back to file path
          const blobSha = file.sha || (file.encoding === "sha" ? file.content : undefined);
          const { content, mimeType } = await getGitHubFileContent(
            owner,
            repo,
            file.path,
            accessToken,
            blobSha
          );

          // Use the full repository path as webkitRelativePath
          // This allows the mesh loader to match it with URDF references
          const relativePath = file.path;

          // Create File object with correct MIME type
          const fileObj = new File([content], file.name, { type: mimeType });
          Object.defineProperty(fileObj, "webkitRelativePath", {
            value: relativePath,
            writable: false,
            enumerable: true,
            configurable: false,
          });

          dataTransfer.items.add(fileObj);
        } catch {
          // Continue processing other files even if one fails
        }
      })
    );

    // Small delay between batches
    if (i + BATCH_SIZE < matchedFiles.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return dataTransfer.files;
}

/**
 * Create a new GitHub repository
 */
export async function createGitHubRepository(
  name: string,
  description: string,
  isPrivate: boolean,
  accessToken: string
): Promise<{ owner: string; repo: string }> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `token ${accessToken}`,
    "Content-Type": "application/json",
  };

  // First, get the authenticated user
  const userResponse = await fetch("https://api.github.com/user", { headers });
  if (!userResponse.ok) {
    throw new Error("Failed to get authenticated user. Please check your token permissions.");
  }
  const user = await userResponse.json();
  const owner = user.login;

  // Create the repository
  const createRepoUrl = "https://api.github.com/user/repos";
  const response = await fetch(createRepoUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: false, // Don't create README, we'll add files
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (response.status === 422) {
      throw new Error(`Repository name "${name}" is invalid or already exists.`);
    }
    if (response.status === 403) {
      throw new Error("Token doesn't have permission to create repositories. Please check your token permissions.");
    }
    throw new Error(`Failed to create repository: ${response.statusText}${errorText ? ` - ${errorText.substring(0, 200)}` : ''}`);
  }

  const repo = await response.json();
  return { owner, repo: repo.name };
}

/**
 * Check if a file exists in GitHub repository
 */
export async function checkFileExists(
  owner: string,
  repo: string,
  path: string,
  accessToken: string
): Promise<{ exists: boolean; sha?: string }> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `token ${accessToken}`,
  };

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(url, { headers });

  if (response.status === 404) {
    return { exists: false };
  }

  if (!response.ok) {
    // If it's not 404, it might be a different error, but we'll assume it doesn't exist
    return { exists: false };
  }

  const data = await response.json();
  // If it's an array, it means it's a directory, not a file
  if (Array.isArray(data)) {
    return { exists: false };
  }

  return { exists: true, sha: data.sha };
}

/**
 * Check if assets folder exists (by checking if any file in assets/ exists)
 */
export async function checkAssetsFolderExists(
  owner: string,
  repo: string,
  accessToken: string
): Promise<boolean> {
  try {
    const headers: HeadersInit = {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${accessToken}`,
    };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/assets`;
    const response = await fetch(url, { headers });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    // If it's an array, it's a directory with files
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Generate commit message with urdf-studio prefix and timestamp
 */
export function generateCommitMessage(customMessage?: string): string {
  const timestamp = new Date().toISOString();
  const baseMessage = customMessage || "Update URDF and mesh files";
  return `urdf-studio: ${baseMessage} (${timestamp})`;
}

/**
 * Upload a file to GitHub repository using Contents API
 * If sha is provided, it will overwrite the existing file
 */
export async function uploadFileToGitHub(
  owner: string,
  repo: string,
  path: string,
  content: string | ArrayBuffer,
  message: string,
  accessToken: string,
  existingSha?: string
): Promise<void> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `token ${accessToken}`,
    "Content-Type": "application/json",
  };

  // Convert content to base64 if it's not already
  let base64Content: string;
  if (typeof content === "string") {
    base64Content = btoa(unescape(encodeURIComponent(content)));
  } else {
    const bytes = new Uint8Array(content);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    base64Content = btoa(binary);
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const body: { message: string; content: string; sha?: string } = {
    message,
    content: base64Content,
  };

  // Include SHA if provided (for overwriting existing files)
  if (existingSha) {
    body.sha = existingSha;
  }

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (response.status === 409) {
      throw new Error(`File already exists at ${path}. Please delete it first or use a different path.`);
    }
    throw new Error(`Failed to upload file ${path}: ${response.statusText}${errorText ? ` - ${errorText.substring(0, 200)}` : ''}`);
  }
}

/**
 * Update URDF mesh paths to point to assets/ folder
 * Preserves the original file extension
 */
export function updateURDFMeshPathsToAssets(urdfContent: string): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
  
  // Find all mesh elements
  const meshElements = xmlDoc.querySelectorAll("mesh");
  meshElements.forEach((mesh) => {
    const filename = mesh.getAttribute("filename");
    if (filename) {
      // Normalize the path
      const normalized = filename
        .replace(/^package:\/\/[^/]+\//, "")
        .replace(/^file:\/\//, "")
        .trim();
      
      // Get just the filename (last part of path) - preserves extension
      const fileName = normalized.split("/").pop() || normalized;
      
      // Update to assets/filename (preserving extension)
      mesh.setAttribute("filename", `assets/${fileName}`);
    }
  });
  
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}
