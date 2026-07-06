import type { DragEvent, ReactNode } from "react";
import {
  FileUp,
  Github,
  Globe,
  Info,
  Loader2,
  Upload,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import {
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  type RecentLinkEntry,
} from "@/app/pages/index/coreFolderUploadScreenState";

export const SourcePanel = ({
  children,
  description,
  icon: Icon,
  infoContent,
  isDropActive,
  onDrop,
  onDropActiveChange,
  title,
}: {
  children: ReactNode;
  description: ReactNode;
  icon: LucideIcon;
  infoContent?: ReactNode;
  isDropActive: boolean;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDropActiveChange: (isActive: boolean) => void;
  title: string;
}) => {
  const activateDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onDropActiveChange(true);
  };

  const deactivateDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onDropActiveChange(false);
  };

  return (
    <div
      className={`space-y-4 rounded-lg border p-4 transition-colors ${
        isDropActive ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05]" : "border-border bg-background/40"
      }`}
      onDragEnter={activateDrop}
      onDragOver={activateDrop}
      onDragLeave={deactivateDrop}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        {infoContent ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`What ${title} accepts`}
                  className="mt-0.5 shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="max-w-xs text-xs leading-relaxed"
              >
                {infoContent}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
        )}
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
};

export const LocalSourceButtons = ({
  filesLabel = "Local Files",
  folderLabel = "Local Folder",
  onBrowseFiles,
  onBrowseFolder,
}: {
  filesLabel?: string;
  folderLabel?: string;
  onBrowseFiles?: () => void;
  onBrowseFolder?: () => void;
}) => (
  <div className="flex flex-wrap gap-2">
    {onBrowseFolder ? (
      <Button
        type="button"
        size="sm"
        onClick={onBrowseFolder}
        className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.sourceButtonClass}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        {folderLabel}
      </Button>
    ) : null}
    {onBrowseFiles ? (
      <Button
        type="button"
        size="sm"
        onClick={onBrowseFiles}
        className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.sourceButtonClass}
      >
        <FileUp className="mr-1.5 h-3.5 w-3.5" />
        {filesLabel}
      </Button>
    ) : null}
  </div>
);

export const RecentLinkPanel = ({
  title,
  emptyLabel,
  entries,
  onLoadEntry,
  onRemoveEntry,
  lastLocalLabel,
  onBrowseLocal,
  onClearLocal,
}: {
  title: string;
  emptyLabel: string;
  entries: RecentLinkEntry[];
  onLoadEntry: (entryKey: string) => void | Promise<void>;
  onRemoveEntry: (entryKey: string) => void;
  lastLocalLabel?: string | null;
  onBrowseLocal: () => void;
  onClearLocal: () => void;
}) => (
  <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Zap className="h-3.5 w-3.5" />
      <span>{title}</span>
    </div>
    {entries.length === 0 && !lastLocalLabel ? (
      <p className="text-xs text-muted-foreground">{emptyLabel}</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="group inline-flex max-w-full items-center gap-1 rounded-md border border-border/30 bg-background/20 px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-background/35 hover:text-foreground"
            title={entry.title}
            onClick={() => {
              void onLoadEntry(entry.key);
            }}
          >
            <span className="max-w-[170px] truncate">{entry.label}</span>
            <X
              className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveEntry(entry.key);
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

export const RemoteSourceInput = ({
  inputPlaceholder,
  inputValue,
  onInputValueChange,
  onLoadRemote,
  loadDisabled,
  isLoading,
  loadIcon,
}: {
  inputPlaceholder: string;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onLoadRemote: () => void | Promise<unknown>;
  loadDisabled: boolean;
  isLoading: boolean;
  loadIcon: "github" | "globe";
}) => (
  <div className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
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
);
