import { useCallback, useEffect, useState } from "react";
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

type RecentLinkEntry = {
  url: string;
  label: string;
  lastAccessed: number;
};

type UseRecentLinksOptions = {
  storageKey: string;
  maxItems?: number;
};

const DEFAULT_MAX_RECENT_LINKS = 6;

const parseStoredRecentLinks = (raw: string | null): RecentLinkEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecentLinkEntry => {
      if (typeof entry !== "object" || entry === null) return false;
      const record = entry as Record<string, unknown>;
      return (
        typeof record.url === "string" &&
        typeof record.label === "string" &&
        typeof record.lastAccessed === "number" &&
        Number.isFinite(record.lastAccessed)
      );
    });
  } catch {
    return [];
  }
};

const sortAndTrim = (
  entries: RecentLinkEntry[],
  maxItems: number
): RecentLinkEntry[] =>
  [...entries]
    .sort((left, right) => right.lastAccessed - left.lastAccessed)
    .slice(0, maxItems);

export const toRecentLinkLabel = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const tail = normalizedPath.split("/").filter(Boolean).slice(-2).join("/");
    return tail ? `${parsed.hostname}/${tail}` : parsed.hostname;
  } catch {
    return trimmed;
  }
};

export const useRecentLinks = ({
  storageKey,
  maxItems = DEFAULT_MAX_RECENT_LINKS,
}: UseRecentLinksOptions) => {
  const [recentLinks, setRecentLinks] = useState<RecentLinkEntry[]>(() => {
    if (typeof window === "undefined") return [];
    return sortAndTrim(parseStoredRecentLinks(readBrowserStorageItem(storageKey)), maxItems);
  });

  const addRecentLink = useCallback(
    (url: string, label?: string) => {
      const normalizedUrl = url.trim();
      if (!normalizedUrl) return;
      const nextEntry: RecentLinkEntry = {
        url: normalizedUrl,
        label: (label?.trim() || toRecentLinkLabel(normalizedUrl)).slice(0, 80),
        lastAccessed: Date.now(),
      };
      setRecentLinks((previous) => {
        const next = sortAndTrim(
          [nextEntry, ...previous.filter((entry) => entry.url !== normalizedUrl)],
          maxItems
        );
        if (typeof window !== "undefined") {
          writeBrowserStorageItem(storageKey, JSON.stringify(next));
        }
        return next;
      });
    },
    [maxItems, storageKey]
  );

  const removeRecentLink = useCallback(
    (url: string) => {
      setRecentLinks((previous) => {
        const next = previous.filter((entry) => entry.url !== url);
        if (typeof window !== "undefined") {
          writeBrowserStorageItem(storageKey, JSON.stringify(next));
        }
        return next;
      });
    },
    [storageKey]
  );

  const clearRecentLinks = useCallback(() => {
    if (typeof window !== "undefined") {
      removeBrowserStorageItem(storageKey);
    }
    setRecentLinks([]);
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setRecentLinks(sortAndTrim(parseStoredRecentLinks(event.newValue), maxItems));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [maxItems, storageKey]);

  return {
    recentLinks,
    addRecentLink,
    removeRecentLink,
    clearRecentLinks,
  };
};

export type { RecentLinkEntry };
