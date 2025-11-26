import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Minimize2,
  Maximize2,
  GripHorizontal,
  Link,
  Unlink,
  Eye,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Constants
const CANVAS_PADDING = 40;
const MIN_WINDOW_WIDTH = 400;
const MIN_WINDOW_HEIGHT = 300;
const DRAG_THRESHOLD = 3;
const DEFAULT_FRAME_TIME = 33.33;
const JOINT_COLORS = [
  "#ec4899", "#eab308", "#22c55e", "#3b82f6",
  "#a855f7", "#f97316", "#06b6d4", "#ef4444",
] as const;

interface RecordedFrame {
  timestamp: number;
  jointPositions: Record<string, number>;
}

interface Episode {
  id: string;
  number: number;
  frames: RecordedFrame[];
  createdAt: number;
  metadata?: any;
}

interface EpisodeViewer3DModalProps {
  episode: Episode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEpisodeIndex?: number | null;
  allEpisodes?: Episode[];
  isPlayingAll?: boolean;
  onPlayAllEpisodes?: (overrideFrame?: number) => void;
  onSetCurrentEpisodeIndex?: (index: number | null) => void;
  globalCurrentFrame?: number;
  onSetGlobalFrame?: (frame: number) => void;
}

// Helper function to convert episode to animation frames
const toAnimationFrames = (ep: Episode) =>
  ep.frames.map((frame) => ({
    timestamp: frame.timestamp,
    joints: frame.jointPositions,
  }));

// Helper to get current frame value
const getCurrentFrameValue = (
  preservedFrame: number | null,
  globalFrame?: number,
  localFrame?: number
): number => {
  if (preservedFrame !== null && preservedFrame !== undefined) {
    return preservedFrame;
  }
  return globalFrame ?? localFrame ?? 0;
};

// Helper to calculate frame from mouse position
const calculateFrameFromMouse = (
  mouseX: number,
  canvasWidth: number,
  totalFrames: number
): number => {
  const graphWidth = canvasWidth - CANVAS_PADDING * 2;
  const normalizedX = (mouseX - CANVAS_PADDING) / graphWidth;
  return Math.max(0, Math.min(
    Math.round(normalizedX * (totalFrames - 1)),
    totalFrames - 1
  ));
};

// Helper to update frame in 3D viewer
const updateViewerFrame = (frame: number, episode: Episode) => {
  const frames = toAnimationFrames(episode);
  (window as any).viewer3dPlayEpisode?.(frames);
  (window as any).viewer3dSetFrame?.(frame);
  (window as any).viewer3dStopAnimation?.();
  (window as any).viewer3dPlayAnimation?.(false);
};

export const EpisodeViewer3DModal: React.FC<EpisodeViewer3DModalProps> = ({
  episode,
  open,
  onOpenChange,
  currentEpisodeIndex,
  allEpisodes = [],
  isPlayingAll = false,
  onPlayAllEpisodes,
  onSetCurrentEpisodeIndex,
  globalCurrentFrame,
  onSetGlobalFrame,
}) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [selectedJoints, setSelectedJoints] = useState<Set<string>>(new Set());
  const [isMinimized, setIsMinimized] = useState(false);
  const [syncWith3DViewer, setSyncWith3DViewer] = useState(true);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingTimelineRef = useRef<boolean>(false);
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
  const preservedFrameRef = useRef<number | null>(null);

  // Get all joint names from the episode
  const jointNames = useMemo(() => {
    if (!episode || episode.frames.length === 0) return [];
    return Object.keys(episode.frames[0].jointPositions).sort();
  }, [episode]);

  // Calculate min/max values for each joint
  const jointRanges = useMemo(() => {
    if (!episode || episode.frames.length === 0) return {};
    const ranges: Record<string, { min: number; max: number }> = {};

    jointNames.forEach((jointName) => {
      const values = episode.frames.map((f) => f.jointPositions[jointName]);
      ranges[jointName] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });

    return ranges;
  }, [episode, jointNames]);

  // Create stable color mapping for joints
  const jointColorMap = useMemo(() => {
    const map = new Map<string, string>();
    jointNames.forEach((jointName, index) => {
      map.set(jointName, JOINT_COLORS[index % JOINT_COLORS.length]);
    });
    return map;
  }, [jointNames]);

  // Listen to global frame updates from 3D viewer when playing
  useEffect(() => {
    if (!syncWith3DViewer || !open || !isPlayingAll) return;

    const handleFrameUpdate = (event: CustomEvent) => {
      const { frame, episodeIndex } = event.detail;
      if (episodeIndex === currentEpisodeIndex && isPlayingAll) {
        setCurrentFrame(frame);
        preservedFrameRef.current = frame;
      }
    };

    window.addEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);
    return () => {
      window.removeEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);
    };
  }, [syncWith3DViewer, open, currentEpisodeIndex, isPlayingAll]);

  // Update preserved frame when not playing
  useEffect(() => {
    if (isPlayingAll) return;
    const currentFrameValue = globalCurrentFrame ?? currentFrame;
    if (currentFrameValue !== undefined && currentFrameValue !== null) {
      preservedFrameRef.current = currentFrameValue;
    }
  }, [isPlayingAll, globalCurrentFrame, currentFrame]);

  // Sync local frame with global when manually set (paused)
  useEffect(() => {
    if (!isPlayingAll && globalCurrentFrame !== undefined && syncWith3DViewer) {
      setCurrentFrame(globalCurrentFrame);
      preservedFrameRef.current = globalCurrentFrame;
    }
  }, [isPlayingAll, globalCurrentFrame, syncWith3DViewer]);

  // Reset state when episode changes
  useEffect(() => {
    setCurrentFrame(0);
    preservedFrameRef.current = 0;
    if (episode) {
      const allJoints = new Set(Object.keys(episode.frames[0]?.jointPositions || {}));
      setSelectedJoints(allJoints);
    }
  }, [episode?.id]);

  // Initialize preserved frame on mount
  useEffect(() => {
    if (preservedFrameRef.current === null) {
      preservedFrameRef.current = globalCurrentFrame ?? currentFrame ?? 0;
    }
  }, []);

  // Navigate to episode
  const navigateToEpisode = useCallback((direction: 'prev' | 'next') => {
    if (allEpisodes.length === 0) return;
    const currentIndex = currentEpisodeIndex ?? 0;
    const newIndex = direction === 'prev'
      ? (currentIndex > 0 ? currentIndex - 1 : allEpisodes.length - 1)
      : (currentIndex + 1) % allEpisodes.length;
    
    const targetEpisode = allEpisodes[newIndex];
    if (targetEpisode?.frames.length > 0) {
      updateViewerFrame(0, targetEpisode);
      onSetCurrentEpisodeIndex?.(newIndex);
      onSetGlobalFrame?.(0);
    }
  }, [allEpisodes, currentEpisodeIndex, onSetCurrentEpisodeIndex, onSetGlobalFrame]);

  // Handle play/pause
  const handlePlayPause = useCallback(() => {
    if (!onPlayAllEpisodes || !episode) return;

    const currentFrameValue = getCurrentFrameValue(
      preservedFrameRef.current,
      globalCurrentFrame,
      currentFrame
    );

    preservedFrameRef.current = currentFrameValue;
    setCurrentFrame(currentFrameValue);

    if (episode) {
      if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
        onSetCurrentEpisodeIndex(currentEpisodeIndex);
      } else if (currentEpisodeIndex === null && allEpisodes.length > 0) {
        const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
        if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
          onSetCurrentEpisodeIndex(episodeIndex);
        }
      }

      if (onSetGlobalFrame) {
        onSetGlobalFrame(currentFrameValue);
      }
    }

    onPlayAllEpisodes(currentFrameValue);
  }, [onPlayAllEpisodes, episode, globalCurrentFrame, currentFrame, currentEpisodeIndex, allEpisodes, onSetCurrentEpisodeIndex, onSetGlobalFrame]);

  // Handle timeline mouse down
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!episode || !canvasRef.current || episode.frames.length === 0) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (x < CANVAS_PADDING || x > rect.width - CANVAS_PADDING) return;

    dragStartPositionRef.current = { x: e.clientX, y: e.clientY };
    isDraggingTimelineRef.current = false;

    const frameIndex = calculateFrameFromMouse(x, rect.width, episode.frames.length);

    if (isPlayingAll && onPlayAllEpisodes) {
      onPlayAllEpisodes();
    }

    if (isPlayingAll) {
      (window as any).viewer3dStopAnimation?.();
    }

    if (onSetGlobalFrame) {
      onSetGlobalFrame(frameIndex);
    }

    if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
      onSetCurrentEpisodeIndex(currentEpisodeIndex);
    } else if (currentEpisodeIndex === null && allEpisodes.length > 0) {
      const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
      if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
        onSetCurrentEpisodeIndex(episodeIndex);
      }
    }

    if (episode) {
      (window as any).viewer3dSetFrame?.(frameIndex);
    }

    setCurrentFrame(frameIndex);
  }, [episode, isPlayingAll, onPlayAllEpisodes, onSetGlobalFrame, currentEpisodeIndex, allEpisodes, onSetCurrentEpisodeIndex]);

  // Handle timeline mouse move
  const handleTimelineMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!episode || !canvasRef.current || !dragStartPositionRef.current) return;

    const moveDistance = Math.sqrt(
      Math.pow(e.clientX - dragStartPositionRef.current.x, 2) +
      Math.pow(e.clientY - dragStartPositionRef.current.y, 2)
    );

    if (moveDistance > DRAG_THRESHOLD) {
      isDraggingTimelineRef.current = true;
    }

    if (!isDraggingTimelineRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (x >= CANVAS_PADDING && x <= rect.width - CANVAS_PADDING && episode.frames.length > 0) {
      const frameIndex = calculateFrameFromMouse(x, rect.width, episode.frames.length);

      if (onSetGlobalFrame) {
        onSetGlobalFrame(frameIndex);
      }

      (window as any).viewer3dSetFrame?.(frameIndex);
      setCurrentFrame(frameIndex);
    }
  }, [episode, onSetGlobalFrame]);

  const handleTimelineMouseUp = useCallback(() => {
    isDraggingTimelineRef.current = false;
    dragStartPositionRef.current = null;
  }, []);

  const handleTimelineMouseLeave = useCallback(() => {
    isDraggingTimelineRef.current = false;
    dragStartPositionRef.current = null;
  }, []);

  // Calculate time display
  const calculateTime = useCallback((frame: number): string => {
    if (!episode || episode.frames.length === 0) return "0.00s";
    
    const totalFrames = episode.frames.length;
    const totalDuration = episode.frames[totalFrames - 1].timestamp - episode.frames[0].timestamp;
    const effectiveSpeed = syncWith3DViewer 
      ? ((window as any).viewer3dGetPlaybackSpeed?.() ?? 1.0)
      : playbackSpeed;
    const frameDuration = totalFrames > 1 
      ? (totalDuration / (totalFrames - 1)) / effectiveSpeed
      : 0;
    const calculatedTime = frame * frameDuration;
    return `${(calculatedTime / 1000).toFixed(2)}s`;
  }, [episode, syncWith3DViewer, playbackSpeed]);

  // Draw canvas
  useLayoutEffect(() => {
    if (!episode || !canvasRef.current || isMinimized) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const width = rect.width;
    const height = rect.height;
    const graphHeight = height - CANVAS_PADDING * 2;
    const graphWidth = width - CANVAS_PADDING * 2;

    // Clear canvas
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;

    const totalFrames = episode.frames.length;
    const gridDivisions = Math.min(10, totalFrames);

    for (let i = 0; i <= gridDivisions; i++) {
      const x = CANVAS_PADDING + (graphWidth * i) / gridDivisions;
      ctx.beginPath();
      ctx.moveTo(x, CANVAS_PADDING);
      ctx.lineTo(x, height - CANVAS_PADDING);
      ctx.stroke();

      if (totalFrames > 0) {
        const frameNumber = Math.round((i / gridDivisions) * (totalFrames - 1));
        ctx.fillStyle = "#71717a";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`F${frameNumber}`, x, height - CANVAS_PADDING + 15);
      }
    }

    for (let i = 0; i <= 5; i++) {
      const y = CANVAS_PADDING + (graphHeight * i) / 5;
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, y);
      ctx.lineTo(width - CANVAS_PADDING, y);
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = "#52525b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CANVAS_PADDING, CANVAS_PADDING);
    ctx.lineTo(CANVAS_PADDING, height - CANVAS_PADDING);
    ctx.lineTo(width - CANVAS_PADDING, height - CANVAS_PADDING);
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Frame", width / 2, height - 10);

    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Joint Position", 0, 0);
    ctx.restore();

    // Draw joint curves
    const selectedJointNames = jointNames.filter((name) => selectedJoints.has(name));

    selectedJointNames.forEach((jointName) => {
      const color = jointColorMap.get(jointName) || JOINT_COLORS[0];
      const range = jointRanges[jointName];
      if (!range) return;

      const rangePadding = (range.max - range.min) * 0.1 || 0.1;
      const minVal = range.min - rangePadding;
      const maxVal = range.max + rangePadding;
      const valueRange = maxVal - minVal;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      episode.frames.forEach((frame, frameIndex) => {
        const value = frame.jointPositions[jointName];
        const x = CANVAS_PADDING + (graphWidth * frameIndex) / (episode.frames.length - 1);
        const normalizedValue = (value - minVal) / valueRange;
        const y = height - CANVAS_PADDING - graphHeight * normalizedValue;

        if (frameIndex === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    });

    // Draw current frame indicator
    if (episode.frames.length > 0) {
      const displayFrame = getCurrentFrameValue(
        preservedFrameRef.current,
        globalCurrentFrame,
        currentFrame
      );
      const clampedFrame = Math.max(0, Math.min(displayFrame, episode.frames.length - 1));
      const x = CANVAS_PADDING + (graphWidth * clampedFrame) / (episode.frames.length - 1);

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, CANVAS_PADDING);
      ctx.lineTo(x, height - CANVAS_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ffffff";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      const timeText = calculateTime(clampedFrame);
      ctx.fillText(`F${clampedFrame} (${timeText})`, x, CANVAS_PADDING - 10);
    }
  }, [episode, currentFrame, globalCurrentFrame, selectedJoints, jointNames, jointRanges, jointColorMap, isMinimized, size, syncWith3DViewer, playbackSpeed, calculateTime]);

  // Mouse handlers for dragging
  const handleMouseDownHeader = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('drag-handle')) {
      return;
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [position]);

  const handleMouseDownResize = useCallback((e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
  }, [size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;

        let newWidth = resizeStart.width;
        let newHeight = resizeStart.height;
        let newX = position.x;
        let newY = position.y;

        if (resizeDirection.includes('e')) {
          newWidth = Math.max(MIN_WINDOW_WIDTH, resizeStart.width + deltaX);
        }
        if (resizeDirection.includes('s')) {
          newHeight = Math.max(MIN_WINDOW_HEIGHT, resizeStart.height + deltaY);
        }
        if (resizeDirection.includes('w')) {
          const width = Math.max(MIN_WINDOW_WIDTH, resizeStart.width - deltaX);
          if (width > MIN_WINDOW_WIDTH) {
            newWidth = width;
            newX = position.x + deltaX;
          }
        }
        if (resizeDirection.includes('n')) {
          const height = Math.max(MIN_WINDOW_HEIGHT, resizeStart.height - deltaY);
          if (height > MIN_WINDOW_HEIGHT) {
            newHeight = height;
            newY = position.y + deltaY;
          }
        }

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragOffset, resizeStart, resizeDirection, position]);

  if (!open || !episode) return null;

  const totalFrames = episode.frames.length;
  const duration = totalFrames > 0 ? episode.frames[totalFrames - 1].timestamp : 0;
  const durationSeconds = (duration / 1000).toFixed(1);
  const displayFrame = getCurrentFrameValue(preservedFrameRef.current, globalCurrentFrame, currentFrame);

  const modalContent = (
    <div
      ref={containerRef}
      className="fixed bg-background border-2 border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '300px' : `${size.width}px`,
        height: isMinimized ? 'auto' : `${size.height}px`,
        zIndex: 99999,
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted border-b border-border cursor-move drag-handle"
        onMouseDown={handleMouseDownHeader}
      >
        <div className="flex items-center gap-2 flex-1 pointer-events-none">
          <GripHorizontal className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold">Episode {episode.number} - Joint Movements</h3>
            <p className="text-xs text-muted-foreground">
              {totalFrames} frames • {durationSeconds}s
            </p>
            {episode.metadata?.additional?.sourceType && (
              <div className="flex items-center gap-1.5 mt-1">
                <Badge
                  variant={
                    episode.metadata.additional.sourceType === 'hf'
                      ? 'default'
                      : episode.metadata.additional.sourceType === 'local'
                      ? 'secondary'
                      : 'outline'
                  }
                  className="text-[10px] px-1.5 py-0 h-4"
                >
                  {episode.metadata.additional.sourceType === 'hf'
                    ? 'HF'
                    : episode.metadata.additional.sourceType === 'local'
                    ? 'Local'
                    : episode.metadata.additional.sourceType === 'recorded'
                    ? 'Recorded'
                    : episode.metadata.additional.sourceType}
                </Badge>
                {episode.metadata.additional.sourceName && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {episode.metadata.additional.sourceName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={syncWith3DViewer ? "default" : "ghost"}
                className="h-6 w-6 p-0"
                onClick={() => setSyncWith3DViewer(!syncWith3DViewer)}
              >
                {syncWith3DViewer ? (
                  <Link className="w-3 h-3" />
                ) : (
                  <Unlink className="w-3 h-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{syncWith3DViewer ? "Synced with 3D Viewer" : "Independent Playback"}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setIsMinimized(!isMinimized)}
              >
                {isMinimized ? (
                  <Maximize2 className="w-3 h-3" />
                ) : (
                  <Minimize2 className="w-3 h-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMinimized ? "Maximize" : "Minimize"}</p>
            </TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            variant={open ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => onOpenChange(!open)}
          >
            <Eye className="w-3.5 h-3.5 mr-1.5" />
            {open ? "Close Viewer" : "Open Viewer"}
          </Button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <>
          {/* Graph Canvas and Legend */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 relative bg-background overflow-hidden">
              <canvas
                ref={canvasRef}
                className="w-full h-full cursor-pointer"
                style={{ background: "#09090b" }}
                onMouseDown={handleTimelineMouseDown}
                onMouseMove={handleTimelineMouseMove}
                onMouseUp={handleTimelineMouseUp}
                onMouseLeave={handleTimelineMouseLeave}
              />
            </div>

            {/* Joints Legend */}
            <div className="w-32 bg-background border-l border-border p-2 overflow-y-auto">
              {!episode || jointNames.length === 0 ? (
                <div className="text-xs text-muted-foreground">No joints available</div>
              ) : (
                (() => {
                  const selectedJointNames = jointNames.filter((name) => selectedJoints.has(name));
                  
                  if (selectedJointNames.length === 0) {
                    return (
                      <div className="text-xs text-muted-foreground">No joints selected</div>
                    );
                  }

                  return (
                    <div className="space-y-0.5">
                      {selectedJointNames.map((jointName) => {
                        const color = jointColorMap.get(jointName) || JOINT_COLORS[0];
                        const currentValue = episode.frames[displayFrame]?.jointPositions[jointName];

                        return (
                          <div key={jointName} className="min-w-0">
                            <div className="text-xs font-mono truncate leading-tight" style={{ color }}>
                              {jointName}
                            </div>
                            {currentValue !== undefined && (
                              <div className="text-[10px] font-mono text-muted-foreground leading-tight">
                                {currentValue.toFixed(2)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          </div>

          {/* Controls Panel */}
          <div className="p-3 bg-muted/30 space-y-3 border-t border-border">
            {syncWith3DViewer && (
              <div className="text-xs text-center text-muted-foreground bg-primary/10 border border-primary/30 rounded px-2 py-1">
                <Link className="w-3 h-3 inline mr-1" />
                Synced with 3D Viewer - Controls work globally
              </div>
            )}

            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-1">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => navigateToEpisode('prev')}
                    disabled={allEpisodes.length === 0}
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Previous episode</p></TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={isPlayingAll ? "default" : "ghost"}
                    className="h-7 w-7 p-0"
                    onClick={handlePlayPause}
                    disabled={allEpisodes.length === 0}
                  >
                    {isPlayingAll ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isPlayingAll ? "Pause" : "Play all episodes"}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => navigateToEpisode('next')}
                    disabled={allEpisodes.length === 0}
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Next episode</p></TooltipContent>
              </Tooltip>

              <div className="flex items-center gap-1 ml-2 px-2 py-1 bg-background rounded border text-xs">
                <span className="text-muted-foreground">Frame:</span>
                <span className="font-mono font-medium">
                  {totalFrames > 0 ? displayFrame : 0}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="font-mono text-muted-foreground">{totalFrames}</span>
              </div>

              <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs">
                <span className="text-muted-foreground">Time:</span>
                <span className="font-mono font-medium">
                  {totalFrames > 0 && episode ? calculateTime(displayFrame) : "0.00s"}
                </span>
              </div>
            </div>

            {/* Speed Control */}
            {!syncWith3DViewer && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground min-w-[45px]">Speed:</span>
                <Slider
                  value={[playbackSpeed]}
                  onValueChange={(values) => setPlaybackSpeed(values[0])}
                  min={0.25}
                  max={6}
                  step={0.25}
                  className="flex-1"
                />
                <span className="text-xs font-mono min-w-[45px] text-right">
                  {playbackSpeed.toFixed(2)}x
                </span>
              </div>
            )}

            {/* Joint Selection */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Visible Joints:</span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 text-xs px-2"
                    onClick={() => setSelectedJoints(new Set(jointNames))}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 text-xs px-2"
                    onClick={() => setSelectedJoints(new Set())}
                  >
                    None
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {jointNames.map((jointName, index) => {
                  const color = jointColorMap.get(jointName) || JOINT_COLORS[index % JOINT_COLORS.length];
                  const isSelected = selectedJoints.has(jointName);

                  return (
                    <button
                      key={jointName}
                      onClick={() => {
                        const newSelected = new Set(selectedJoints);
                        if (isSelected) {
                          newSelected.delete(jointName);
                        } else {
                          newSelected.add(jointName);
                        }
                        setSelectedJoints(newSelected);
                      }}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-xs font-mono transition-all border",
                        isSelected
                          ? "opacity-100 border-current"
                          : "opacity-40 border-transparent hover:opacity-60"
                      )}
                      style={{
                        color: color,
                        backgroundColor: isSelected ? `${color}20` : "transparent",
                      }}
                    >
                      {jointName}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Resize Handles */}
          {['se', 's', 'e', 'w', 'n', 'sw', 'ne', 'nw'].map((direction) => (
            <div
              key={direction}
              className={`absolute ${
                direction === 'se' ? 'bottom-0 right-0 w-4 h-4 cursor-se-resize' :
                direction === 's' ? 'bottom-0 left-0 right-0 h-1 cursor-s-resize' :
                direction === 'e' ? 'top-0 bottom-0 right-0 w-1 cursor-e-resize' :
                direction === 'w' ? 'top-0 bottom-0 left-0 w-1 cursor-w-resize' :
                direction === 'n' ? 'top-0 left-0 right-0 h-1 cursor-n-resize' :
                direction === 'sw' ? 'bottom-0 left-0 w-4 h-4 cursor-sw-resize' :
                direction === 'ne' ? 'top-0 right-0 w-4 h-4 cursor-ne-resize' :
                'top-0 left-0 w-4 h-4 cursor-nw-resize'
              }`}
              onMouseDown={(e) => handleMouseDownResize(e, direction)}
              style={{ background: direction.length === 2 ? 'transparent' : undefined }}
            />
          ))}
        </>
      )}
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
};
