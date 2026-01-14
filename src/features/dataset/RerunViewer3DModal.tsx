import React, { useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { AlertCircle, Loader2, Play, Eye, Monitor, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { EpisodeMetadata } from "@/features/dataset";

// Constants
const RERUN_SERVER_URL = "http://127.0.0.1:9090";
const RERUN_WS_PORT = 9876;
const API_BASE_URL = "http://localhost:8000";

interface Episode {
  id: string;
  number: number;
  frames: Array<{
    timestamp: number;
    jointPositions: Record<string, number>;
  }>;
  createdAt: number;
  metadata?: EpisodeMetadata;
}

interface RerunStartResponse {
  success?: boolean;
  stderr?: string;
  pid?: number;
  message?: string;
  error?: string;
}

interface RerunViewer3DModalProps {
  episode: Episode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  urdfContent?: string;
}

export const RerunViewer3DModal: React.FC<RerunViewer3DModalProps> = ({
  episode,
  open,
  onOpenChange,
  urdfContent,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pythonProcessRef = useRef<RerunStartResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<"spawn" | "serve">("serve");
  const [recordingName, setRecordingName] = useState<string>("");

  // Check if server is running
  const checkServerStatus = async () => {
    try {
      const response = await fetch(`${RERUN_SERVER_URL}`, {
        method: "HEAD",
        mode: "no-cors",
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  // Stop Rerun visualization
  const stopRerunVisualization = async () => {
    try {
      // Try to stop via API if available
      try {
        await fetch(`${API_BASE_URL}/rerun/visualize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "stop" }),
        });
      } catch (err) {
        // API might not support stop, that's okay
        console.log("Stop endpoint not available");
      }
      setIsServerRunning(false);
      pythonProcessRef.current = null;
    } catch (err) {
      console.error("Error stopping Rerun:", err);
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

    // Check if API is available
    try {
      const apiCheck = await fetch(`${API_BASE_URL}/rerun/visualize`, {
        method: "OPTIONS",
      });
      if (!apiCheck.ok && apiCheck.status !== 405) {
        throw new Error("Backend API is not available");
      }
    } catch (err) {
      setError(
        "Backend API is not available. Please ensure the API server is running."
      );
      setIsLoading(false);
      toast.error("API server not available");
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

      const recording = `lerobot/episode_${episode.number}`;
      setRecordingName(recording);

      const response = await fetch(`${API_BASE_URL}/rerun/visualize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          episode: episodeData,
          urdf: urdfContent,
          recording: recording,
          spawn: viewerMode === "spawn",
          serve: viewerMode === "serve",
          web_port: 9090,
          ws_port: RERUN_WS_PORT,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to start Rerun visualization";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.detail || errorData.message || errorMessage;
          if (errorData.stderr) {
            errorMessage += `\n\nDetails: ${errorData.stderr}`;
          }
          if (errorData.hint) {
            errorMessage += `\n\nHint: ${errorData.hint}`;
          }
        } catch (e) {
          const text = await response.text().catch(() => "");
          errorMessage = text || `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json().catch(() => ({ success: true }));
      pythonProcessRef.current = result;

      // Check for errors in the response
      if (result.stderr && result.stderr.trim()) {
        console.warn("Rerun stderr:", result.stderr);
        // Don't fail completely, but log the warning
        if (result.stderr.includes("ERROR") || result.stderr.includes("ImportError") || result.stderr.includes("ModuleNotFoundError")) {
          setError(`Rerun error: ${result.stderr.substring(0, 200)}`);
          setIsLoading(false);
          return;
        }
      }

      if (viewerMode === "serve") {
        // Wait a bit for server to start, then check
        setTimeout(async () => {
          const running = await checkServerStatus();
          if (running) {
            setIsServerRunning(true);
            setIsLoading(false);
            toast.success("Rerun web viewer started successfully");
          } else {
            // Retry checking
            setTimeout(async () => {
              const retryRunning = await checkServerStatus();
              if (retryRunning) {
                setIsServerRunning(true);
                setIsLoading(false);
                toast.success("Rerun web viewer started successfully");
              } else {
                setError("Rerun server did not start. Check console for errors.");
                setIsLoading(false);
              }
            }, 2000);
          }
        }, 2000);
      } else {
        // Spawn mode - desktop viewer should open
        // Note: We can't verify if the viewer actually opened, so we show a message
        setIsServerRunning(true);
        setIsLoading(false);
        
        // Check if there were any errors in stderr
        if (result.stderr && result.stderr.trim() && !result.stderr.includes("WARNING")) {
          // If there are errors (not just warnings), show them
          const errorPreview = result.stderr.substring(0, 300);
          setError(`Desktop viewer may not have opened. Error: ${errorPreview}`);
          toast.warning("Desktop viewer may not have opened. Check the error message.");
        } else {
          toast.success("Rerun desktop viewer should open shortly. If it doesn't appear, check that the Rerun viewer application is installed.");
        }
      }
    } catch (err: unknown) {
      console.error("Error starting Rerun visualization:", err);
      const errorMessage = err instanceof Error ? err.message : "An error occurred while starting Rerun";
      setError(errorMessage);
      setIsLoading(false);
      toast.error(errorMessage);
    }
  };

  // Status polling for web viewer
  useEffect(() => {
    if (open && viewerMode === "serve" && isServerRunning) {
      const interval = setInterval(async () => {
        const running = await checkServerStatus();
        if (!running) {
          setIsServerRunning(false);
          toast.warning("Rerun server stopped");
        }
      }, 3000); // Check every 3 seconds

      return () => clearInterval(interval);
    }
  }, [open, viewerMode, isServerRunning]);

  // Check server status when dialog opens
  useEffect(() => {
    if (open && viewerMode === "serve") {
      checkServerStatus().then((running) => {
        setIsServerRunning(running);
      });
    }
  }, [open, viewerMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pythonProcessRef.current) {
        stopRerunVisualization();
      }
    };
  }, []);

  // Handle dialog close
  const handleDialogClose = (open: boolean) => {
    if (!open && isServerRunning) {
      stopRerunVisualization();
    }
    onOpenChange(open);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              <span>Rerun Viewer - Episode {episode?.number || "N/A"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewerMode("serve")}
                className={viewerMode === "serve" ? "bg-primary text-primary-foreground" : ""}
                disabled={isLoading}
              >
                <Monitor className="w-4 h-4 mr-2" />
                Web Viewer
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewerMode("spawn")}
                className={viewerMode === "spawn" ? "bg-primary text-primary-foreground" : ""}
                disabled={isLoading}
              >
                <Monitor className="w-4 h-4 mr-2" />
                Desktop Viewer
              </Button>
            </div>
          </DialogTitle>
          {episode && (
            <DialogDescription className="px-6 pb-2">
              {episode.frames.length} frames,{" "}
              {Object.keys(episode.frames[0]?.jointPositions || {}).length} joints
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 relative bg-black overflow-hidden">
          {!episode || !urdfContent ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Missing Data</AlertTitle>
                <AlertDescription>
                  Episode data or URDF content is missing. Please select a valid episode.
                </AlertDescription>
              </Alert>
            </div>
          ) : !isServerRunning && viewerMode === "serve" && !isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md text-center space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Start Web Viewer</AlertTitle>
                  <AlertDescription className="mt-2 space-y-3">
                    <p>
                      Click the button below to start the Rerun web viewer and visualize
                      Episode {episode.number} in 3D.
                    </p>
                    <Button onClick={startRerunVisualization} className="w-full">
                      <Play className="w-4 h-4 mr-2" />
                      Start Visualization
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          ) : isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-4">
                <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">
                  {viewerMode === "spawn"
                    ? "Starting Rerun desktop viewer..."
                    : "Starting Rerun web server..."}
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <Alert variant="destructive" className="max-w-md">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="mt-2 space-y-3">
                  <p>{error}</p>
                  <div className="text-sm space-y-2">
                    <p className="font-semibold">Troubleshooting:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Make sure rerun-sdk is installed: <code className="bg-muted px-1 rounded">pip install rerun-sdk</code></li>
                      <li>Check that the Python script is accessible: <code className="bg-muted px-1 rounded">backend/scripts/rerun_viewer.py</code></li>
                      <li>Try switching to Desktop mode if Web mode fails</li>
                    </ul>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setError(null);
                      startRerunVisualization();
                    }}
                    className="w-full"
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
              src={`${RERUN_SERVER_URL}?url=ws://127.0.0.1:${RERUN_WS_PORT}`}
              className="w-full h-full border-0"
              title="Rerun Viewer"
              allow="fullscreen"
              onLoad={() => {
                // The web viewer should auto-connect via the URL parameter
                console.log("Rerun web viewer iframe loaded");
              }}
            />
          ) : viewerMode === "spawn" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/80 to-black/60 p-6">
              <div className="max-w-md text-center space-y-6">
                <div className="bg-black/40 backdrop-blur-sm rounded-lg p-6 border border-white/10">
                  <Monitor className="w-16 h-16 mx-auto mb-4 text-primary" />
                  <Alert className="bg-black/60 border-white/20">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle className="text-white">Desktop Viewer Mode</AlertTitle>
                    <AlertDescription className="mt-3 space-y-4 text-gray-300">
                      {isServerRunning ? (
                        <>
                          <div className="mt-4 p-3 bg-green-500/20 border border-green-500/30 rounded-md">
                            <p className="text-sm text-green-300 font-medium mb-2">
                              ✓ Process started successfully
                            </p>
                            <p className="text-xs text-green-200/80 mb-3">
                              The Rerun desktop viewer should open in a <strong>separate application window</strong> (not in this browser).
                            </p>
                            <p className="text-xs text-green-200/80">
                              <strong>If you don't see it:</strong>
                            </p>
                            <ul className="text-xs text-green-200/80 text-left list-disc list-inside space-y-1 mt-2">
                              <li>Check your taskbar/dock for a new window</li>
                              <li>Look for "Rerun Viewer" in your running applications</li>
                              <li>The Rerun viewer application must be installed on your system</li>
                              <li>Try switching to Web Viewer mode if desktop viewer doesn't work</li>
                            </ul>
                          </div>
                          {error && (
                            <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-md">
                              <p className="text-xs text-red-300 font-medium mb-1">⚠ Warning:</p>
                              <p className="text-xs text-red-200/80">{error}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <p>
                            The Rerun desktop viewer will open in a <strong>separate application window</strong> (not in this browser) when you start the visualization.
                          </p>
                          <div className="bg-blue-500/20 border border-blue-500/30 rounded-md p-3 mt-3">
                            <p className="text-xs text-blue-200/80 font-medium mb-2">
                              ⚠ Important: Desktop Viewer Requirements
                            </p>
                            <ul className="text-xs text-blue-200/80 text-left list-disc list-inside space-y-1">
                              <li>The Rerun viewer application must be installed on your system</li>
                              <li>Install it from: <code className="bg-black/30 px-1 rounded">https://rerun.io/viewer</code></li>
                              <li>Your system must allow the application to run</li>
                              <li>No firewall should block the connection</li>
                            </ul>
                          </div>
                          <Button
                            onClick={startRerunVisualization}
                            disabled={isLoading}
                            className="w-full mt-4"
                            size="lg"
                          >
                            {isLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Starting...
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4 mr-2" />
                                Start Desktop Visualization
                              </>
                            )}
                          </Button>
                        </>
                      )}
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
