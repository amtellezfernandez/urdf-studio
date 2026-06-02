const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

const toRawGitHubContentUrl = (url: URL): string | null => {
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!match) {
    return null;
  }
  const owner = match[1];
  const repo = match[2];
  const blobPath = match[3];
  return `https://raw.githubusercontent.com/${owner}/${repo}/${blobPath}`;
};

export const normalizeWorldLayoutImportUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return toRawGitHubContentUrl(parsed) ?? parsed.toString();
  } catch {
    return trimmed;
  }
};
