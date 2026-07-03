import { Folder, FolderOpen, Github, Globe, Loader2, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  deriveSourceLabel,
} from "@/app/pages/index/coreFolderUploadScreenState";

export const RecentLinkPanel = ({
  title,
  emptyLabel,
  entries,
  onLoadUrl,
  onRemoveUrl,
  lastLocalLabel,
  onBrowseLocal,
  onClearLocal,
}: {
  title: string;
  emptyLabel: string;
  entries: string[];
  onLoadUrl: (url: string) => void | Promise<void>;
  onRemoveUrl: (url: string) => void;
  lastLocalLabel?: string | null;
  onBrowseLocal: () => void;
  onClearLocal: () => void;
}) => (
  <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Folder className="h-3.5 w-3.5" />
      <span>{title}</span>
    </div>
    {entries.length === 0 && !lastLocalLabel ? (
      <p className="text-xs text-muted-foreground">{emptyLabel}</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <button
            key={entry}
            type="button"
            className="group inline-flex max-w-full items-center gap-1 rounded-md border border-border/30 bg-background/20 px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-background/35 hover:text-foreground"
            title={entry}
            onClick={() => {
              void onLoadUrl(entry);
            }}
          >
            <span className="max-w-[170px] truncate">{deriveSourceLabel(entry, entry)}</span>
            <X
              className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveUrl(entry);
              }}
            />
          </button>
        ))}
        {lastLocalLabel ? (
          <button
            type="button"
            className="group inline-flex max-w-full items-center gap-1 rounded-md border border-border/30 bg-background/20 px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-background/35 hover:text-foreground"
            title={`Browse ${lastLocalLabel} again`}
            onClick={onBrowseLocal}
          >
            <Folder className="h-3 w-3" />
            <span className="max-w-[170px] truncate">local · {lastLocalLabel}</span>
            <X
              className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onClearLocal();
              }}
            />
          </button>
        ) : null}
      </div>
    )}
  </div>
);

export const CompactSourceIntake = ({
  isDropActive,
  isPreparing,
  localLabel,
  onBrowseLocal,
  inputPlaceholder,
  inputValue,
  onInputValueChange,
  onLoadRemote,
  loadDisabled,
  isLoading,
  loadIcon,
}: {
  isDropActive: boolean;
  isPreparing: boolean;
  localLabel: string;
  onBrowseLocal: () => void;
  inputPlaceholder: string;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onLoadRemote: () => void | Promise<unknown>;
  loadDisabled: boolean;
  isLoading: boolean;
  loadIcon: "github" | "globe";
}) => (
  <div className="flex w-full flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
    <div
      className={`flex w-full items-center gap-1.5 rounded-md border border-dashed px-3 py-2.5 transition-colors sm:w-auto sm:shrink-0 ${
        isDropActive
          ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05] text-foreground"
          : "border-border/70 bg-background/35 text-muted-foreground"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {isPreparing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FolderOpen className="h-3.5 w-3.5" />
        )}
        <span>{localLabel}</span>
        <button
          type="button"
          onClick={onBrowseLocal}
          className="text-[11px] font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
        >
          Browse Locally
        </button>
      </div>
    </div>
    <div className="flex w-full min-w-0 items-center gap-1.5 sm:flex-1">
      <Input
        type="text"
        placeholder={inputPlaceholder}
        value={inputValue}
        onChange={(event) => onInputValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !isLoading) {
            void onLoadRemote();
          }
        }}
        disabled={isLoading}
        className="min-w-0 flex-1 bg-background/80"
      />
      <Button
        type="button"
        onClick={() => {
          void onLoadRemote();
        }}
        disabled={loadDisabled}
        size="sm"
        className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.sourceButtonClass}
      >
        {isLoading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : loadIcon === "github" ? (
          <Github className="mr-1.5 h-3.5 w-3.5" />
        ) : (
          <Globe className="mr-1.5 h-3.5 w-3.5" />
        )}
        Load
      </Button>
    </div>
  </div>
);
