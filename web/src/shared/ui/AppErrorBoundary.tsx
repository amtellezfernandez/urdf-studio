import type { ReactNode } from "react";
import { ConfiguredErrorBoundary } from "@/shared/ui/ConfiguredErrorBoundary";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

export const AppErrorBoundary = ({ children }: AppErrorBoundaryProps) => (
  <ConfiguredErrorBoundary
    boundaryName="AppErrorBoundary"
    defaultErrorMessage="Unexpected error"
    title="Something went wrong while rendering the UI"
    description="This is a controlled fallback to avoid a blank screen. You can refresh to recover."
    buttonLabel="Refresh"
    containerClassName="min-h-screen w-full bg-background text-foreground flex items-center justify-center p-6"
    panelClassName="max-w-xl w-full rounded-lg border border-border bg-background/95 p-6 shadow-lg"
  >
    {children}
  </ConfiguredErrorBoundary>
);
