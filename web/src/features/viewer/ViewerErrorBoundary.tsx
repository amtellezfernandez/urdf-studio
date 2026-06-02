import React from "react";
import { Button } from "@/shared/ui/button";

type ViewerErrorBoundaryProps = {
  children: React.ReactNode;
};

type ViewerErrorBoundaryState = {
  hasError: boolean;
  message?: string;
};

export class ViewerErrorBoundary extends React.Component<
  ViewerErrorBoundaryProps,
  ViewerErrorBoundaryState
> {
  state: ViewerErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ViewerErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "Unexpected viewer error",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ViewerErrorBoundary caught an error:", error, info);
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
      <div className="h-full w-full bg-background/95 text-foreground flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-lg border border-border bg-background/95 p-5 shadow-lg">
          <div className="text-sm font-semibold text-foreground">
            Viewer failed to render
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            The viewer hit a runtime error. Your data is still loaded; refresh to recover.
          </div>
          {this.state.message ? (
            <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground/80">
              {this.state.message}
            </div>
          ) : null}
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={this.handleReload}>
              Refresh Viewer
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
