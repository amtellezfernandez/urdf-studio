import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, ExternalLink, RefreshCw, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Episode {
  id: string;
  number: number;
  frames: Array<{
    timestamp: number;
    jointPositions: Record<string, number>;
  }>;
  createdAt: number;
  metadata?: any;
}

interface RerunViewer3DModalProps {
  episode: Episode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  urdfContent?: string;
}

// Default Rerun serve mode ports
const RERUN_WEB_PORT = 9090;
const RERUN_WS_PORT = 9876;
const RERUN_SERVER_URL = `http://127.0.0.1:${RERUN_WEB_PORT}`;

export const RerunViewer3DModal: React.FC<RerunViewer3DModalProps> = ({
  episode,
  open,
  onOpenChange,
  urdfContent,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pythonProcessRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<"spawn" | "serve">("serve");

  // Check if Rerun server is running
  const checkRerunServer = async () => {
    try {
      const response = await fetch(RERUN_SERVER_URL, {
        method: "HEAD",
        mode: "no-cors",
      });
      setIsServerRunning(true);
      return true;
    } catch (err) {
      setIsServerRunning(false);
      return false;
    }
  };

  // Check if API server is running
  const checkApiServer = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/rerun-visualize", {
        method: "OPTIONS",
      });
      return true;
    } catch (err) {
      return false;
    }
  };

  // Start Rerun visualization
  const startRerunVisualization = async () => {
    if (!episode || !urdfContent) {
      setError("Missing episode data or URDF content");
      return;
    }

    setIsLoading(true);
    setError(null);

    // First check if API server is running
    const apiRunning = await checkApiServer();
    if (!apiRunning) {
      setError(
        "Rerun API server is not running. Make sure you started URDF Studio with 'urdf-studio start'."
      );
      setIsLoading(false);
      toast.error("API server not running. Restart URDF Studio.");
      return;
    }

    try {
      // Prepare episode data for Python script
      const episodeData = {
        id: episode.id,
        number: episode.number,
        frames: episode.frames,
        createdAt: episode.createdAt,
        metadata: episode.metadata,
      };

      // Call Python script via API endpoint
      console.log("Starting Rerun visualization...", {
        episodeId: episode.id,
        frameCount: episode.frames.length,
        mode: viewerMode,
        urdfLength: urdfContent.length,
      });

      const response = await fetch("/api/rerun-visualize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          episode: episodeData,
          urdf: urdfContent,
          recording: `lerobot/episode_${episode.number}`,
          spawn: viewerMode === "spawn",
          serve: viewerMode === "serve",
          web_port: RERUN_WEB_PORT,
          ws_port: RERUN_WS_PORT,
        }),
      });

      console.log("API response status:", response.status, response.statusText);

      if (!response.ok) {
        let errorMessage = "Failed to start Rerun visualization";
        try {
          const errorData = await response.json();
          console.error("API error response:", errorData);
          errorMessage = errorData.error || errorData.message || errorMessage;
          if (errorData.stderr) {
            errorMessage += `\n\nDetails: ${errorData.stderr}`;
          }
          if (errorData.hint) {
            errorMessage += `\n\nHint: ${errorData.hint}`;
          }
        } catch (e) {
          const text = await response.text().catch(() => "");
          console.error("Failed to parse error response:", text);
          errorMessage = text || `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      let responseData;
      try {
        const text = await response.text();
        if (!text || text.trim() === '') {
          console.warn("Empty response from API server");
          responseData = { success: true, message: "Rerun visualization started (empty response)" };
        } else {
          responseData = JSON.parse(text);
        }
      } catch (e) {
        console.warn("Failed to parse response as JSON:", e);
        responseData = { success: true, message: "Rerun visualization started" };
      }

      console.log("API response data:", responseData);
      
      if (!responseData || (!responseData.success && !responseData.message)) {
        throw new Error("Invalid response from API server");
      }

      if (viewerMode === "serve") {
        // Wait a bit for server to start, then check
        setTimeout(async () => {
          const isRunning = await checkRerunServer();
          if (isRunning) {
            setIsServerRunning(true);
            setIsLoading(false);
            toast.success("Rerun viewer started successfully");
          } else {
            // Retry checking
            setTimeout(async () => {
              const retryRunning = await checkRerunServer();
              if (retryRunning) {
                setIsServerRunning(true);
                setIsLoading(false);
                toast.success("Rerun viewer started successfully");
              } else {
                setError("Rerun server did not start. Check console for errors.");
                setIsLoading(false);
              }
            }, 2000);
          }
        }, 2000);
      } else {
        // Spawn mode - desktop viewer should open
        setIsLoading(false);
        toast.success("Rerun desktop viewer should open shortly");
      }
    } catch (err: any) {
      console.error("Error starting Rerun visualization:", err);
      const errorMessage = err.message || "Failed to start Rerun visualization";
      setError(errorMessage);
      setIsLoading(false);
      
      // Show detailed error toast
      toast.error(errorMessage, {
        duration: 5000,
      });
    }
  };

  useEffect(() => {
    if (open && viewerMode === "serve") {
      // Check if server is already running
      checkRerunServer();
    }

    return () => {
      // Cleanup: stop Python process if needed
      if (pythonProcessRef.current) {
        // Process cleanup would be handled by the backend
        pythonProcessRef.current = null;
      }
    };
  }, [open, viewerMode]);

  const handleOpenInNewWindow = () => {
    window.open(RERUN_SERVER_URL, "_blank");
  };

  const handleModeToggle = () => {
    setViewerMode(viewerMode === "spawn" ? "serve" : "spawn");
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Rerun Viewer - Episode {episode?.number || "N/A"}</DialogTitle>
              <DialogDescription className="mt-1">
                {episode && (
                  <>
                    {episode.frames.length} frames,{" "}
                    {Object.keys(episode.frames[0]?.jointPositions || {}).length} joints
                  </>
                )}
              </DialogDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleModeToggle}
                disabled={isLoading}
              >
                Mode: {viewerMode === "spawn" ? "Desktop" : "Web"}
              </Button>
              {viewerMode === "serve" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkRerunServer}
                    disabled={isLoading}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Check Server
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenInNewWindow}
                    disabled={!isServerRunning}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in New Window
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 relative bg-black overflow-hidden">
          {!episode || !urdfContent ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 p-6">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Missing Data</AlertTitle>
                <AlertDescription>
                  Episode data or URDF content is missing. Cannot visualize.
                </AlertDescription>
              </Alert>
            </div>
          ) : !isServerRunning && viewerMode === "serve" && !isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 p-6">
              <div className="max-w-2xl space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Start Rerun Visualization</AlertTitle>
                  <AlertDescription className="mt-2 space-y-3">
                    <p>
                      Click the button below to start visualizing this episode in Rerun.
                    </p>
                    <div className="bg-muted p-4 rounded-md">
                      <p className="text-sm font-mono mb-2">
                        Mode: <strong>{viewerMode === "spawn" ? "Desktop Viewer" : "Web Viewer"}</strong>
                      </p>
                      {viewerMode === "serve" && (
                        <p className="text-xs text-muted-foreground">
                          Web viewer will be available at: {RERUN_SERVER_URL}
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={startRerunVisualization}
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Starting Rerun...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Start Rerun Visualization
                        </>
                      )}
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          ) : isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
              <div className="text-center">
                <Loader2 className="animate-spin h-8 w-8 text-primary mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">
                  {viewerMode === "spawn" 
                    ? "Starting Rerun desktop viewer..." 
                    : "Starting Rerun web server..."}
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 p-6">
              <Alert variant="destructive" className="max-w-md">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="mt-2 space-y-3">
                  <p>{error}</p>
                  <div className="text-sm space-y-2">
                    <p className="font-semibold">Troubleshooting:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Make sure rerun-sdk is installed: <code className="bg-muted px-1 rounded">pip install rerun-sdk</code></li>
                      <li>Check that the Python script is accessible: <code className="bg-muted px-1 rounded">scripts/rerun_viewer.py</code></li>
                      <li>Try switching to Desktop mode if Web mode fails</li>
                    </ul>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startRerunVisualization}
                    className="mt-2"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : viewerMode === "serve" && isServerRunning ? (
            <iframe
              ref={iframeRef}
              src={RERUN_SERVER_URL}
              className="w-full h-full border-0"
              title="Rerun Viewer"
              allow="fullscreen"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
