import { create } from "zustand";

type LinkHighlightState = {
  highlightedLinks: string[];
  setHighlightedLinks: (links: string[]) => void;
  clearHighlightedLinks: () => void;
};

const toSortedUniqueLinks = (links: string[]) =>
  Array.from(new Set(links)).sort((lhs, rhs) => lhs.localeCompare(rhs));

export const useLinkHighlightStore = create<LinkHighlightState>((set) => ({
  highlightedLinks: [],
  setHighlightedLinks: (links) => {
    set({ highlightedLinks: toSortedUniqueLinks(links) });
  },
  clearHighlightedLinks: () => {
    set({ highlightedLinks: [] });
  },
}));

