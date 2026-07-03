import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { Button } from "@/shared/ui/button";

type IKResultDialogProps = {
  error: string | null;
  isOrbitTarget: boolean;
  onClose: () => void;
  onFollowOrbit?: () => void;
  open: boolean;
  result: IkResponsePayload | null;
  running: boolean;
  targetName: string | null;
};

export const IKResultDialog = ({
  open,
  running,
  error,
  result,
  targetName,
  isOrbitTarget,
  onClose,
  onFollowOrbit,
}: IKResultDialogProps) => {
  if (!open) return null;

  return (
    <div className="fixed top-4 right-4 z-40 w-96 rounded-lg border border-border bg-background/95 shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">IK Solution</span>
          {targetName && (
            <span className="text-[11px] text-muted-foreground">Target: {targetName}</span>
          )}
        </div>
        <button
          className="text-muted-foreground hover:text-foreground text-xs"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="p-3 space-y-2">
        {running && (
          <div className="text-[12px] text-muted-foreground">Solving IK...</div>
        )}
        {error && (
          <div className="text-[12px] text-destructive">{error}</div>
        )}
        {result && (
          <>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="p-2 rounded border border-border/60">
                <div className="text-[11px] text-muted-foreground">Validity</div>
                <div className="font-semibold">{result.diagnostics.validity}</div>
              </div>
              <div className="p-2 rounded border border-border/60">
                <div className="text-[11px] text-muted-foreground">Stability</div>
                <div className="font-semibold">{result.diagnostics.stability}</div>
              </div>
              <div className="p-2 rounded border border-border/60">
                <div className="text-[11px] text-muted-foreground">Degeneracy</div>
                <div className="font-semibold">{result.diagnostics.degeneracy}</div>
              </div>
              <div className="p-2 rounded border border-border/60">
                <div className="text-[11px] text-muted-foreground">Branch</div>
                <div className="font-semibold">
                  {result.diagnostics.branch_maybe ? "Possible switch" : "Likely expected"}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground">
              {result.diagnostics.branch_message}
            </div>

            <div className="text-[11px] text-muted-foreground">
              Cost: {result.diagnostics.cost.toFixed(5)} | Iterations:{" "}
              {result.diagnostics.iterations} | lambda:{" "}
              {result.diagnostics.lambda_final.toFixed(3)} | Termination:{" "}
              {result.diagnostics.termination_reason}
            </div>

            <div className="max-h-40 overflow-y-auto border border-border/50 rounded">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-muted-foreground/80">
                    <th className="px-2 py-1 font-normal">Joint</th>
                    <th className="px-2 py-1 font-normal">Value (rad)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.solution).map(([joint, value]) => (
                    <tr key={joint} className="odd:bg-muted/30">
                      <td className="px-2 py-1 whitespace-nowrap">{joint}</td>
                      <td className="px-2 py-1 font-mono">{value.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>
                Dismiss
              </Button>
              {isOrbitTarget && onFollowOrbit && (
                <Button size="sm" variant="default" onClick={onFollowOrbit}>
                  Follow Orbit
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
