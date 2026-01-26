/**
 * DatasetSearchBar - Search input for HuggingFace datasets
 */

import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { Search, X, Loader2, History, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import { useDatasetStore } from "./useDatasetStore";
import type { DatasetInfo } from "./types";

// ============================================================================
// Types
// ============================================================================

interface DatasetSearchBarProps {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onSelect?: (dataset: DatasetInfo) => void;
}

interface SearchSuggestion {
  id: string;
  name: string;
  author?: string;
  downloads?: number;
  type: "result" | "recent";
}

// ============================================================================
// Search Suggestions Dropdown
// ============================================================================

interface SuggestionsDropdownProps {
  suggestions: SearchSuggestion[];
  isLoading: boolean;
  onSelect: (suggestion: SearchSuggestion) => void;
  selectedIndex: number;
}

function SuggestionsDropdown({
  suggestions,
  isLoading,
  onSelect,
  selectedIndex,
}: SuggestionsDropdownProps) {
  if (suggestions.length === 0 && !isLoading) return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden">
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && suggestions.length > 0 && (
        <ul className="max-h-[300px] overflow-auto">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.id}>
              <button
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors",
                  index === selectedIndex && "bg-muted"
                )}
                onClick={() => onSelect(suggestion)}
              >
                {suggestion.type === "recent" ? (
                  <History className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{suggestion.name}</p>
                  {suggestion.author && (
                    <p className="text-xs text-muted-foreground truncate">
                      {suggestion.author}
                    </p>
                  )}
                </div>
                {suggestion.downloads !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {suggestion.downloads.toLocaleString()} downloads
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DatasetSearchBar({
  className,
  placeholder = "Search HuggingFace datasets...",
  autoFocus = false,
  onSelect,
}: DatasetSearchBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  const {
    recentDatasets,
    setSearchQuery,
    selectDataset,
    addToRecent,
  } = useDatasetStore();

  // Debounced search query
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Search query
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ["dataset-search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return [];

      // Mock API call - replace with actual HuggingFace API
      const response = await fetch(
        `https://huggingface.co/api/datasets?search=${encodeURIComponent(debouncedQuery)}&limit=10&filter=task_categories:robotics`
      );

      if (!response.ok) return [];

      const data = await response.json();
      return data.map((item: Record<string, unknown>) => ({
        id: item.id as string,
        name: (item.id as string).split("/").pop() || item.id,
        author: (item.id as string).split("/")[0],
        downloads: item.downloads as number,
        type: "result" as const,
      }));
    },
    enabled: debouncedQuery.length >= 2,
  });

  // Build suggestions list
  const suggestions = useMemo(() => {
    const result: SearchSuggestion[] = [];

    // Add recent datasets if no query
    if (!query && recentDatasets.length > 0) {
      result.push(
        ...recentDatasets.slice(0, 5).map((d) => ({
          id: d.id,
          name: d.name,
          author: d.author,
          downloads: d.downloads,
          type: "recent" as const,
        }))
      );
    }

    // Add search results
    if (searchResults) {
      result.push(...searchResults);
    }

    return result;
  }, [query, recentDatasets, searchResults]);

  // Handle selection
  const handleSelect = useCallback(
    (suggestion: SearchSuggestion) => {
      const dataset: DatasetInfo = {
        id: suggestion.id,
        name: suggestion.name,
        source: "huggingface",
        author: suggestion.author,
        downloads: suggestion.downloads,
        tags: [],
      };

      addToRecent(dataset);
      selectDataset(dataset.id);
      setQuery(suggestion.name);
      setIsFocused(false);

      if (onSelect) {
        onSelect(dataset);
      }
    },
    [addToRecent, selectDataset, onSelect]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex]);
      } else if (e.key === "Escape") {
        setIsFocused(false);
        inputRef.current?.blur();
      }
    },
    [suggestions, selectedIndex, handleSelect]
  );

  // Handle search submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        setSearchQuery(query.trim());
        setIsFocused(false);
      }
    },
    [query, setSearchQuery]
  );

  // Clear search
  const handleClear = useCallback(() => {
    setQuery("");
    setSearchQuery("");
    inputRef.current?.focus();
  }, [setSearchQuery]);

  return (
    <div className={cn("relative", className)}>
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(-1);
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              // Delay to allow click on suggestions
              setTimeout(() => setIsFocused(false), 200);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="pl-9 pr-20"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleClear}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <a
              href="https://huggingface.co/datasets?task_categories=task_categories:robotics"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Browse on HuggingFace"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </form>

      {/* Suggestions dropdown */}
      {isFocused && (suggestions.length > 0 || isLoading) && (
        <SuggestionsDropdown
          suggestions={suggestions}
          isLoading={isLoading}
          onSelect={handleSelect}
          selectedIndex={selectedIndex}
        />
      )}
    </div>
  );
}
