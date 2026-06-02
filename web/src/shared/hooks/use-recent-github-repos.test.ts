import { describe, expect, it } from "vitest";

import {
  generateDisplayName,
  normalizeRecentGitHubRepos,
  upsertRecentGitHubRepo,
  type RecentGitHubRepo,
} from "@/shared/hooks/use-recent-github-repos";

const RECENT_TIME_START_MS = 1_000;
const RECENT_TIME_STEP_MS = 100;

const createRecentRepo = (
  owner: string,
  repo: string,
  lastAccessed: number,
  path?: string
): RecentGitHubRepo => ({
  owner,
  repo,
  path,
  url: path ? `https://github.com/${owner}/${repo}/tree/HEAD/${path}` : `https://github.com/${owner}/${repo}`,
  lastAccessed,
  displayName: generateDisplayName(owner, repo, path),
});

describe("useRecentGitHubRepos helpers", () => {
  it("builds a compact display name with an optional path", () => {
    expect(generateDisplayName("TheRobotStudio", "SO-ARM100")).toBe("TheRobotStudio/SO-ARM100");
    expect(generateDisplayName("TheRobotStudio", "SO-ARM100", "robots/arm")).toBe(
      "TheRobotStudio/SO-ARM100/robots/arm"
    );
  });

  it("normalizes stored repos by most recent access and keeps only the latest three", () => {
    const initialRecentTime = RECENT_TIME_START_MS;
    const normalized = normalizeRecentGitHubRepos([
      createRecentRepo("org", "repo-a", initialRecentTime + RECENT_TIME_STEP_MS),
      createRecentRepo("org", "repo-b", initialRecentTime + RECENT_TIME_STEP_MS * 3),
      createRecentRepo("org", "repo-c", initialRecentTime),
      createRecentRepo("org", "repo-d", initialRecentTime + RECENT_TIME_STEP_MS * 2),
    ]);

    expect(normalized.map((repo) => repo.repo)).toEqual(["repo-b", "repo-d", "repo-a"]);
  });

  it("upserts a repo by owner, repo, and path while refreshing recency", () => {
    const initialRecentTime = RECENT_TIME_START_MS;
    const repos = [
      createRecentRepo("TheRobotStudio", "SO-ARM100", initialRecentTime, "robots/main"),
      createRecentRepo("acme", "beta", initialRecentTime + RECENT_TIME_STEP_MS),
    ];

    const updated = upsertRecentGitHubRepo(repos, {
      owner: "TheRobotStudio",
      repo: "SO-ARM100",
      path: "robots/main",
      url: "https://github.com/TheRobotStudio/SO-ARM100/tree/main/robots/main",
      lastAccessed: initialRecentTime + RECENT_TIME_STEP_MS * 2,
    });

    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({
      owner: "TheRobotStudio",
      repo: "SO-ARM100",
      path: "robots/main",
      displayName: "TheRobotStudio/SO-ARM100/robots/main",
    });
    expect(updated[1]?.repo).toBe("beta");
  });
});
