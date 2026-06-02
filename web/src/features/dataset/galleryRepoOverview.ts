import type { IluGalleryPublishedRepo, IluGalleryRepoMetadata, IluGallerySource } from "@/features/dataset/iluGalleryApi";

export type GalleryRepoOverviewLink = {
  href: string;
  label: string;
};

export type GalleryRepoOverview = {
  authorAvatarUrl: string | null;
  authorHandle: string | null;
  authorLabel: string;
  authorWebsiteHref: string | null;
  licenseLabel: string | null;
  links: GalleryRepoOverviewLink[];
  repoLabel: string;
  repoUrl: string;
  robotCountLabel: string;
  starsLabel: string | null;
  summary: string | null;
  updatedLabel: string | null;
};

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
};

const ensureUrlProtocol = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
};

const normalizeGitHubHandle = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^@+/, "")
    .split("/")[0]
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const formatDate = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const createGalleryRepoMetadataFromPublishedRepo = (
  publishedRepo: IluGalleryPublishedRepo | null | undefined
): IluGalleryRepoMetadata | null => {
  if (!publishedRepo) {
    return null;
  }
  return {
    org: normalizeText(publishedRepo.org) ?? "",
    summary: normalizeText(publishedRepo.summary) ?? "",
    demo: normalizeText(publishedRepo.demo) ?? "",
    tags: Array.isArray(publishedRepo.tags) ? publishedRepo.tags.filter(Boolean) : [],
    license: normalizeText(publishedRepo.license) ?? "",
    authorWebsite: normalizeText(publishedRepo.authorWebsite) ?? "",
    authorX: normalizeText(publishedRepo.authorX) ?? "",
    authorLinkedin: normalizeText(publishedRepo.authorLinkedin) ?? "",
    authorGithub: normalizeText(publishedRepo.authorGithub) ?? "",
    contact: normalizeText(publishedRepo.contact) ?? "",
    extra: normalizeText(publishedRepo.extra) ?? "",
    hfDatasets: Array.isArray(publishedRepo.hfDatasets) ? publishedRepo.hfDatasets.filter(Boolean) : [],
    stars: publishedRepo.stars ?? null,
    ownerLogin: normalizeText(publishedRepo.ownerLogin),
    ownerAvatar: normalizeText(publishedRepo.ownerAvatar),
    authorLogin: normalizeText(publishedRepo.authorLogin),
    authorAvatar: normalizeText(publishedRepo.authorAvatar),
    repoUpdatedAt: normalizeText(publishedRepo.repoUpdatedAt),
  };
};

const hasAnyMeaningfulMetadataValue = (metadata: IluGalleryRepoMetadata | null | undefined): boolean => {
  if (!metadata) {
    return false;
  }
  const textFields = [
    metadata.org,
    metadata.summary,
    metadata.demo,
    metadata.license,
    metadata.authorWebsite,
    metadata.authorX,
    metadata.authorLinkedin,
    metadata.authorGithub,
    metadata.contact,
    metadata.extra,
    metadata.ownerLogin,
    metadata.ownerAvatar,
    metadata.authorLogin,
    metadata.authorAvatar,
    metadata.repoUpdatedAt,
  ];
  if (textFields.some((value) => normalizeText(value) !== null)) {
    return true;
  }
  if (typeof metadata.stars === "number" && Number.isFinite(metadata.stars)) {
    return true;
  }
  if (metadata.tags.some((value) => normalizeText(value) !== null)) {
    return true;
  }
  return metadata.hfDatasets.some((value) => normalizeText(value) !== null);
};

export const resolveGalleryRepoMetadataDraft = ({
  repoMetadata,
  publishedRepo,
}: {
  repoMetadata: IluGalleryRepoMetadata | null | undefined;
  publishedRepo: IluGalleryPublishedRepo | null | undefined;
}): IluGalleryRepoMetadata | null => {
  if (hasAnyMeaningfulMetadataValue(repoMetadata)) {
    return repoMetadata ?? null;
  }
  return createGalleryRepoMetadataFromPublishedRepo(publishedRepo) ?? repoMetadata ?? null;
};

export const buildGalleryRepoOverview = ({
  itemCount,
  metadata,
  source,
  publishedRepo,
}: {
  itemCount: number;
  metadata: IluGalleryRepoMetadata;
  source: IluGallerySource;
  publishedRepo?: IluGalleryPublishedRepo | null;
}): GalleryRepoOverview => {
  const repoLabel = normalizeText(publishedRepo?.repoKey) ?? `${source.owner}/${source.repo}`;
  const repoUrl = ensureUrlProtocol(normalizeText(publishedRepo?.repo)) ?? `https://github.com/${source.owner}/${source.repo}`;
  const authorLabel = normalizeText(publishedRepo?.org) ?? normalizeText(metadata.org) ?? source.owner;
  const authorWebsiteHref = ensureUrlProtocol(normalizeText(publishedRepo?.authorWebsite) ?? normalizeText(metadata.authorWebsite));
  const authorHandleValue =
    normalizeGitHubHandle(normalizeText(publishedRepo?.authorLogin)) ??
    normalizeGitHubHandle(normalizeText(publishedRepo?.authorGithub)) ??
    normalizeGitHubHandle(normalizeText(metadata.authorLogin)) ??
    normalizeGitHubHandle(normalizeText(metadata.authorGithub));
  const authorHandle = authorHandleValue ? `@${authorHandleValue}` : null;
  const summary = normalizeText(publishedRepo?.summary) ?? normalizeText(metadata.summary);
  const licenseLabel = normalizeText(publishedRepo?.license) ?? normalizeText(metadata.license);
  const starsValue = publishedRepo?.stars ?? metadata.stars;
  const starsLabel = typeof starsValue === "number" && Number.isFinite(starsValue)
    ? starsValue.toLocaleString()
    : null;
  const updatedLabel = formatDate(normalizeText(publishedRepo?.repoUpdatedAt) ?? metadata.repoUpdatedAt);
  const authorAvatarUrl =
    normalizeText(publishedRepo?.authorAvatar) ??
    normalizeText(publishedRepo?.ownerAvatar) ??
    normalizeText(metadata.authorAvatar) ??
    normalizeText(metadata.ownerAvatar) ??
    null;

  const links: GalleryRepoOverviewLink[] = [];
  if (authorWebsiteHref) {
    links.push({ href: authorWebsiteHref, label: authorLabel });
  }
  if (authorHandleValue) {
    links.push({ href: `https://github.com/${authorHandleValue}`, label: authorHandle || authorHandleValue });
  }
  if (metadata.demo?.trim()) {
    const demoHref = ensureUrlProtocol(normalizeText(metadata.demo));
    if (demoHref) {
      links.push({ href: demoHref, label: "Demo" });
    }
  }

  return {
    authorAvatarUrl,
    authorHandle,
    authorLabel,
    authorWebsiteHref,
    licenseLabel,
    links,
    repoLabel,
    repoUrl,
    robotCountLabel: `${itemCount.toLocaleString()} ${itemCount === 1 ? "robot" : "robots"}`,
    starsLabel,
    summary,
    updatedLabel,
  };
};
