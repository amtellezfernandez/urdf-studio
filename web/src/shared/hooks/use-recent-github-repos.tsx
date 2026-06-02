import { useState, useEffect, useCallback } from "react";
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

export interface RecentGitHubRepo {
  url: string;
  owner: string;
  repo: string;
  path?: string;
  lastAccessed: number;
  displayName: string; // e.g., "owner/repo" or "owner/repo/path"
}

const RECENT_REPOS_STORAGE_KEY = "urdf-studio-recent-github-repos";
const MAX_RECENT_REPOS = 3;

export const generateDisplayName = (owner: string, repo: string, path?: string): string => {
  if (path) {
    return `${owner}/${repo}/${path}`;
  }
  return `${owner}/${repo}`;
};

export const normalizeRecentGitHubRepos = (repos: RecentGitHubRepo[]): RecentGitHubRepo[] =>
  [...repos]
    .sort((a, b) => b.lastAccessed - a.lastAccessed)
    .slice(0, MAX_RECENT_REPOS);

export const upsertRecentGitHubRepo = (
  repos: RecentGitHubRepo[],
  repo: Omit<RecentGitHubRepo, "displayName" | "lastAccessed"> & { lastAccessed?: number }
): RecentGitHubRepo[] => {
  const nextRepo: RecentGitHubRepo = {
    ...repo,
    lastAccessed: repo.lastAccessed ?? Date.now(),
    displayName: generateDisplayName(repo.owner, repo.repo, repo.path),
  };

  return normalizeRecentGitHubRepos(
    repos
      .filter((entry) => !(entry.owner === repo.owner && entry.repo === repo.repo && entry.path === repo.path))
      .concat(nextRepo)
  );
};

const persistRecentGitHubRepos = (repos: RecentGitHubRepo[]): void => {
  if (typeof window === "undefined") return;
  writeBrowserStorageItem(
    RECENT_REPOS_STORAGE_KEY,
    JSON.stringify(normalizeRecentGitHubRepos(repos)),
  );
};

/**
 * Get initial recent repos from localStorage
 */
const getInitialRecentRepos = (): RecentGitHubRepo[] => {
  if (typeof window === "undefined") return [];

  try {
    const stored = readBrowserStorageItem(RECENT_REPOS_STORAGE_KEY);
    if (stored) {
      const repos = JSON.parse(stored) as unknown;
      if (!Array.isArray(repos)) {
        return [];
      }
      return normalizeRecentGitHubRepos(repos as RecentGitHubRepo[]);
    }
  } catch (error) {
    console.error("Failed to parse recent GitHub repos from localStorage:", error);
  }

  return [];
};

/**
 * Hook to manage recent GitHub repositories
 */
export function useRecentGitHubRepos() {
  const [recentRepos, setRecentRepos] = useState<RecentGitHubRepo[]>(getInitialRecentRepos);

  /**
   * Add or update a repository in recent repos
   */
  const addRecentRepo = useCallback((owner: string, repo: string, path?: string, url?: string) => {
    setRecentRepos((currentRepos) => {
      const nextRepos = upsertRecentGitHubRepo(currentRepos, {
        owner,
        repo,
        path,
        url: url || (path ? `${owner}/${repo}/${path}` : `${owner}/${repo}`),
      });
      try {
        persistRecentGitHubRepos(nextRepos);
      } catch (error) {
        console.error("Failed to save recent GitHub repos to localStorage:", error);
      }
      return nextRepos;
    });
  }, []);

  /**
   * Remove a repository from recent repos
   */
  const removeRecentRepo = useCallback((owner: string, repo: string, path?: string) => {
    setRecentRepos((currentRepos) => {
      const filteredRepos = currentRepos.filter(
        (r) => !(r.owner === owner && r.repo === repo && r.path === path)
      );

      try {
        persistRecentGitHubRepos(filteredRepos);
      } catch (error) {
        console.error("Failed to save recent GitHub repos to localStorage:", error);
      }

      return filteredRepos;
    });
  }, []);

  /**
   * Clear all recent repos
   */
  const clearRecentRepos = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      removeBrowserStorageItem(RECENT_REPOS_STORAGE_KEY);
      setRecentRepos([]);
    } catch (error) {
      console.error("Failed to clear recent GitHub repos from localStorage:", error);
    }
  }, []);

  // Update state when localStorage changes (e.g., from another tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === RECENT_REPOS_STORAGE_KEY) {
        setRecentRepos(getInitialRecentRepos());
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  return {
    recentRepos,
    addRecentRepo,
    removeRecentRepo,
    clearRecentRepos,
  };
}
