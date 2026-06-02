const DEFAULT_ASSEMBLY_REPORT_URL = "https://github.com/urdf-studio/urdf-studio/issues/new";

const normalizeGitHubIssueNewUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== "github.com") return rawUrl;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return rawUrl;
    const [owner, repo] = segments;
    if (!owner || !repo) return rawUrl;
    return `https://github.com/${owner}/${repo}/issues/new`;
  } catch {
    return rawUrl;
  }
};

export const getAssemblyReportBaseUrl = (): string => {
  const configured = (import.meta.env.VITE_ASSEMBLY_REPORT_URL as string | undefined)?.trim();
  if (configured && configured.length > 0) return normalizeGitHubIssueNewUrl(configured);
  return DEFAULT_ASSEMBLY_REPORT_URL;
};
