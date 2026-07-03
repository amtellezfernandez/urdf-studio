import type { ReactNode } from "react";
import { ConfiguredErrorBoundary } from "@/shared/ui/ConfiguredErrorBoundary";

type ViewerErrorBoundaryProps = {
  children: ReactNode;
};

export const ViewerErrorBoundary = ({ children }: ViewerErrorBoundaryProps) => (
  <ConfiguredErrorBoundary
    boundaryName="ViewerErrorBoundary"
    defaultErrorMessage="Unexpected viewer error"
    title="Viewer failed to render"
    description="The viewer hit a runtime error. Your data is still loaded; refresh to recover."
    buttonLabel="Refresh Viewer"
    containerClassName="h-full w-full bg-background/95 text-foreground flex items-center justify-center p-4"
    panelClassName="max-w-md w-full rounded-lg border border-border bg-background/95 p-5 shadow-lg"
  >
    {children}
  </ConfiguredErrorBoundary>
);
