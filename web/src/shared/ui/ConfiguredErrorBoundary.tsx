import React from "react";
import { Button } from "@/shared/ui/button";

type ConfiguredErrorBoundaryProps = {
  boundaryName: string;
  children: React.ReactNode;
  defaultErrorMessage: string;
  title: string;
  description: string;
  buttonLabel: string;
  containerClassName: string;
  panelClassName: string;
};

type ConfiguredErrorBoundaryState = {
  hasError: boolean;
  message?: string;
};

export class ConfiguredErrorBoundary extends React.Component<
  ConfiguredErrorBoundaryProps,
  ConfiguredErrorBoundaryState
> {
  state: ConfiguredErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ConfiguredErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error(`${this.props.boundaryName} caught an error:`, error, info);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.message || this.props.defaultErrorMessage;
    return (
      <div className={this.props.containerClassName}>
        <div className={this.props.panelClassName}>
          <div className="text-sm font-semibold text-foreground">
            {this.props.title}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {this.props.description}
          </div>
          <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground/80">
            {message}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={this.handleReload}>
              {this.props.buttonLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
