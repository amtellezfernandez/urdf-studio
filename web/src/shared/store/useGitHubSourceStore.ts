import { create } from "zustand";
import type { GitHubFile } from "@/features/urdf/github/githubRepo";

export type GitHubSource = {
  owner: string;
  repo: string;
  path?: string;
  token?: string;
  branch?: string;
  files: GitHubFile[];
  urdfPath?: string;
};

type GitHubSourceState = {
  source: GitHubSource | null;
  setSource: (source: GitHubSource) => void;
  clearSource: () => void;
};

export const useGitHubSourceStore = create<GitHubSourceState>((set) => ({
  source: null,
  setSource: (source) => set({ source }),
  clearSource: () => set({ source: null }),
}));
