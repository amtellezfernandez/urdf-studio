import { WORKSPACE_TRANSFER_PARAMS } from "@/features/world-share/workspaceTransferParams";
import { blobToBase64 } from "@/shared/lib/blobEncoding";

export type WorkspaceTransferMeshAssetUpload = {
  path: string;
  aliases: string[];
  content_base64: string;
  mime?: string | null;
};

type WorkspaceTransferAbortOptions = {
  signal?: AbortSignal;
};

const HOST_ABSOLUTE_ROOT_SEGMENTS = new Set([
  "applications",
  "bin",
  "boot",
  "dev",
  "etc",
  "home",
  "library",
  "media",
  "mnt",
  "opt",
  "private",
  "proc",
  "program files",
  "root",
  "run",
  "sbin",
  "sys",
  "system",
  "tmp",
  "users",
  "usr",
  "var",
  "volumes",
]);

const normalizeUploadPath = (
  value: string,
  { allowRootRelativeAsset = false } = {}
): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("\\\\")) return null;
  const slashNormalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (slashNormalized.startsWith("/")) {
    if (!allowRootRelativeAsset) return null;
    const rootRelative = slashNormalized.replace(/^\/+/, "");
    const [firstSegment] = rootRelative.split("/");
    if (
      !firstSegment ||
      HOST_ABSOLUTE_ROOT_SEGMENTS.has(firstSegment.toLowerCase())
    ) {
      return null;
    }
    return normalizeUploadPath(rootRelative);
  }
  const normalized = slashNormalized;
  if (normalized.startsWith("~")) return null;
  if (!normalized || normalized.includes("\0") || normalized.includes(":")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  const portablePath = parts.filter((part) => part !== ".").join("/");
  return portablePath || null;
};

const addAlias = (aliases: Set<string>, value: string | null | undefined): void => {
  if (!value || aliases.size >= WORKSPACE_TRANSFER_PARAMS.maxAssetAliases) return;
  const normalized = normalizeUploadPath(value);
  if (normalized) aliases.add(normalized);
};

const buildAssetAliases = (
  path: string,
  packageRoots: Record<string, string[]> | undefined
): string[] => {
  const aliases = new Set<string>();
  const normalizedPath = normalizeUploadPath(path, { allowRootRelativeAsset: true });
  if (!normalizedPath) {
    throw new Error(`Workspace mesh asset path must be portable relative: ${path}`);
  }
  addAlias(aliases, normalizedPath);
  if (!packageRoots) return [...aliases];

  Object.entries(packageRoots).forEach(([packageName, roots]) => {
    const normalizedPackageName = normalizeUploadPath(packageName);
    if (!normalizedPackageName) return;
    roots.forEach((root) => {
      const normalizedRoot = normalizeUploadPath(root);
      if (!normalizedRoot) return;
      if (normalizedPath === normalizedRoot) {
        addAlias(aliases, normalizedPackageName);
        return;
      }
      if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
        addAlias(
          aliases,
          `${normalizedPackageName}/${normalizedPath.slice(normalizedRoot.length + 1)}`
        );
      }
    });
    if (normalizedPath.includes("/")) {
      addAlias(aliases, `${normalizedPackageName}/${normalizedPath}`);
    }
  });

  return [...aliases];
};

const createWorkspaceTransferAbortError = (): Error => {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Workspace transfer cancelled.", "AbortError");
  }
  const error = new Error("Workspace transfer cancelled.");
  error.name = "AbortError";
  return error;
};

export const throwIfWorkspaceTransferAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createWorkspaceTransferAbortError();
  }
};

export const buildWorkspaceTransferMeshAssetUploads = async (
  meshFiles: Record<string, Blob>,
  packageRoots?: Record<string, string[]>,
  options: WorkspaceTransferAbortOptions = {}
): Promise<WorkspaceTransferMeshAssetUpload[]> => {
  const pathsByBlob = new Map<Blob, Set<string>>();
  const blobByAlias = new Map<string, Blob>();
  throwIfWorkspaceTransferAborted(options.signal);

  Object.entries(meshFiles).forEach(([path, blob]) => {
    const aliases = buildAssetAliases(path, packageRoots);
    aliases.forEach((alias) => {
      const current = blobByAlias.get(alias);
      if (current && current !== blob) return;
      blobByAlias.set(alias, blob);
      const paths = pathsByBlob.get(blob) ?? new Set<string>();
      paths.add(alias);
      pathsByBlob.set(blob, paths);
    });
  });

  return Promise.all(
    [...pathsByBlob.entries()].map(async ([blob, paths]) => {
      throwIfWorkspaceTransferAborted(options.signal);
      const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
      const [path, ...aliases] = sortedPaths;
      const contentBase64 = await blobToBase64(blob);
      throwIfWorkspaceTransferAborted(options.signal);
      return {
        path,
        aliases: aliases.slice(0, WORKSPACE_TRANSFER_PARAMS.maxAssetAliases),
        content_base64: contentBase64,
        mime: blob.type || null,
      };
    })
  );
};
