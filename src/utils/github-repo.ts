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
  content?: string; // Base64 encoded content (when fetched directly)
  encoding?: string; // Usually "base64"
  size?: number;
}

export interface URDFCandidate {
  path: string;
  name: string;
  hasMeshesFolder: boolean;
  meshesFolderPath?: string;
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
 * Fetch repository contents recursively
 */
export async function fetchRepoContents(
  owner: string,
  repo: string,
  path: string = "",
  accessToken?: string
): Promise<GitHubFile[]> {
  const files: GitHubFile[] = [];
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const url = path ? `${baseUrl}/${path}` : baseUrl;

  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };

  if (accessToken) {
    headers.Authorization = `token ${accessToken}`;
  }

  try {
    const response = await fetch(url, { headers });

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

    if (!response.ok) {
      throw new Error(`Failed to fetch repository: ${response.statusText}`);
    }

    const data = await response.json();

    // Handle single file response
    if (data.type === "file") {
      return [{
        name: data.name,
        path: data.path,
        type: "file",
        download_url: data.download_url,
        content: data.content,
        encoding: data.encoding,
        size: data.size,
      }];
    }

    // Handle directory response
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.type === "file") {
          files.push({
            name: item.name,
            path: item.path,
            type: "file",
            download_url: item.download_url,
            content: item.content,
            encoding: item.encoding,
            size: item.size,
          });
        } else if (item.type === "dir") {
          // Include the directory itself for meshes folder detection
          files.push({
            name: item.name,
            path: item.path,
            type: "dir",
            download_url: null,
            size: item.size,
          });
          // Recursively fetch contents
          const subPath = path ? `${path}/${item.name}` : item.name;
          const subFiles = await fetchRepoContents(owner, repo, subPath, accessToken);
          files.push(...subFiles);
        }
      }
    }

    return files;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to fetch repository contents");
  }
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
 * Find all .urdf files and check if they're in folders with meshes
 */
export function findURDFCandidates(files: GitHubFile[]): URDFCandidate[] {
  const urdfFiles = files.filter(
    (file) => file.type === "file" && file.name.toLowerCase().endsWith(".urdf")
  );

  const candidates: URDFCandidate[] = [];

  for (const urdfFile of urdfFiles) {
    const urdfPath = urdfFile.path;
    const urdfDir = urdfPath.substring(0, urdfPath.lastIndexOf("/"));
    const urdfName = urdfFile.name;

    // Check if there's a meshes folder in the same directory or parent directories
    let hasMeshesFolder = false;
    let meshesFolderPath: string | undefined;

    // Check same directory (case-insensitive)
    const sameDirMeshes = files.find(
      (f) =>
        f.type === "dir" &&
        f.path.toLowerCase() === `${urdfDir}/meshes`.toLowerCase() &&
        f.name.toLowerCase() === "meshes"
    );

    if (sameDirMeshes) {
      hasMeshesFolder = true;
      meshesFolderPath = sameDirMeshes.path;
    } else {
      // Check parent directories (up to 3 levels up)
      const pathParts = urdfDir.split("/");
      for (let i = pathParts.length - 1; i >= Math.max(0, pathParts.length - 4); i--) {
        const checkPath = pathParts.slice(0, i + 1).join("/");
        const meshesInParent = files.find(
          (f) =>
            f.type === "dir" &&
            f.path.toLowerCase() === `${checkPath}/meshes`.toLowerCase() &&
            f.name.toLowerCase() === "meshes"
        );
        if (meshesInParent) {
          hasMeshesFolder = true;
          meshesFolderPath = meshesInParent.path;
          break;
        }
      }
    }

    candidates.push({
      path: urdfPath,
      name: urdfName,
      hasMeshesFolder,
      meshesFolderPath,
    });
  }

  // Sort: prioritize files with meshes folders
  return candidates.sort((a, b) => {
    if (a.hasMeshesFolder && !b.hasMeshesFolder) return -1;
    if (!a.hasMeshesFolder && b.hasMeshesFolder) return 1;
    return 0;
  });
}

/**
 * Get file content from GitHub by fetching it directly from the Contents API
 * This returns base64 encoded content which we decode
 */
export async function getGitHubFileContent(
  owner: string,
  repo: string,
  filePath: string,
  accessToken?: string
): Promise<{ content: Blob; mimeType: string }> {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const url = `${baseUrl}/${filePath}`;

  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };

  if (accessToken) {
    headers.Authorization = `token ${accessToken}`;
  }

  const response = await fetch(url, { headers });
  
  if (response.status === 404) {
    throw new Error(`File not found: ${filePath}`);
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
  
  // GitHub API returns base64 encoded content
  if (!data.content || data.encoding !== "base64") {
    throw new Error(`File content not available in expected format: ${filePath}`);
  }

  try {
    // Decode base64 content
    const binaryString = atob(data.content.replace(/\s/g, ""));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Determine MIME type based on file extension
    const fileName = data.name.toLowerCase();
    let mimeType = "application/octet-stream";
    if (fileName.endsWith('.urdf') || fileName.endsWith('.xml')) {
      mimeType = 'application/xml';
    } else if (fileName.endsWith('.stl')) {
      mimeType = 'model/stl';
    } else if (fileName.endsWith('.txt')) {
      mimeType = 'text/plain';
    }
    
    return { content: new Blob([bytes], { type: mimeType }), mimeType };
  } catch (error) {
    throw new Error(`Failed to decode file content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert GitHub files to FileList format
 */
export async function convertGitHubFilesToFileList(
  files: GitHubFile[],
  urdfPath: string,
  owner: string,
  repo: string,
  accessToken?: string
): Promise<FileList> {
  const dataTransfer = new DataTransfer();

  // Determine base path (directory containing the URDF file)
  const lastSlashIndex = urdfPath.lastIndexOf("/");
  const urdfDir = lastSlashIndex >= 0 ? urdfPath.substring(0, lastSlashIndex) : "";
  const basePath = urdfDir;

  // Get all files in the same directory tree as the URDF
  // Include the URDF file itself and all files in the same directory or subdirectories
  const relevantFiles = files.filter((file) => {
    if (file.type !== "file") return false;
    
    // Always include the URDF file itself
    if (file.path === urdfPath) return true;
    
    // For root-level URDF (no directory), include all files
    if (!basePath) return true;
    
    // Include files in the same directory or subdirectories
    const fileDir = file.path.substring(0, file.path.lastIndexOf("/"));
    return fileDir === basePath || fileDir.startsWith(basePath + "/");
  });

  // Create File objects from GitHub file data
  // Ensure URDF file is processed first
  const urdfFile = relevantFiles.find(f => f.path === urdfPath);
  const otherFiles = relevantFiles.filter(f => f.path !== urdfPath);
  
  // Process URDF file first to ensure it's included
  if (urdfFile && urdfFile.type === "file") {
    try {
      const { content, mimeType } = await getGitHubFileContent(owner, repo, urdfFile.path, accessToken);
      const relativePath = basePath ? urdfFile.path.substring(basePath.length + 1) : urdfFile.name;
      
      // Create File object with correct MIME type for URDF
      const fileObj = new File([content], urdfFile.name, { type: mimeType });
      Object.defineProperty(fileObj, "webkitRelativePath", {
        value: relativePath,
        writable: false,
      });
      dataTransfer.items.add(fileObj);
    } catch (error) {
      console.error(`Failed to get URDF file content ${urdfFile.path}:`, error);
      throw new Error(`Failed to get URDF file content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Process other files
  for (const file of otherFiles) {
    if (file.type !== "file") continue;

    try {
      const { content, mimeType } = await getGitHubFileContent(owner, repo, file.path, accessToken);
      
      // Calculate relative path from base directory
      let relativePath: string;
      if (!basePath) {
        // Root level - use filename
        relativePath = file.name;
      } else {
        // Remove base path prefix
        relativePath = file.path.startsWith(basePath + "/")
          ? file.path.substring(basePath.length + 1)
          : file.name;
      }
      
      // Create File object with correct MIME type
      const fileObj = new File([content], file.name, { type: mimeType });
      // Add webkitRelativePath for folder structure
      Object.defineProperty(fileObj, "webkitRelativePath", {
        value: relativePath,
        writable: false,
      });
      dataTransfer.items.add(fileObj);
    } catch (error) {
      console.warn(`Failed to get content for ${file.path}:`, error);
    }
  }

  return dataTransfer.files;
}

