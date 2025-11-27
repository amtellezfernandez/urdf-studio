import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Minimize2,
  Maximize2,
  GripHorizontal,
  Eye,
  X,
  LayoutGrid,
  Square,
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
  inline?: boolean; // If true, render inline instead of as modal
  onToggleViewMode?: () => void; // Toggle between split view and floating window
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
  inline = false,
  onToggleViewMode,
}) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [selectedJoints, setSelectedJoints] = useState<Set<string>>(new Set());
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
    if (!open || !isPlayingAll) return;

    const handleFrameUpdate = (event: CustomEvent) => {
      const { frame, episodeIndex } = event.detail;
      if (episodeIndex === currentEpisodeIndex) {
        setCurrentFrame(frame);
        preservedFrameRef.current = frame;
      }
    };

    window.addEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);
    return () => {
      window.removeEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);
    };
  }, [open, currentEpisodeIndex, isPlayingAll]);

  // Update preserved frame when not playing
  useEffect(() => {
    if (isPlayingAll) return;
    const currentFrameValue = globalCurrentFrame ?? currentFrame;
    if (currentFrameValue != null) {
      preservedFrameRef.current = currentFrameValue;
    }
  }, [isPlayingAll, globalCurrentFrame, currentFrame]);

  // Sync local frame with global when manually set (paused)
  useEffect(() => {
    if (!isPlayingAll && globalCurrentFrame !== undefined) {
      setCurrentFrame(globalCurrentFrame);
      preservedFrameRef.current = globalCurrentFrame;
    }
  }, [isPlayingAll, globalCurrentFrame]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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

    if (isPlayingAll) {
      onPlayAllEpisodes?.();
      (window as any).viewer3dStopAnimation?.();
    }

    onSetGlobalFrame?.(frameIndex);

    if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
      onSetCurrentEpisodeIndex(currentEpisodeIndex);
    } else if (currentEpisodeIndex === null && allEpisodes.length > 0) {
      const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
      if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
        onSetCurrentEpisodeIndex(episodeIndex);
      }
    }

    (window as any).viewer3dSetFrame?.(frameIndex);

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
      onSetGlobalFrame?.(frameIndex);
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
    const effectiveSpeed = (window as any).viewer3dGetPlaybackSpeed?.() ?? 1.0;
    const frameDuration = totalFrames > 1 
      ? (totalDuration / (totalFrames - 1)) / effectiveSpeed
      : 0;
    const calculatedTime = frame * frameDuration;
    return `${(calculatedTime / 1000).toFixed(2)}s`;
  }, [episode]);

  // Draw canvas
  useLayoutEffect(() => {
    if (!episode || !canvasRef.current) return;

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
  }, [episode, currentFrame, globalCurrentFrame, selectedJoints, jointNames, jointRanges, jointColorMap, size, calculateTime]);

  // Mouse handlers for dragging
  const handleMouseDownHeader = useCallback((e: React.MouseEvent) => {
    // Don't start dragging if clicking on buttons or interactive elements
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.closest('[role="button"]') ||
      target.closest('[data-interactive]') ||
      target.closest('[data-radix-tooltip-trigger]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      (target !== e.currentTarget && !target.classList.contains('drag-handle'))
    ) {
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

  const content = (
    <div
      ref={containerRef}
      className={cn(
        "bg-background flex flex-col overflow-hidden h-full",
        inline ? "border-t border-border" : "fixed border-2 border-border rounded-lg shadow-2xl"
      )}
      style={inline ? {} : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        zIndex: 99999,
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 bg-muted border-b border-border",
          !inline && "cursor-move drag-handle"
        )}
        onMouseDown={!inline ? handleMouseDownHeader : undefined}
      >
        <div className="flex items-center gap-2 flex-1 pointer-events-none">
          {!inline && <GripHorizontal className="w-4 h-4 text-muted-foreground" />}
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Episode {episode.number}</h3>
            {episode.metadata?.additional?.sourceType && (
              <div className="flex items-center gap-1.5">
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
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4"
                  >
                    {episode.metadata.additional.sourceName}
                  </Badge>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs">
              <span className="text-muted-foreground">Frame:</span>
              <span className="font-mono font-medium">{displayFrame}</span>
              <span className="text-muted-foreground">/</span>
              <span className="font-mono text-muted-foreground">{totalFrames}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs">
              <span className="text-muted-foreground">Time:</span>
              <span className="font-mono font-medium">
                {episode ? `${calculateTime(displayFrame).replace('s', '')}/${durationSeconds} s` : "0.00/0.00 s"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleViewMode && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={onToggleViewMode}
                >
                  {inline ? (
                    <Square className="w-3 h-3" />
                  ) : (
                    <LayoutGrid className="w-3 h-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{inline ? "Floating Window" : "Split View"}</p>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Close Viewer</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
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
                <div className="space-y-0.5">
                  {jointNames.map((jointName) => {
                    const isVisible = selectedJoints.has(jointName);
                    const color = jointColorMap.get(jointName) || JOINT_COLORS[0];
                    const displayColor = isVisible ? color : "#71717a"; // Grey when not visible
                    const currentValue = episode.frames[displayFrame]?.jointPositions[jointName];

                    return (
                      <div
                        key={jointName}
                        className="min-w-0 cursor-pointer hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
                        onClick={() => {
                          const newSelected = new Set(selectedJoints);
                          if (isVisible) {
                            newSelected.delete(jointName);
                          } else {
                            newSelected.add(jointName);
                          }
                          setSelectedJoints(newSelected);
                        }}
                      >
                        <div className="text-xs font-mono truncate leading-tight" style={{ color: displayColor }}>
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
              )}
            </div>
          </div>


          {/* Resize Handles - only show when not inline */}
          {!inline && ['se', 's', 'e', 'w', 'n', 'sw', 'ne', 'nw'].map((direction) => (
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
    </div>
  );

  if (inline) {
    return content;
  }

  return typeof window !== 'undefined' ? createPortal(content, document.body) : null;
};
