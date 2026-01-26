/**
 * DatasetCard - Dataset preview card with metadata
 */

import {
  Download,
  Heart,
  Clock,
  Database,
  Bot,
  Tag,
  Lock,
  ExternalLink,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import type { DatasetInfo } from "./types";

// ============================================================================
// Types
// ============================================================================

interface DatasetCardProps {
  dataset: DatasetInfo;
  isSelected?: boolean;
  onClick?: () => void;
  onSelect?: (dataset: DatasetInfo) => void;
  compact?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// ============================================================================
// Source Badge
// ============================================================================

function SourceBadge({ source }: { source: DatasetInfo["source"] }) {
  if (source === "huggingface") {
    return (
      <Badge className="bg-yellow-500/20 text-yellow-600 gap-1">
        <span className="text-xs">HF</span>
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Database className="h-3 w-3" />
      Local
    </Badge>
  );
}

// ============================================================================
// Grid Card
// ============================================================================

function GridCard({
  dataset,
  isSelected,
  onClick,
  onSelect,
}: DatasetCardProps) {
  return (
    <div
      className={cn(
        "group bg-card border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
        isSelected && "border-primary shadow-md ring-1 ring-primary/20"
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SourceBadge source={dataset.source} />
            {dataset.isPrivate && (
              <Lock className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
          <h3 className="font-medium text-sm truncate" title={dataset.name}>
            {dataset.name}
          </h3>
          {dataset.author && (
            <p className="text-xs text-muted-foreground truncate">
              {dataset.author}
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      {dataset.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {dataset.description}
        </p>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
        {dataset.downloads !== undefined && (
          <div className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {formatNumber(dataset.downloads)}
          </div>
        )}
        {dataset.likes !== undefined && (
          <div className="flex items-center gap-1">
            <Heart className="h-3 w-3" />
            {formatNumber(dataset.likes)}
          </div>
        )}
        {dataset.lastModified && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(dataset.lastModified)}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-2 mb-3">
        {dataset.robotType && (
          <Badge variant="outline" className="text-xs gap-1">
            <Bot className="h-3 w-3" />
            {dataset.robotType}
          </Badge>
        )}
        {dataset.numEpisodes !== undefined && (
          <Badge variant="outline" className="text-xs">
            {dataset.numEpisodes} episodes
          </Badge>
        )}
        {dataset.size && (
          <Badge variant="outline" className="text-xs">
            {dataset.size}
          </Badge>
        )}
      </div>

      {/* Tags */}
      {dataset.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dataset.tags.slice(0, 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-xs px-1.5 py-0"
            >
              {tag}
            </Badge>
          ))}
          {dataset.tags.length > 3 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              +{dataset.tags.length - 3}
            </Badge>
          )}
        </div>
      )}

      {/* Actions (shown on hover) */}
      <div className="flex items-center justify-end gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        {dataset.source === "huggingface" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://huggingface.co/datasets/${dataset.id}`, "_blank");
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          className="h-7"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(dataset);
          }}
        >
          Select
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// List Row
// ============================================================================

function ListRow({
  dataset,
  isSelected,
  onClick,
  onSelect,
}: DatasetCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 border-b cursor-pointer transition-colors hover:bg-muted/50",
        isSelected && "bg-muted"
      )}
      onClick={onClick}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
        <Database className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-medium text-sm truncate">{dataset.name}</h3>
          <SourceBadge source={dataset.source} />
          {dataset.isPrivate && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {dataset.author && `${dataset.author} - `}
          {dataset.description || "No description"}
        </p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        {dataset.downloads !== undefined && (
          <div className="flex items-center gap-1 w-20">
            <Download className="h-4 w-4" />
            {formatNumber(dataset.downloads)}
          </div>
        )}
        {dataset.numEpisodes !== undefined && (
          <div className="w-24 text-right">
            {dataset.numEpisodes} episodes
          </div>
        )}
        {dataset.lastModified && (
          <div className="w-24 text-right">
            {formatDate(dataset.lastModified)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {dataset.source === "huggingface" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://huggingface.co/datasets/${dataset.id}`, "_blank");
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(dataset);
          }}
        >
          Select
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DatasetCard(props: DatasetCardProps) {
  if (props.compact) {
    return <ListRow {...props} />;
  }
  return <GridCard {...props} />;
}
