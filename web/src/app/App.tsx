import { Toaster } from "@/shared/ui/toaster";
import { Toaster as Sonner } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { GPUModeProvider } from "@/features/theme";
import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";
import { DATASET_REVIEW_ROUTE } from "@/shared/config/datasetReviewRoutes";
import { DatasetReviewStandalonePage } from "@/features/dataset/DatasetReviewStandalonePage";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const baseName = import.meta.env.BASE_URL?.replace(/\/$/, "") || "/";

const App = () => {
  const [versionMismatch, setVersionMismatch] = useState(false);

  useEffect(() => {
    const webBuild = import.meta.env.VITE_BUILD_SHA || "dev";
    if (import.meta.env.MODE === "demo") return;

    const checkVersion = async () => {
      try {
        const response = await guardedFetch(
          `${API_BASE_URL}/version`,
          { cache: "no-store" },
          {
            requiredBackends: FEATURE_GATES.coreApi.requiredBackends,
            context: "Version check",
          }
        );
        if (!response.ok) return;
        const data = await response.json();
        if (data?.build && webBuild !== "dev" && data.build !== "dev") {
          setVersionMismatch(data.build !== webBuild);
        }
      } catch {
        // Ignore network errors (offline/local dev).
      }
    };

    checkVersion();
  }, []);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GPUModeProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            {versionMismatch ? (
              <div className="fixed top-0 left-0 right-0 z-[120] flex items-center justify-between gap-4 bg-[#141414] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/70">
                <span>Version mismatch detected. Refresh to sync.</span>
                <button
                  type="button"
                  className="text-white/90 hover:text-white"
                  onClick={() => window.location.reload()}
                >
                  Refresh
                </button>
              </div>
            ) : null}
            <BrowserRouter
              basename={baseName === "/" ? undefined : baseName}
              future={{
                v7_relativeSplatPath: true,
                v7_startTransition: true,
              }}
            >
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path={DATASET_REVIEW_ROUTE} element={<DatasetReviewStandalonePage />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </GPUModeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
};

export default App;
