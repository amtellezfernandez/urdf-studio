type UrdfStatusBannerProps = {
  isInvalid: boolean;
  error?: string | null;
  onOpenIssues?: () => void;
};

export const UrdfStatusBanner = ({
  isInvalid,
  error,
  onOpenIssues,
}: UrdfStatusBannerProps) => {
  if (!isInvalid) return null;

  return (
    <div className="fixed top-7 left-0 right-0 z-40 px-2 py-1.5 bg-amber-950/95 border-b border-amber-800/70 text-amber-100 flex items-center gap-2">
      <div className="text-xs font-medium">URDF is invalid</div>
      {error && (
        <div className="text-[11px] text-amber-100/80 truncate flex-1" title={error}>
          {error}
        </div>
      )}
      {onOpenIssues && (
        <button
          onClick={onOpenIssues}
          className="text-[11px] px-2 py-0.5 rounded bg-amber-400/15 hover:bg-amber-400/25 border border-amber-300/30"
        >
          View issues
        </button>
      )}
    </div>
  );
};

