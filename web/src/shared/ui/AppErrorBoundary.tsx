import React from "react";
import { Button } from "@/shared/ui/button";

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  message?: string;
};

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "Unexpected error",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("AppErrorBoundary caught an error:", error, info);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-lg border border-border bg-background/95 p-6 shadow-lg">
          <div className="text-sm font-semibold text-foreground">
            Something went wrong while rendering the UI
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            This is a controlled fallback to avoid a blank screen. You can refresh to recover.
          </div>
          {this.state.message ? (
            <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground/80">
              {this.state.message}
            </div>
          ) : null}
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={this.handleReload}>
              Refresh
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
