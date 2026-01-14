import { useState, useEffect, useCallback } from "react";

interface RecentGitHubRepo {
  url: string;
  owner: string;
  repo: string;
  path?: string;
  lastAccessed: number;
  displayName: string; // e.g., "owner/repo" or "owner/repo/path"
}

const RECENT_REPOS_STORAGE_KEY = "urdf-studio-recent-github-repos";
const MAX_RECENT_REPOS = 3;

/**
 * Get initial recent repos from localStorage
 */
const getInitialRecentRepos = (): RecentGitHubRepo[] => {
  if (typeof window === "undefined") return [];
  
  try {
    const stored = localStorage.getItem(RECENT_REPOS_STORAGE_KEY);
    if (stored) {
      const repos = JSON.parse(stored) as RecentGitHubRepo[];
      // Sort by lastAccessed (most recent first) and limit to MAX_RECENT_REPOS
      return repos
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, MAX_RECENT_REPOS);
    }
  } catch (error) {
    console.error("Failed to parse recent GitHub repos from localStorage:", error);
  }
  
  return [];
};

/**
 * Generate display name for a repository
 */
const generateDisplayName = (owner: string, repo: string, path?: string): string => {
  if (path) {
    return `${owner}/${repo}/${path}`;
  }
  return `${owner}/${repo}`;
};

/**
 * Hook to manage recent GitHub repositories
 */
export function useRecentGitHubRepos() {
  const [recentRepos, setRecentRepos] = useState<RecentGitHubRepo[]>(getInitialRecentRepos);

  /**
   * Save recent repos to localStorage
   */
  const saveRecentRepos = useCallback((repos: RecentGitHubRepo[]) => {
    if (typeof window === "undefined") return;
    
    try {
      // Sort by lastAccessed (most recent first) and limit to MAX_RECENT_REPOS
      const sortedRepos = repos
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, MAX_RECENT_REPOS);
      
      localStorage.setItem(RECENT_REPOS_STORAGE_KEY, JSON.stringify(sortedRepos));
      setRecentRepos(sortedRepos);
    } catch (error) {
      console.error("Failed to save recent GitHub repos to localStorage:", error);
    }
  }, []);

  /**
   * Add or update a repository in recent repos
   */
  const addRecentRepo = useCallback((owner: string, repo: string, path?: string, url?: string) => {
    const displayName = generateDisplayName(owner, repo, path);
    const repoUrl = url || (path ? `${owner}/${repo}/${path}` : `${owner}/${repo}`);
    
    const newRepo: RecentGitHubRepo = {
      url: repoUrl,
      owner,
      repo,
      path,
      lastAccessed: Date.now(),
      displayName,
    };

    // Use current state instead of reading from localStorage
    setRecentRepos((currentRepos) => {
      // Filter out the repo if it already exists (same owner, repo, and path)
      const filteredRepos = currentRepos.filter(
        (r) => !(r.owner === owner && r.repo === repo && r.path === path)
      );

      // Add new repo at the beginning (most recent)
      const updatedRepos = [newRepo, ...filteredRepos];
      
      // Save to localStorage
      try {
        if (typeof window !== "undefined") {
          const sortedRepos = updatedRepos
            .sort((a, b) => b.lastAccessed - a.lastAccessed)
            .slice(0, MAX_RECENT_REPOS);
          localStorage.setItem(RECENT_REPOS_STORAGE_KEY, JSON.stringify(sortedRepos));
        }
      } catch (error) {
        console.error("Failed to save recent GitHub repos to localStorage:", error);
      }
      
      // Return sorted and limited repos
      return updatedRepos
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, MAX_RECENT_REPOS);
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
      
      // Save to localStorage
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem(RECENT_REPOS_STORAGE_KEY, JSON.stringify(filteredRepos));
        }
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
      localStorage.removeItem(RECENT_REPOS_STORAGE_KEY);
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
