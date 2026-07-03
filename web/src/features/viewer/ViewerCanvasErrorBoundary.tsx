import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Button } from "@/shared/ui/button";

type ViewerCanvasErrorBoundaryProps = {
  children: ReactNode;
};

type ViewerCanvasErrorBoundaryState = {
  hasError: boolean;
  message: string | null;
};

export class ViewerCanvasErrorBoundary extends Component<
  ViewerCanvasErrorBoundaryProps,
  ViewerCanvasErrorBoundaryState
> {
  state: ViewerCanvasErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): ViewerCanvasErrorBoundaryState {
    const message = error instanceof Error ? error.message : "Unknown render error";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("Viewer3D canvas render failure", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 px-4 text-center">
          <div className="space-y-2 rounded-md border border-border/50 bg-background p-3 shadow-sm">
            <div className="text-sm font-medium text-foreground">
              3D viewer failed to render
            </div>
            <div className="max-w-[36rem] text-xs text-muted-foreground">
              {this.state.message ?? "Unexpected viewer error"}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={this.handleRetry}
            >
              Retry Viewer
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
