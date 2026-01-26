import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

export type JobStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

const statusConfig: Record<JobStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-yellow-500/20 text-yellow-500" },
  queued: { label: "Queued", className: "bg-blue-500/20 text-blue-500" },
  running: { label: "Running", className: "bg-blue-500/20 text-blue-500" },
  completed: { label: "Completed", className: "bg-green-500/20 text-green-500" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-500" },
  cancelled: { label: "Cancelled", className: "bg-gray-500/20 text-gray-500" },
};

interface StatusBadgeProps {
  status: JobStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <Badge className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
