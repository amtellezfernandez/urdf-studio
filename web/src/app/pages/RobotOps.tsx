/**
 * RobotOps page - Main dashboard for RobotOps features
 */

import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FlaskConical,
  BarChart2,
  Database,
  Play,
  ChevronLeft,
  Settings,
  Home,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import { ExperimentDashboard } from "@/features/experiments";
import { LossCurve } from "@/features/metrics";
import { DatasetBrowser } from "@/features/datasets";
import { EvaluationPanel } from "@/features/evaluation";
import { TrainingDialog } from "@/features/training";

// ============================================================================
// Types
// ============================================================================

type RobotOpsTab = "experiments" | "metrics" | "datasets" | "evaluation";

// ============================================================================
// Navigation
// ============================================================================

interface NavItemProps {
  tab: RobotOpsTab;
  icon: React.ReactNode;
  label: string;
  activeTab: RobotOpsTab;
  onClick: (tab: RobotOpsTab) => void;
}

function NavItem({ tab, icon, label, activeTab, onClick }: NavItemProps) {
  const isActive = activeTab === tab;

  return (
    <button
      className={cn(
        "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors",
        "hover:bg-muted",
        isActive && "bg-primary/10 text-primary font-medium"
      )}
      onClick={() => onClick(tab)}
    >
      {icon}
      {label}
    </button>
  );
}

function Sidebar({
  activeTab,
  onTabChange,
  collapsed,
  onToggleCollapse,
}: {
  activeTab: RobotOpsTab;
  onTabChange: (tab: RobotOpsTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col h-full border-r bg-card transition-all",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b">
        {!collapsed && <h1 className="text-lg font-semibold">RobotOps</h1>}
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 p-0", collapsed && "mx-auto")}
          onClick={onToggleCollapse}
        >
          <ChevronLeft
            className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
          />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {collapsed ? (
          <>
            <Button
              variant={activeTab === "experiments" ? "secondary" : "ghost"}
              size="sm"
              className="w-full h-10"
              onClick={() => onTabChange("experiments")}
              title="Experiments"
            >
              <FlaskConical className="h-5 w-5" />
            </Button>
            <Button
              variant={activeTab === "metrics" ? "secondary" : "ghost"}
              size="sm"
              className="w-full h-10"
              onClick={() => onTabChange("metrics")}
              title="Metrics"
            >
              <BarChart2 className="h-5 w-5" />
            </Button>
            <Button
              variant={activeTab === "datasets" ? "secondary" : "ghost"}
              size="sm"
              className="w-full h-10"
              onClick={() => onTabChange("datasets")}
              title="Datasets"
            >
              <Database className="h-5 w-5" />
            </Button>
            <Button
              variant={activeTab === "evaluation" ? "secondary" : "ghost"}
              size="sm"
              className="w-full h-10"
              onClick={() => onTabChange("evaluation")}
              title="Evaluation"
            >
              <Play className="h-5 w-5" />
            </Button>
          </>
        ) : (
          <>
            <NavItem
              tab="experiments"
              icon={<FlaskConical className="h-5 w-5" />}
              label="Experiments"
              activeTab={activeTab}
              onClick={onTabChange}
            />
            <NavItem
              tab="metrics"
              icon={<BarChart2 className="h-5 w-5" />}
              label="Metrics"
              activeTab={activeTab}
              onClick={onTabChange}
            />
            <NavItem
              tab="datasets"
              icon={<Database className="h-5 w-5" />}
              label="Datasets"
              activeTab={activeTab}
              onClick={onTabChange}
            />
            <NavItem
              tab="evaluation"
              icon={<Play className="h-5 w-5" />}
              label="Evaluation"
              activeTab={activeTab}
              onClick={onTabChange}
            />
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t">
        {collapsed ? (
          <Link to="/">
            <Button variant="ghost" size="sm" className="w-full h-10" title="Back to Studio">
              <Home className="h-5 w-5" />
            </Button>
          </Link>
        ) : (
          <Link to="/">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-3">
              <Home className="h-5 w-5" />
              Back to Studio
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function RobotOps() {
  const [activeTab, setActiveTab] = useState<RobotOpsTab>("experiments");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "experiments" && (
          <ExperimentDashboard onSelectJob={(jobId) => setSelectedJobId(jobId)} />
        )}
        {activeTab === "metrics" && (
          <div className="h-full p-6 overflow-auto">
            <div className="max-w-5xl mx-auto">
              <h1 className="text-2xl font-semibold mb-6">Training Metrics</h1>
              {selectedJobId ? (
                <LossCurve jobId={selectedJobId} />
              ) : (
                <div className="bg-card border rounded-lg p-8 text-center">
                  <BarChart2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h2 className="text-lg font-medium mb-2">No job selected</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select a training job from the Experiments tab to view its metrics.
                  </p>
                  <Button onClick={() => setActiveTab("experiments")}>
                    Go to Experiments
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === "datasets" && (
          <DatasetBrowser
            className="h-full"
            onSelect={(dataset) => {
              // Handle dataset selection - could open training dialog
              console.log("Selected dataset:", dataset);
            }}
          />
        )}
        {activeTab === "evaluation" && <EvaluationPanel className="h-full" />}
      </main>
      <TrainingDialog />
    </div>
  );
}
