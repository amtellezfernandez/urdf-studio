import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { API_BASE_URL } from "@/shared/config/api";
import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export type OptionalRuntimeId = "genesis" | "mjlab" | "mjx";

type InstallJob = {
  job_id: string;
  runtime_id: OptionalRuntimeId;
  running: boolean;
  exit_code: number | null;
  output: string;
};

const RUNTIME_COPY: Record<OptionalRuntimeId, { label: string; detail: string }> = {
  mjx: {
    label: "MJX",
    detail: "JAX and MuJoCo MJX for native differentiable simulation.",
  },
  mjlab: {
    label: "MJLab",
    detail: "MJLab and MuJoCo Warp for GPU-oriented motion validation.",
  },
  genesis: {
    label: "Genesis",
    detail: "Genesis and its local rendering/runtime dependencies.",
  },
};

const readJob = async (jobId: string): Promise<InstallJob> => {
  const response = await fetch(`${API_BASE_URL}/optional-runtime-installs/${jobId}/status`);
  if (!response.ok) throw new Error(await readResponseErrorDetail(response, { fallback: "Install status unavailable." }));
  return (await response.json()) as InstallJob;
};

export const OptionalRuntimeInstallDialog = ({
  runtimeId,
  open,
  onOpenChange,
}: {
  runtimeId: OptionalRuntimeId | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [job, setJob] = useState<InstallJob | null>(null);
  const runtime = runtimeId ? RUNTIME_COPY[runtimeId] : null;

  useEffect(() => {
    if (!job?.running) return;
    const timer = window.setInterval(() => {
      void readJob(job.job_id)
        .then((next) => {
          setJob(next);
          if (!next.running && next.exit_code === 0) {
            toast.success(`${RUNTIME_COPY[next.runtime_id].label} is ready. Refreshing availability…`);
            window.setTimeout(() => window.location.reload(), 600);
          }
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : "Install status unavailable."));
    }, 800);
    return () => window.clearInterval(timer);
  }, [job]);

  const install = async () => {
    if (!runtimeId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/optional-runtime-installs/${runtimeId}`, { method: "POST" });
      if (!response.ok) throw new Error(await readResponseErrorDetail(response, { fallback: "Could not start installation." }));
      setJob((await response.json()) as InstallJob);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start installation.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{runtime ? `Install ${runtime.label}` : "Install optional runtime"}</DialogTitle>
          <DialogDescription>{runtime?.detail}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-md border border-border/70 bg-muted/25 p-3 text-sm">
          <p>Installed only inside this project’s managed Python environment.</p>
          <p className="text-muted-foreground">This never installs NVIDIA drivers, CUDA toolkits, Docker, or operating-system packages.</p>
        </div>
        {job ? (
          <pre className="max-h-44 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {job.output || "Preparing installation…"}
          </pre>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={Boolean(job?.running)}>Not now</Button>
          <Button onClick={() => void install()} disabled={!runtimeId || Boolean(job?.running)}>
            {job?.running ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Installing…</> : `Install ${runtime?.label ?? "runtime"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
