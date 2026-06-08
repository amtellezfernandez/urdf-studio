/**
 * ExperimentDashboard - Main dashboard page with tabs for experiments
 */

import { useEffect } from "react";
import { FlaskConical, BarChart2, Database, Play } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import { JobList } from "./JobList";
import { JobDetails } from "./JobDetails";
import { useExperimentStore, selectHasActiveJobs, selectRunningJobs } from "./useExperimentStore";
import { useTrainingStore } from "@/features/training";

// ============================================================================
// Stats Card
// ============================================================================

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

function StatsCard({ title, value, subtitle, icon, trend }: StatsCardProps) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
          {trend && (
            <p
              className={cn(
                "text-xs mt-1",
                trend.isPositive ? "text-green-600" : "text-red-600"
              )}
            >
              {trend.isPositive ? "+" : ""}{trend.value}% from last week
            </p>
          )}
        </div>
        <div className="p-2 bg-muted rounded-lg">{icon}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const { jobs, total } = useExperimentStore();
  const runningJobs = useExperimentStore(selectRunningJobs);

  const completedJobs = jobs.filter((j) => j.status === "completed").length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;

  const successRate = total > 0
    ? Math.round((completedJobs / (completedJobs + failedJobs)) * 100) || 0
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Jobs"
          value={total}
          icon={<FlaskConical className="h-5 w-5 text-muted-foreground" />}
        />
        <StatsCard
          title="Running"
          value={runningJobs.length}
          subtitle={runningJobs.length > 0 ? "Jobs in progress" : "No active jobs"}
          icon={<Play className="h-5 w-5 text-blue-500" />}
        />
        <StatsCard
          title="Completed"
          value={completedJobs}
          icon={<BarChart2 className="h-5 w-5 text-green-500" />}
        />
        <StatsCard
          title="Success Rate"
          value={`${successRate}%`}
          subtitle={`${failedJobs} failed`}
          icon={<Database className="h-5 w-5 text-muted-foreground" />}
        />
      </div>

      {/* Running Jobs Quick View */}
      {runningJobs.length > 0 && (
        <div className="bg-card border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Active Jobs</h3>
          <div className="space-y-3">
            {runningJobs.slice(0, 3).map((job) => (
              <div key={job.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <div>
                    <p className="text-sm font-medium">{job.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.modelArchitecture.toUpperCase()} - {job.datasetId}
                    </p>
                  </div>
                </div>
                {job.progress && (
                  <div className="text-right">
                    <p className="text-sm font-medium">{Math.round(job.progress.overallProgress)}%</p>
                    <p className="text-xs text-muted-foreground">
                      Epoch {job.progress.currentEpoch}/{job.progress.totalEpochs}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Jobs Tab with Split View
// ============================================================================

interface JobsTabProps {
  onSelectJob?: (jobId: string) => void;
}

function JobsTab({ onSelectJob }: JobsTabProps) {
  const { selectedJobId } = useExperimentStore();

  // Notify parent when a job is selected
  useEffect(() => {
    if (selectedJobId && onSelectJob) {
      onSelectJob(selectedJobId);
    }
  }, [selectedJobId, onSelectJob]);

  return (
    <div className="flex h-[calc(100vh-16rem)] gap-4">
      {/* Jobs List */}
      <div
        className={cn(
          "border rounded-lg bg-card overflow-hidden transition-all",
          selectedJobId ? "w-1/2" : "w-full"
        )}
      >
        <JobList />
      </div>

      {/* Job Details */}
      {selectedJobId && (
        <div className="w-1/2 border rounded-lg bg-card overflow-hidden">
          <JobDetails />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface ExperimentDashboardProps {
  onSelectJob?: (jobId: string) => void;
}

export function ExperimentDashboard({ onSelectJob }: ExperimentDashboardProps) {
  const openTrainingDialog = useTrainingStore((state) => state.openDialog);
  const hasActiveJobs = useExperimentStore(selectHasActiveJobs);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-2xl font-semibold">Experiments</h1>
          <p className="text-sm text-muted-foreground">
            Monitor and manage your training jobs
          </p>
        </div>
        <Button onClick={openTrainingDialog}>
          <Play className="h-4 w-4 mr-2" />
          New Training
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="jobs" className="h-full flex flex-col">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs
              {hasActiveJobs && (
                <span className="ml-2 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-auto">
            <OverviewTab />
          </TabsContent>

          <TabsContent value="jobs" className="flex-1 overflow-hidden">
            <JobsTab onSelectJob={onSelectJob} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
