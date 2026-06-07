/**
 * DatasetBrowser - Grid/list view of datasets
 */

import { useCallback, useEffect, useRef } from "react";
import {
  LayoutGrid,
  List,
  Filter,
  SortAsc,
  SortDesc,
  Loader2,
  Database,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";

import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";

import { DatasetSearchBar } from "./DatasetSearchBar";
import { DatasetCard } from "./DatasetCard";
import {
  useDatasetStore,
  selectFilteredDatasets,
  selectHasActiveFilters,
} from "./useDatasetStore";
import type { DatasetInfo, DatasetFilters, HuggingFaceSearchResponse } from "./types";

// ============================================================================
// Types
// ============================================================================

interface DatasetBrowserProps {
  className?: string;
  onSelect?: (dataset: DatasetInfo) => void;
  showFilters?: boolean;
  title?: string;
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar() {
  const { filters, setFilters, clearFilters } = useDatasetStore();
  const hasActiveFilters = useDatasetStore(selectHasActiveFilters);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Source filter */}
      <Select
        value={filters.source}
        onValueChange={(value) =>
          setFilters({ source: value as DatasetFilters["source"] })
        }
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="huggingface">HuggingFace</SelectItem>
          <SelectItem value="local">Local</SelectItem>
        </SelectContent>
      </Select>

      {/* Robot type filter */}
      <Select
        value={filters.robotType || "all"}
        onValueChange={(value) =>
          setFilters({ robotType: value === "all" ? undefined : value })
        }
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Robot" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Robots</SelectItem>
          <SelectItem value="franka">Franka</SelectItem>
          <SelectItem value="kuka">KUKA</SelectItem>
          <SelectItem value="ur5">UR5</SelectItem>
          <SelectItem value="aloha">Aloha</SelectItem>
          <SelectItem value="mobile">Mobile</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort */}
      <Select
        value={filters.sortBy}
        onValueChange={(value) =>
          setFilters({ sortBy: value as DatasetFilters["sortBy"] })
        }
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="downloads">Downloads</SelectItem>
          <SelectItem value="likes">Likes</SelectItem>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="lastModified">Recent</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort order */}
      <Button
        variant="outline"
        size="sm"
        className="h-9 px-2"
        onClick={() =>
          setFilters({ sortOrder: filters.sortOrder === "asc" ? "desc" : "asc" })
        }
      >
        {filters.sortOrder === "asc" ? (
          <SortAsc className="h-4 w-4" />
        ) : (
          <SortDesc className="h-4 w-4" />
        )}
      </Button>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
          Clear
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  const { clearFilters } = useDatasetStore();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Database className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-2">
        {hasFilters ? "No matching datasets" : "No datasets found"}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">
        {hasFilters
          ? "Try adjusting your filters or search query to find datasets."
          : "Search for datasets on HuggingFace or add local datasets."}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Dataset Grid
// ============================================================================

interface DatasetGridProps {
  datasets: DatasetInfo[];
  viewMode: "grid" | "list";
  selectedDatasetId: string | null;
  onSelectDataset: (datasetId: string) => void;
  onUseDataset: (dataset: DatasetInfo) => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

function DatasetGrid({
  datasets,
  viewMode,
  selectedDatasetId,
  onSelectDataset,
  onUseDataset,
  isLoadingMore,
  hasMore,
  onLoadMore,
}: DatasetGridProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Infinite scroll
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  return (
    <div className="flex-1 overflow-auto">
      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
          {datasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              isSelected={selectedDatasetId === dataset.id}
              onClick={() => onSelectDataset(dataset.id)}
              onSelect={onUseDataset}
            />
          ))}
        </div>
      ) : (
        <div className="divide-y">
          {datasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              isSelected={selectedDatasetId === dataset.id}
              onClick={() => onSelectDataset(dataset.id)}
              onSelect={onUseDataset}
              compact
            />
          ))}
        </div>
      )}

      {/* Load more trigger */}
      {hasMore && (
        <div ref={loadMoreRef} className="flex justify-center py-8">
          {isLoadingMore ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <Button variant="outline" onClick={onLoadMore}>
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DatasetBrowser({
  className,
  onSelect,
  showFilters = true,
  title = "Dataset Browser",
}: DatasetBrowserProps) {
  const {
    datasets,
    isLoading,
    error,
    viewMode,
    selectedDatasetId,
    hasMore,
    filters,
    setViewMode,
    selectDataset,
    setDatasets,
    appendDatasets,
    setIsLoading,
    setError,
    nextPage,
    page,
    pageSize,
  } = useDatasetStore();

  const filteredDatasets = useDatasetStore(selectFilteredDatasets);
  const hasActiveFilters = useDatasetStore(selectHasActiveFilters);

  // Fetch datasets from HuggingFace
  const { data: queryData, refetch, isFetching } = useQuery<HuggingFaceSearchResponse>({
    queryKey: ["datasets", filters.searchQuery, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });

      if (filters.searchQuery) {
        params.set("search", filters.searchQuery);
      }

      params.set("filter", "task_categories:robotics");

      const response = await fetch(
        `https://huggingface.co/api/datasets?${params.toString()}`
      );

      if (!response.ok) throw new Error("Failed to fetch datasets");

      const data = await response.json();

      const datasets: DatasetInfo[] = data.map((item: Record<string, unknown>) => ({
        id: item.id as string,
        name: (item.id as string).split("/").pop() || item.id,
        source: "huggingface" as const,
        author: (item.id as string).split("/")[0],
        description: item.description as string | undefined,
        downloads: item.downloads as number | undefined,
        likes: item.likes as number | undefined,
        lastModified: item.lastModified as string | undefined,
        tags: (item.tags as string[]) || [],
        isPrivate: item.private as boolean | undefined,
      }));

      return {
        datasets,
        total: datasets.length,
        page,
        pageSize,
        hasMore: datasets.length === pageSize,
      };
    },
    staleTime: 60000,
  });

  // Sync query results to Zustand store
  useEffect(() => {
    if (queryData) {
      if (page === 1) {
        setDatasets(queryData.datasets, queryData.total, queryData.hasMore);
      } else {
        appendDatasets(queryData.datasets);
      }
    }
  }, [queryData, page, setDatasets, appendDatasets]);

  // Handle dataset selection for use
  const handleUseDataset = useCallback(
    (dataset: DatasetInfo) => {
      if (onSelect) {
        onSelect(dataset);
      }
    },
    [onSelect]
  );

  // Handle load more
  const handleLoadMore = useCallback(() => {
    nextPage();
  }, [nextPage]);

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              </Button>
              <div className="flex items-center border rounded-lg p-0.5">
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setViewMode("grid")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setViewMode("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Search */}
          <DatasetSearchBar className="mb-4" onSelect={handleUseDataset} />

          {/* Filters */}
          {showFilters && <FilterBar />}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && filteredDatasets.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredDatasets.length === 0 && (
        <EmptyState hasFilters={hasActiveFilters} />
      )}

      {/* Dataset grid/list */}
      {filteredDatasets.length > 0 && (
        <DatasetGrid
          datasets={filteredDatasets}
          viewMode={viewMode}
          selectedDatasetId={selectedDatasetId}
          onSelectDataset={selectDataset}
          onUseDataset={handleUseDataset}
          isLoadingMore={isFetching}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
        />
      )}
    </div>
  );
}
