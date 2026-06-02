import { describe, expect, it } from "vitest";

import { buildGalleryRepoOverview, createGalleryRepoMetadataFromPublishedRepo, resolveGalleryRepoMetadataDraft } from "@/features/dataset/galleryRepoOverview";

describe("buildGalleryRepoOverview", () => {
  it("builds a repo-style header summary from gallery metadata", () => {
    expect(
      buildGalleryRepoOverview({
        itemCount: 3,
        metadata: {
          org: "The Robot Studio",
          summary: "Compact desktop arm repository.",
          demo: "demo.therobotstudio.com/so100",
          tags: ["Arm"],
          license: "Apache-2.0",
          authorWebsite: "therobotstudio.com",
          authorX: "",
          authorLinkedin: "",
          authorGithub: "@TheRobotStudio",
          contact: "",
          extra: "",
          hfDatasets: [],
          stars: 5585,
          ownerAvatar: "https://avatars.example/owner.png",
          authorAvatar: "https://avatars.example/author.png",
          authorLogin: "TheRobotStudio",
          repoUpdatedAt: "2026-03-02T12:00:00Z",
        },
        source: {
          owner: "TheRobotStudio",
          repo: "SO-ARM100",
        },
      })
    ).toEqual({
      authorAvatarUrl: "https://avatars.example/author.png",
      authorHandle: "@TheRobotStudio",
      authorLabel: "The Robot Studio",
      authorWebsiteHref: "https://therobotstudio.com",
      licenseLabel: "Apache-2.0",
      links: [
        { href: "https://therobotstudio.com", label: "The Robot Studio" },
        { href: "https://github.com/TheRobotStudio", label: "@TheRobotStudio" },
        { href: "https://demo.therobotstudio.com/so100", label: "Demo" },
      ],
      repoLabel: "TheRobotStudio/SO-ARM100",
      repoUrl: "https://github.com/TheRobotStudio/SO-ARM100",
      robotCountLabel: "3 robots",
      starsLabel: "5,585",
      summary: "Compact desktop arm repository.",
      updatedLabel: new Date("2026-03-02T12:00:00Z").toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    });
  });

  it("falls back to source ownership when optional stats are unavailable", () => {
    expect(
      buildGalleryRepoOverview({
        itemCount: 1,
        metadata: {
          org: "",
          summary: "",
          demo: "",
          tags: [],
          license: "",
          authorWebsite: "",
          authorX: "",
          authorLinkedin: "",
          authorGithub: "",
          contact: "",
          extra: "",
          hfDatasets: [],
        },
        source: {
          owner: "acme-labs",
          repo: "field-bot",
        },
      })
    ).toEqual({
      authorAvatarUrl: null,
      authorHandle: null,
      authorLabel: "acme-labs",
      authorWebsiteHref: null,
      licenseLabel: null,
      links: [],
      repoLabel: "acme-labs/field-bot",
      repoUrl: "https://github.com/acme-labs/field-bot",
      robotCountLabel: "1 robot",
      starsLabel: null,
      summary: null,
      updatedLabel: null,
    });
  });
});


describe("createGalleryRepoMetadataFromPublishedRepo", () => {
  it("maps the published repo payload into editable metadata fields", () => {
    expect(createGalleryRepoMetadataFromPublishedRepo({
      repo: "https://github.com/TheRobotStudio/SO-ARM100",
      repoKey: "TheRobotStudio/SO-ARM100",
      summary: "Standard Open Arm 100",
      org: "The Robot Studio",
      demo: "",
      tags: ["Arm"],
      robots: [],
      hfDatasets: ["https://huggingface.co/datasets/lirislab/sweep_tissue_cube"],
      authorWebsite: "https://www.therobotstudio.com/",
      authorX: "",
      authorLinkedin: "",
      authorGithub: "TheRobotStudio",
      contact: "",
      extra: "",
      stars: 5585,
      ownerLogin: "TheRobotStudio",
      ownerAvatar: "https://avatars.example/owner.png",
      authorLogin: "TheRobotStudio",
      authorAvatar: "https://avatars.example/author.png",
      repoUpdatedAt: "2026-03-02T12:00:00Z",
      updatedAt: "2026-03-02T12:00:00Z",
      license: "Apache-2.0",
    })).toEqual({
      org: "The Robot Studio",
      summary: "Standard Open Arm 100",
      demo: "",
      tags: ["Arm"],
      license: "Apache-2.0",
      authorWebsite: "https://www.therobotstudio.com/",
      authorX: "",
      authorLinkedin: "",
      authorGithub: "TheRobotStudio",
      contact: "",
      extra: "",
      hfDatasets: ["https://huggingface.co/datasets/lirislab/sweep_tissue_cube"],
      stars: 5585,
      ownerLogin: "TheRobotStudio",
      ownerAvatar: "https://avatars.example/owner.png",
      authorLogin: "TheRobotStudio",
      authorAvatar: "https://avatars.example/author.png",
      repoUpdatedAt: "2026-03-02T12:00:00Z",
    });
  });

  it("returns null when no published repo is available", () => {
    expect(createGalleryRepoMetadataFromPublishedRepo(null)).toBeNull();
  });
});


describe("resolveGalleryRepoMetadataDraft", () => {
  it("prefers saved repo metadata over stale published repo values", () => {
    expect(resolveGalleryRepoMetadataDraft({
      repoMetadata: {
        org: "Edited Org",
        summary: "Edited summary",
        demo: "https://demo.example",
        tags: ["Arm"],
        license: "MIT",
        authorWebsite: "https://edited.example",
        authorX: "@edited",
        authorLinkedin: "",
        authorGithub: "edited",
        contact: "contact@example.com",
        extra: "notes",
        hfDatasets: ["https://huggingface.co/datasets/edited/demo"],
      },
      publishedRepo: {
        repo: "https://github.com/TheRobotStudio/SO-ARM100",
        repoKey: "TheRobotStudio/SO-ARM100",
        summary: "Published summary",
        org: "The Robot Studio",
        demo: "",
        tags: [],
        robots: [],
        hfDatasets: [],
        authorWebsite: "https://www.therobotstudio.com/",
        authorX: "",
        authorLinkedin: "",
        authorGithub: "TheRobotStudio",
        contact: "",
        extra: "",
        license: "Apache-2.0",
      },
    })).toEqual({
      org: "Edited Org",
      summary: "Edited summary",
      demo: "https://demo.example",
      tags: ["Arm"],
      license: "MIT",
      authorWebsite: "https://edited.example",
      authorX: "@edited",
      authorLinkedin: "",
      authorGithub: "edited",
      contact: "contact@example.com",
      extra: "notes",
      hfDatasets: ["https://huggingface.co/datasets/edited/demo"],
    });
  });

  it("falls back to published repo metadata when the job metadata is still empty", () => {
    expect(resolveGalleryRepoMetadataDraft({
      repoMetadata: {
        org: "",
        summary: "",
        demo: "",
        tags: [],
        license: "",
        authorWebsite: "",
        authorX: "",
        authorLinkedin: "",
        authorGithub: "",
        contact: "",
        extra: "",
        hfDatasets: [],
      },
      publishedRepo: {
        repo: "https://github.com/TheRobotStudio/SO-ARM100",
        repoKey: "TheRobotStudio/SO-ARM100",
        summary: "Published summary",
        org: "The Robot Studio",
        demo: "",
        tags: ["Arm"],
        robots: [],
        hfDatasets: ["https://huggingface.co/datasets/published/demo"],
        authorWebsite: "https://www.therobotstudio.com/",
        authorX: "",
        authorLinkedin: "",
        authorGithub: "TheRobotStudio",
        contact: "",
        extra: "",
        license: "Apache-2.0",
      },
    })).toEqual({
      org: "The Robot Studio",
      summary: "Published summary",
      demo: "",
      tags: ["Arm"],
      license: "Apache-2.0",
      authorWebsite: "https://www.therobotstudio.com/",
      authorX: "",
      authorLinkedin: "",
      authorGithub: "TheRobotStudio",
      contact: "",
      extra: "",
      hfDatasets: ["https://huggingface.co/datasets/published/demo"],
      stars: null,
      ownerLogin: null,
      ownerAvatar: null,
      authorLogin: null,
      authorAvatar: null,
      repoUpdatedAt: null,
    });
  });
});
