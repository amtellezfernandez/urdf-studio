import { useEffect, useState, type ReactNode } from "react";
import { Flag, Play, Trash2 } from "lucide-react";

import {
  DATASET_REVIEW_FORMAT_PARAMS,
  DATASET_REVIEW_INSIGHT_PARAMS,
  DATASET_REVIEW_SESSION_PARAMS,
} from "@/features/dataset/datasetSessionParams";
import type { DatasetReviewDeleteTarget } from "@/features/dataset/datasetActions";
import type {
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeListOptions,
  DatasetSessionEpisodeSummary,
  DatasetSessionFlagEpisodesResponse,
  DatasetSessionFlagUpdate,
  DatasetSessionReviewReason,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

const REVIEW_REASON_LABELS: Record<DatasetSessionReviewReason, string> = {
  short_duration: "Short",
  long_duration: "Long",
  low_motion: "Low Motion",
  timing_irregularity: "Timing",
  fps_mismatch: "FPS",
  unnamed_joints: "Unnamed",
  unmapped_signals: "Unmapped",
  high_loss: "High Loss",
  sensor_gap: "Sensor Gap",
  action_outlier: "Action Outlier",
  language_mismatch: "Language",
  failed_demo: "Failed Demo",
  duplicate_episode: "Duplicate",
};

type DatasetReviewPageProps = {
  datasetActions: {
    datasetSessionSummary?: DatasetSessionSummary | null;
    listReviewEpisodes: (
      options?: DatasetSessionEpisodeListOptions
    ) => Promise<DatasetSessionEpisodeListResponse | null>;
    updateReviewFlags: (
      updates: DatasetSessionFlagUpdate[]
    ) => Promise<DatasetSessionFlagEpisodesResponse | null>;
    deleteEpisodes: (episodes: readonly DatasetReviewDeleteTarget[]) => Promise<void>;
    playReviewEpisode?: (episodeId: string) => Promise<void>;
    datasetSessionStatus?: "idle" | "syncing" | "ready" | "error";
    datasetSessionError?: string | null;
  } | null;
  onLeaveReview?: () => void;
};

type DatasetReviewMetricProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "warning";
};

type DatasetReviewFactProps = {
  label: string;
  value: string;
  title?: string;
};

type DatasetReviewInsightGroupProps = {
  title: string;
  detail: string;
  children: ReactNode;
};

type DatasetReviewInsightBarProps = {
  label: string;
  value: string;
  ratio: number;
  tone?: "default" | "warning";
};

type DatasetReviewEpisodeRowProps = {
  episode: DatasetSessionEpisodeSummary;
  selected: boolean;
  selectedForBulk: boolean;
  canOpenEpisodeInViewer: boolean;
  onSelect: (episode: DatasetSessionEpisodeSummary) => void;
  onToggleSelection: (episode: DatasetSessionEpisodeSummary) => void;
  onOpen: (episode: DatasetSessionEpisodeSummary) => void;
  onToggleFlag: (episode: DatasetSessionEpisodeSummary) => void;
  onDelete: (episode: DatasetSessionEpisodeSummary) => void;
};

type DatasetReviewQueueState = {
  total: number;
  offset: number;
  limit: number;
};

type DatasetReviewSourceSummary = {
  key: string;
  label: string;
  count: number;
};

const formatOptionalText = (value: string | null | undefined) => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : "Not provided";
};

const formatInteger = (value: number) => value.toLocaleString();

const formatLabeledCount = (value: number, singularLabel: string, pluralLabel = `${singularLabel}s`) =>
  `${formatInteger(value)} ${value === 1 ? singularLabel : pluralLabel}`;

const formatDurationSec = (value: number) =>
  `${value.toFixed(DATASET_REVIEW_FORMAT_PARAMS.durationFractionDigits)}s`;

const formatFps = (value: number) =>
  `${value.toFixed(DATASET_REVIEW_FORMAT_PARAMS.fpsFractionDigits)} fps`;

const formatPercent = (value: number, total: number) =>
  total > 0
    ? `${((value / total) * DATASET_REVIEW_FORMAT_PARAMS.percentMultiplier).toFixed(
        DATASET_REVIEW_FORMAT_PARAMS.percentFractionDigits
      )}%`
    : "0%";

const formatRatioPercent = (ratio: number) =>
  `${Math.max(
    0,
    Math.min(
      DATASET_REVIEW_FORMAT_PARAMS.percentMultiplier,
      ratio * DATASET_REVIEW_FORMAT_PARAMS.percentMultiplier
    )
  ).toFixed(DATASET_REVIEW_FORMAT_PARAMS.percentFractionDigits)}%`;

const formatReasonLabel = (reason: DatasetSessionReviewReason) =>
  REVIEW_REASON_LABELS[reason] ?? reason;

const resolveReviewReasonFilter = (reason: DatasetSessionReviewReason | "all") =>
  reason === "all" ? undefined : reason;

const resolveClampedReviewPageOffset = (currentOffset: number, total: number) => {
  if (total <= 0) {
    return 0;
  }
  const lastPageOffset =
    Math.floor((total - 1) / DATASET_REVIEW_SESSION_PARAMS.pageLimit) *
    DATASET_REVIEW_SESSION_PARAMS.pageLimit;
  return Math.min(currentOffset, lastPageOffset);
};

const formatEpisodeSourceLabel = (episode: DatasetSessionEpisodeSummary) =>
  `episode ${episode.episode_number} from ${formatOptionalText(episode.source_name)}`;

const resolveRecordedVideoCameraCount = (episode: DatasetSessionEpisodeSummary) =>
  Math.max(0, episode.recorded_video_camera_count ?? 0);

const resolveRecordedVideoStreamCount = (episode: DatasetSessionEpisodeSummary) =>
  Math.max(0, episode.recorded_video_stream_count ?? 0);

const formatEpisodeSourceKey = (episode: DatasetSessionEpisodeSummary) =>
  `${episode.source_kind}:${formatOptionalText(episode.source_name)}`;

const summarizeVisibleEpisodeSources = (
  episodes: readonly DatasetSessionEpisodeSummary[]
): DatasetReviewSourceSummary[] => {
  const sourceCounts = new Map<string, DatasetReviewSourceSummary>();
  episodes.forEach((episode) => {
    const key = formatEpisodeSourceKey(episode);
    const existing = sourceCounts.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    sourceCounts.set(key, {
      key,
      label: `${episode.source_kind} / ${formatOptionalText(episode.source_name)}`,
      count: 1,
    });
  });
  return [...sourceCounts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, DATASET_REVIEW_INSIGHT_PARAMS.visibleSourceLimit);
};

const resolveVisibleDurationStats = (episodes: readonly DatasetSessionEpisodeSummary[]) => {
  if (episodes.length === 0) {
    return null;
  }
  const durations = episodes.map((episode) => episode.duration_sec);
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  return {
    min: Math.min(...durations),
    max: Math.max(...durations),
    average: total / durations.length,
  };
};

const formatBulkDiscardScopeLabel = (
  activeReason: DatasetSessionReviewReason | "all",
  flaggedOnly: boolean
) => {
  if (activeReason !== "all") {
    return formatReasonLabel(activeReason);
  }
  if (flaggedOnly) {
    return "flagged";
  }
  return null;
};

const resolveBackendStorageLabel = () => "IKD session";

const resolveIngressLabel = (summary: DatasetSessionSummary) => {
  if (summary.source_kind === "hf") {
    return "HF source resolver";
  }
  if (summary.source_kind === "mixed") {
    return "Mixed lineage resolver";
  }
  if (summary.source_kind === "local") {
    return "Local import bridge";
  }
  return "Episode frame bridge";
};

const DatasetReviewMetric = ({
  label,
  value,
  detail,
  tone = "default",
}: DatasetReviewMetricProps) => (
  <div
    className={cn(
      "min-w-0 rounded-lg border px-3 py-2",
      tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-border/40 bg-muted/15"
    )}
  >
    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground" title={value}>
      {value}
    </div>
    {detail ? (
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </div>
    ) : null}
  </div>
);

const DatasetReviewFact = ({ label, value, title }: DatasetReviewFactProps) => (
  <Badge
    variant="outline"
    className="max-w-full justify-start gap-1 truncate border-border/50 bg-background/70 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
    title={title ?? value}
  >
    <span className="shrink-0 uppercase tracking-wide text-muted-foreground/70">{label}</span>
    <span className="min-w-0 truncate text-foreground">{value}</span>
  </Badge>
);

const DatasetReviewInsightGroup = ({
  title,
  detail,
  children,
}: DatasetReviewInsightGroupProps) => (
  <div className="min-w-0 rounded-lg border border-border/35 bg-muted/10 px-3 py-2">
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">{detail}</div>
    </div>
    <div className="mt-2 space-y-1.5">{children}</div>
  </div>
);

const DatasetReviewInsightBar = ({
  label,
  value,
  ratio,
  tone = "default",
}: DatasetReviewInsightBarProps) => (
  <div className="min-w-0">
    <div className="flex min-w-0 items-center justify-between gap-2 text-[10px]">
      <span className="min-w-0 truncate text-muted-foreground" title={label}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-foreground">{value}</span>
    </div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border/40">
      <div
        className={cn(
          "h-full rounded-full",
          tone === "warning" ? "bg-amber-300/80" : "bg-cyan-300/70"
        )}
        style={{ width: formatRatioPercent(ratio) }}
      />
    </div>
  </div>
);

const DatasetReviewReasonBadges = ({
  reasons,
  emptyLabel = "None",
}: {
  reasons: readonly DatasetSessionReviewReason[];
  emptyLabel?: string;
}) =>
  reasons.length > 0 ? (
    <div className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <Badge
          key={reason}
          variant="outline"
          className="h-5 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-300"
        >
          {formatReasonLabel(reason)}
        </Badge>
      ))}
    </div>
  ) : (
    <div className="text-xs text-muted-foreground">{emptyLabel}</div>
  );

const DatasetReviewEpisodeRow = ({
  episode,
  selected,
  selectedForBulk,
  canOpenEpisodeInViewer,
  onSelect,
  onToggleSelection,
  onOpen,
  onToggleFlag,
  onDelete,
}: DatasetReviewEpisodeRowProps) => {
  const episodeTitle = `Episode ${episode.episode_number}`;
  const recordedVideoCameraCount = resolveRecordedVideoCameraCount(episode);
  const recordedVideoStreamCount = resolveRecordedVideoStreamCount(episode);
  const hasRecordedVideo = recordedVideoCameraCount > 0;
  const openTitle = hasRecordedVideo
    ? `Open ${episodeTitle} in 3D replay with synced recorded video`
    : `Open ${episodeTitle} in 3D replay`;
  const episodeStats = `${formatLabeledCount(episode.frame_count, "frame")} | ${formatDurationSec(
    episode.duration_sec
  )} | ${formatFps(episode.fps)}`;
  return (
    <div
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] border-b border-border/20 transition-colors",
        selected ? "bg-muted/35" : "hover:bg-muted/15"
      )}
    >
      <button
        type="button"
        className="min-w-0 px-3 py-2 text-left"
        aria-pressed={selected}
        onClick={() => onSelect(episode)}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{episodeTitle}</span>
          {episode.flagged ? (
            <Badge className="h-5 bg-amber-500/15 px-1.5 py-0 text-[10px] text-amber-300">
              Flagged
            </Badge>
          ) : null}
          {hasRecordedVideo ? (
            <Badge
              variant="outline"
              className="h-5 border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 text-[10px] text-cyan-200"
              title={`${formatInteger(recordedVideoStreamCount)} playable recorded stream(s)`}
            >
              Video {formatLabeledCount(recordedVideoCameraCount, "cam")}
            </Badge>
          ) : null}
          <span className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">
            {episodeStats}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <DatasetReviewFact
            label="source episode"
            value={formatEpisodeSourceLabel(episode)}
            title={`${episode.source_kind}: ${formatEpisodeSourceLabel(episode)}`}
          />
          <DatasetReviewFact label="kind" value={episode.source_kind} />
          <DatasetReviewFact
            label="dataset"
            value={formatOptionalText(episode.source_name)}
            title={episode.source_name}
          />
          <DatasetReviewFact label="robot" value={formatOptionalText(episode.robot_type)} />
          <DatasetReviewFact label="name" value={formatOptionalText(episode.naming_status)} />
          <span
            className="min-w-0 truncate text-[10px] text-muted-foreground/80"
            title={episode.episode_id}
          >
            {episode.episode_id}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <DatasetReviewReasonBadges reasons={episode.review_reasons} />
          <span className="shrink-0 text-[10px] text-muted-foreground">
            detected {episode.detected_reasons.length} / manual {episode.manual_reasons.length}
          </span>
        </div>
        {episode.review_note ? (
          <div className="mt-1 truncate text-[10px] text-muted-foreground" title={episode.review_note}>
            Note: {episode.review_note}
          </div>
        ) : null}
      </button>
      <div className="flex items-center gap-0.5 px-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border bg-background accent-amber-300"
          checked={selectedForBulk}
          aria-label={`Select ${episodeTitle} for bulk prune`}
          onChange={() => onToggleSelection(episode)}
          onClick={(event) => event.stopPropagation()}
        />
        {canOpenEpisodeInViewer ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title={openTitle}
            aria-label={openTitle}
            onClick={() => onOpen(episode)}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "h-7 w-7",
            episode.flagged
              ? "text-amber-300 hover:text-amber-200"
              : "text-muted-foreground hover:text-amber-300"
          )}
          title={episode.flagged ? `Unflag ${episodeTitle}` : `Flag ${episodeTitle}`}
          aria-label={episode.flagged ? `Unflag ${episodeTitle}` : `Flag ${episodeTitle}`}
          onClick={() => onToggleFlag(episode)}
        >
          <Flag className={cn("h-3.5 w-3.5", episode.flagged && "fill-current")} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:bg-red-500/10 hover:text-red-300"
          title={`Delete ${episodeTitle}`}
          aria-label={`Delete ${episodeTitle}`}
          onClick={() => onDelete(episode)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

export const DatasetReviewPage = ({ datasetActions, onLeaveReview }: DatasetReviewPageProps) => {
  const [episodes, setEpisodes] = useState<DatasetSessionEpisodeSummary[]>([]);
  const [activeReason, setActiveReason] = useState<DatasetSessionReviewReason | "all">("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);
  const [queueState, setQueueState] = useState<DatasetReviewQueueState>({
    total: 0,
    offset: 0,
    limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
  });
  const [queueReloadToken, setQueueReloadToken] = useState(0);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = datasetActions?.datasetSessionSummary ?? null;
  const reviewCounts = summary?.review_counts ?? [];
  const sessionStatus = datasetActions?.datasetSessionStatus ?? "ready";
  const flaggedPercent = summary
    ? formatPercent(summary.flagged_episode_count, summary.episode_count)
    : "0%";
  const averageFps =
    summary && summary.total_duration_sec > 0
      ? summary.total_frame_count / summary.total_duration_sec
      : null;
  const sessionTitle = summary
    ? summary.dataset_label ?? summary.source_name ?? summary.session_id
    : "Dataset Review";
  const reviewIssueCount = reviewCounts.reduce(
    (total, reviewCount) => total + reviewCount.episode_count,
    0
  );
  const visibleSourceSummaries = summarizeVisibleEpisodeSources(episodes);
  const visibleDurationStats = resolveVisibleDurationStats(episodes);
  const visibleDurationMax = visibleDurationStats?.max ?? 0;
  const leadingReviewCounts = reviewCounts.slice(
    0,
    DATASET_REVIEW_INSIGHT_PARAMS.visibleReasonLimit
  );
  const queueStart = queueState.total > 0 ? queueState.offset + 1 : 0;
  const queueEnd = Math.min(queueState.offset + episodes.length, queueState.total);
  const canLoadPreviousPage = queueState.offset > 0;
  const canLoadNextPage = queueState.offset + queueState.limit < queueState.total;
  const visibleEpisodeIds = episodes.map((episode) => episode.episode_id);
  const selectedVisibleEpisodeIds = visibleEpisodeIds.filter((episodeId) =>
    selectedEpisodeIds.has(episodeId)
  );
  const selectedVisibleCount = selectedVisibleEpisodeIds.length;
  const selectedEpisodeCount = selectedEpisodeIds.size;
  const allVisibleEpisodesSelected =
    visibleEpisodeIds.length > 0 && selectedVisibleCount === visibleEpisodeIds.length;
  const bulkDiscardScopeLabel = formatBulkDiscardScopeLabel(activeReason, flaggedOnly);
  const visibleFilteredEpisodes = bulkDiscardScopeLabel ? episodes : [];
  const resolveDeleteTargets = (episodeIds: readonly string[]) =>
    episodeIds.map(
      (episodeId) =>
        episodes.find((episode) => episode.episode_id === episodeId) ?? {
          episode_id: episodeId,
        }
    );

  useEffect(() => {
    if (!datasetActions?.datasetSessionSummary?.session_id) {
      setEpisodes([]);
      setSelectedEpisodeId(null);
      setSelectedEpisodeIds(new Set());
      setQueueState({
        total: 0,
        offset: 0,
        limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
      });
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void datasetActions
      .listReviewEpisodes({
        flaggedOnly,
        limit: DATASET_REVIEW_SESSION_PARAMS.pageLimit,
        offset: pageOffset,
        reason: resolveReviewReasonFilter(activeReason),
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const nextEpisodes = response?.episodes ?? [];
        const nextTotal = response?.total ?? nextEpisodes.length;
        const nextOffset = response?.offset ?? pageOffset;
        const clampedOffset = resolveClampedReviewPageOffset(nextOffset, nextTotal);
        if (nextOffset !== clampedOffset) {
          setPageOffset(clampedOffset);
          return;
        }
        setQueueState({
          total: nextTotal,
          offset: nextOffset,
          limit: response?.limit ?? DATASET_REVIEW_SESSION_PARAMS.pageLimit,
        });
        setEpisodes(nextEpisodes);
        setSelectedEpisodeId((currentSelectedEpisodeId) => {
          if (
            currentSelectedEpisodeId &&
            nextEpisodes.some((episode) => episode.episode_id === currentSelectedEpisodeId)
          ) {
            return currentSelectedEpisodeId;
          }
          return nextEpisodes[0]?.episode_id ?? null;
        });
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load review episodes");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeReason, datasetActions, flaggedOnly, pageOffset, queueReloadToken]);

  const reloadReviewQueue = () => {
    setQueueReloadToken((currentToken) => currentToken + 1);
  };

  const setReasonFilter = (reason: DatasetSessionReviewReason | "all") => {
    setActiveReason(reason);
    setPageOffset(0);
  };

  const toggleFlaggedOnlyFilter = () => {
    setFlaggedOnly((currentFlaggedOnly) => !currentFlaggedOnly);
    setPageOffset(0);
  };

  const selectReviewEpisode = (episode: DatasetSessionEpisodeSummary) => {
    setSelectedEpisodeId(episode.episode_id);
  };

  const toggleEpisodeSelection = (episode: DatasetSessionEpisodeSummary) => {
    setSelectedEpisodeIds((currentSelectedEpisodeIds) => {
      const nextSelectedEpisodeIds = new Set(currentSelectedEpisodeIds);
      if (nextSelectedEpisodeIds.has(episode.episode_id)) {
        nextSelectedEpisodeIds.delete(episode.episode_id);
      } else {
        nextSelectedEpisodeIds.add(episode.episode_id);
      }
      return nextSelectedEpisodeIds;
    });
  };

  const toggleVisibleEpisodeSelection = () => {
    setSelectedEpisodeIds((currentSelectedEpisodeIds) => {
      const nextSelectedEpisodeIds = new Set(currentSelectedEpisodeIds);
      if (allVisibleEpisodesSelected) {
        visibleEpisodeIds.forEach((episodeId) => nextSelectedEpisodeIds.delete(episodeId));
      } else {
        visibleEpisodeIds.forEach((episodeId) => nextSelectedEpisodeIds.add(episodeId));
      }
      return nextSelectedEpisodeIds;
    });
  };

  const deleteReviewEpisodes = async (
    episodesToDelete: readonly DatasetReviewDeleteTarget[],
    failureMessage: string
  ) => {
    if (!datasetActions || episodesToDelete.length === 0) {
      return;
    }
    const uniqueEpisodeIds = [...new Set(episodesToDelete.map((episode) => episode.episode_id))];
    const uniqueEpisodes = uniqueEpisodeIds.map(
      (episodeId) =>
        episodesToDelete.find((episode) => episode.episode_id === episodeId) ?? {
          episode_id: episodeId,
        }
    );
    setError(null);
    try {
      await datasetActions.deleteEpisodes(uniqueEpisodes);
      setSelectedEpisodeIds((currentSelectedEpisodeIds) => {
        const nextSelectedEpisodeIds = new Set(currentSelectedEpisodeIds);
        uniqueEpisodeIds.forEach((episodeId) => nextSelectedEpisodeIds.delete(episodeId));
        return nextSelectedEpisodeIds;
      });
      reloadReviewQueue();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : failureMessage);
    }
  };

  const openEpisodeInViewer = async (episode: DatasetSessionEpisodeSummary) => {
    if (!datasetActions?.playReviewEpisode) {
      return;
    }
    setError(null);
    try {
      await datasetActions.playReviewEpisode(episode.episode_id);
      onLeaveReview?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to open episode in 3D replay");
    }
  };

  const toggleEpisodeFlag = async (episodeToUpdate: DatasetSessionEpisodeSummary) => {
    if (!datasetActions) {
      return;
    }
    setError(null);
    try {
      await datasetActions.updateReviewFlags([
        {
          episode_id: episodeToUpdate.episode_id,
          flagged: !episodeToUpdate.flagged,
          reasons: episodeToUpdate.review_reasons,
        },
      ]);
      reloadReviewQueue();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update review flag");
    }
  };

  const deleteReviewEpisode = async (episodeToDelete: DatasetSessionEpisodeSummary) => {
    await deleteReviewEpisodes([episodeToDelete], "Failed to delete episode");
  };

  if (!datasetActions || !summary) {
    return (
      <div className="flex h-full items-center justify-center bg-background px-6 text-center">
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">No dataset review session</div>
          <div className="text-xs text-muted-foreground">
            Load or record a dataset to populate backend review state.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b border-border/40 bg-background/95 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Dataset Review</div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="max-w-[40ch] truncate text-xs text-muted-foreground" title={sessionTitle}>
                {sessionTitle}
              </span>
              <DatasetReviewFact label="session" value={summary.session_id} />
              <DatasetReviewFact label="schema" value={summary.schema_version} />
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
            <DatasetReviewFact label="backend" value={resolveBackendStorageLabel()} />
            <DatasetReviewFact label="status" value={sessionStatus} title={datasetActions.datasetSessionError ?? sessionStatus} />
            <DatasetReviewFact label="source" value={summary.source_kind} />
            <DatasetReviewFact
              label="repo"
              value={formatOptionalText(summary.source_name)}
              title={summary.source_name}
            />
            <DatasetReviewFact label="robot" value={formatOptionalText(summary.robot_type)} />
          </div>
        </div>

        <div className="mt-2 grid gap-1.5 md:grid-cols-3">
          <DatasetReviewFact
            label="ingress"
            value={resolveIngressLabel(summary)}
            title={`${summary.source_kind}: ${formatOptionalText(summary.source_name)}`}
          />
          <DatasetReviewFact
            label="review api"
            value="/datasets/sessions/:id/review"
            title="Backend review counts and generated reasons"
          />
          <DatasetReviewFact
            label="episode api"
            value="/datasets/sessions/:id/episodes"
            title="Paginated backend episode summaries with source, robot, naming, and flags"
          />
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <DatasetReviewMetric
            label="Episodes"
            value={formatLabeledCount(summary.episode_count, "episode")}
            detail={formatLabeledCount(summary.total_frame_count, "frame")}
          />
          <DatasetReviewMetric
            label="Flagged"
            value={formatLabeledCount(summary.flagged_episode_count, "flagged")}
            detail={`${flaggedPercent} of dataset`}
            tone={summary.flagged_episode_count > 0 ? "warning" : "default"}
          />
          <DatasetReviewMetric
            label="Duration"
            value={formatDurationSec(summary.total_duration_sec)}
            detail={averageFps === null ? "Avg FPS unavailable" : `Avg ${formatFps(averageFps)}`}
          />
          <DatasetReviewMetric
            label="Avg FPS"
            value={averageFps === null ? "n/a" : formatFps(averageFps)}
            detail="Frames / duration"
          />
          <DatasetReviewMetric label="Robot" value={formatOptionalText(summary.robot_type)} detail={summary.source_kind} />
          <DatasetReviewMetric
            label="Review Hits"
            value={formatInteger(reviewCounts.length)}
            detail={`${formatInteger(reviewIssueCount)} reason hits`}
            tone={reviewIssueCount > 0 ? "warning" : "default"}
          />
        </div>

        <div className="mt-2 grid gap-2 lg:grid-cols-3">
          <DatasetReviewInsightGroup
            title="Source Coverage"
            detail={`${formatInteger(episodes.length)} visible`}
          >
            {visibleSourceSummaries.length > 0 ? (
              visibleSourceSummaries.map((sourceSummary) => (
                <DatasetReviewInsightBar
                  key={sourceSummary.key}
                  label={sourceSummary.label}
                  value={formatInteger(sourceSummary.count)}
                  ratio={sourceSummary.count / episodes.length}
                />
              ))
            ) : (
              <div className="text-[11px] text-muted-foreground">No visible source rows.</div>
            )}
          </DatasetReviewInsightGroup>

          <DatasetReviewInsightGroup
            title="Review Reasons"
            detail={`${formatInteger(reviewIssueCount)} hits`}
          >
            {leadingReviewCounts.length > 0 ? (
              leadingReviewCounts.map((reviewCount) => (
                <DatasetReviewInsightBar
                  key={reviewCount.reason}
                  label={formatReasonLabel(reviewCount.reason)}
                  value={`${formatInteger(reviewCount.episode_count)} (${formatPercent(
                    reviewCount.episode_count,
                    summary.episode_count
                  )})`}
                  ratio={
                    summary.episode_count > 0
                      ? reviewCount.episode_count / summary.episode_count
                      : 0
                  }
                  tone="warning"
                />
              ))
            ) : (
              <div className="text-[11px] text-muted-foreground">No generated review reasons.</div>
            )}
          </DatasetReviewInsightGroup>

          <DatasetReviewInsightGroup title="Duration Spread" detail="visible page">
            {visibleDurationStats && visibleDurationMax > 0 ? (
              <>
                <DatasetReviewInsightBar
                  label="Shortest"
                  value={formatDurationSec(visibleDurationStats.min)}
                  ratio={visibleDurationStats.min / visibleDurationMax}
                />
                <DatasetReviewInsightBar
                  label="Average"
                  value={formatDurationSec(visibleDurationStats.average)}
                  ratio={visibleDurationStats.average / visibleDurationMax}
                />
                <DatasetReviewInsightBar
                  label="Longest"
                  value={formatDurationSec(visibleDurationStats.max)}
                  ratio={DATASET_REVIEW_INSIGHT_PARAMS.fullBarRatio}
                />
              </>
            ) : (
              <div className="text-[11px] text-muted-foreground">Duration data unavailable.</div>
            )}
          </DatasetReviewInsightGroup>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={activeReason === "all" ? "secondary" : "outline"}
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => setReasonFilter("all")}
          >
            All {summary.episode_count}
          </Button>
          <Button
            size="sm"
            variant={flaggedOnly ? "secondary" : "outline"}
            className="h-7 rounded-full px-2 text-xs"
            onClick={toggleFlaggedOnlyFilter}
          >
            Flagged only {summary.flagged_episode_count}
          </Button>
          {reviewCounts.map((reviewCount) => (
            <Button
              key={reviewCount.reason}
              size="sm"
              variant={activeReason === reviewCount.reason ? "secondary" : "outline"}
              className="h-7 rounded-full px-2 text-xs"
              onClick={() => setReasonFilter(reviewCount.reason)}
            >
              {formatReasonLabel(reviewCount.reason)} {reviewCount.episode_count}
            </Button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="tabular-nums">
            Showing {formatInteger(queueStart)}-{formatInteger(queueEnd)} of{" "}
            {formatInteger(queueState.total)} review episodes
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 rounded-full px-2 text-[11px]"
              disabled={episodes.length === 0}
              onClick={toggleVisibleEpisodeSelection}
            >
              {allVisibleEpisodesSelected ? "Clear visible" : "Select visible"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 rounded-full border-red-500/30 px-2 text-[11px] text-red-300 hover:bg-red-500/10"
              disabled={selectedEpisodeCount === 0}
              onClick={() => {
                void deleteReviewEpisodes(
                  resolveDeleteTargets([...selectedEpisodeIds]),
                  "Failed to discard selected episodes"
                );
              }}
            >
              Discard selected {formatInteger(selectedEpisodeCount)}
            </Button>
            {bulkDiscardScopeLabel ? (
              <Button
                size="sm"
                variant="outline"
                className="h-6 rounded-full border-red-500/30 px-2 text-[11px] text-red-300 hover:bg-red-500/10"
                disabled={visibleFilteredEpisodes.length === 0}
                onClick={() => {
                  void deleteReviewEpisodes(
                    visibleFilteredEpisodes,
                    "Failed to discard visible review matches"
                  );
                }}
              >
                Discard visible {bulkDiscardScopeLabel} {formatInteger(visibleFilteredEpisodes.length)}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-6 rounded-full px-2 text-[11px]"
              disabled={!canLoadPreviousPage}
              onClick={() =>
                setPageOffset((currentOffset) =>
                  Math.max(0, currentOffset - DATASET_REVIEW_SESSION_PARAMS.pageLimit)
                )
              }
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 rounded-full px-2 text-[11px]"
              disabled={!canLoadNextPage}
              onClick={() =>
                setPageOffset((currentOffset) =>
                  currentOffset + DATASET_REVIEW_SESSION_PARAMS.pageLimit
                )
              }
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">Loading review queue...</div>
        ) : error ? (
          <div className="px-4 py-4 text-sm text-red-400">{error}</div>
        ) : episodes.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">No episodes match this filter.</div>
        ) : (
          <div role="list" aria-label="Dataset review episodes">
            {episodes.map((episode) => (
              <DatasetReviewEpisodeRow
                key={episode.episode_id}
                episode={episode}
                selected={selectedEpisodeId === episode.episode_id}
                selectedForBulk={selectedEpisodeIds.has(episode.episode_id)}
                canOpenEpisodeInViewer={Boolean(datasetActions.playReviewEpisode)}
                onSelect={selectReviewEpisode}
                onToggleSelection={toggleEpisodeSelection}
                onOpen={(episodeToOpen) => {
                  void openEpisodeInViewer(episodeToOpen);
                }}
                onToggleFlag={(episodeToUpdate) => {
                  void toggleEpisodeFlag(episodeToUpdate);
                }}
                onDelete={(episodeToDelete) => {
                  void deleteReviewEpisode(episodeToDelete);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
