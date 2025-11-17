import React, { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Square,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  ChevronsLeft,
  ChevronsRight,
  X,
  Minimize2,
  Maximize2,
  GripHorizontal,
  Link,
  Unlink,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
}

export const EpisodeViewer3DModal: React.FC<EpisodeViewer3DModalProps> = ({
  episode,
  open,
  onOpenChange,
  currentEpisodeIndex,
  allEpisodes = [],
}) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [selectedJoints, setSelectedJoints] = useState<Set<string>>(new Set());
  const [isMinimized, setIsMinimized] = useState(false);
  const [syncWith3DViewer, setSyncWith3DViewer] = useState(true);

  // Window position and size
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 800, height: 600 });

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Resizing state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const lastFrameTimeRef = useRef<number>(0);

  // Listen to global frame updates from 3D viewer
  useEffect(() => {
    if (!syncWith3DViewer || !open) return;

    const handleFrameUpdate = (event: CustomEvent) => {
      const { frame, episodeIndex } = event.detail;

      // Only update if we're viewing the same episode that's playing
      if (episodeIndex === currentEpisodeIndex) {
        setCurrentFrame(frame);
      }
    };

    window.addEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);

    return () => {
      window.removeEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);
    };
  }, [syncWith3DViewer, open, currentEpisodeIndex]);

  // Reset state when episode changes
  useEffect(() => {
    setCurrentFrame(0);
    setIsPlaying(false);
    if (episode) {
      const allJoints = new Set(Object.keys(episode.frames[0]?.jointPositions || {}));
      setSelectedJoints(allJoints);
    }
  }, [episode?.id]);

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

  // Playback animation loop
  useEffect(() => {
    if (!isPlaying || !episode || episode.frames.length === 0) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp;
      }

      const deltaTime = timestamp - lastFrameTimeRef.current;
      const frameTime = episode.frames.length > 1
        ? (episode.frames[1].timestamp - episode.frames[0].timestamp) / playbackSpeed
        : 33.33;

      if (deltaTime >= frameTime) {
        setCurrentFrame((prev) => {
          const next = prev + 1;
          if (next >= episode.frames.length) {
            setIsPlaying(false);
            return prev;
          }
          return next;
        });
        lastFrameTimeRef.current = timestamp;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, episode, playbackSpeed]);

  // Draw graphs on canvas
  useEffect(() => {
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
    const padding = 40;
    const graphHeight = height - padding * 2;
    const graphWidth = width - padding * 2;

    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
      const x = padding + (graphWidth * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
    }

    for (let i = 0; i <= 5; i++) {
      const y = padding + (graphHeight * i) / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#52525b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Time", width / 2, height - 10);

    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Joint Position", 0, 0);
    ctx.restore();

    const colors = [
      "#ec4899", "#eab308", "#22c55e", "#3b82f6",
      "#a855f7", "#f97316", "#06b6d4", "#ef4444",
    ];

    const selectedJointNames = jointNames.filter((name) => selectedJoints.has(name));

    selectedJointNames.forEach((jointName, index) => {
      const color = colors[index % colors.length];
      const range = jointRanges[jointName];

      const rangePadding = (range.max - range.min) * 0.1 || 0.1;
      const minVal = range.min - rangePadding;
      const maxVal = range.max + rangePadding;
      const valueRange = maxVal - minVal;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      episode.frames.forEach((frame, frameIndex) => {
        const value = frame.jointPositions[jointName];
        const x = padding + (graphWidth * frameIndex) / (episode.frames.length - 1);
        const normalizedValue = (value - minVal) / valueRange;
        const y = height - padding - graphHeight * normalizedValue;

        if (frameIndex === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "12px monospace";
      ctx.textAlign = "right";
      const labelY = padding + 15 + index * 20;
      ctx.fillText(jointName, width - padding - 5, labelY);

      const currentValue = episode.frames[currentFrame]?.jointPositions[jointName];
      if (currentValue !== undefined) {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "10px monospace";
        ctx.fillText(currentValue.toFixed(2), width - padding - 5, labelY + 10);
      }
    });

    if (episode.frames.length > 0) {
      const x = padding + (graphWidth * currentFrame) / (episode.frames.length - 1);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ffffff";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      const timeSeconds = (episode.frames[currentFrame].timestamp / 1000).toFixed(2);
      ctx.fillText(`${timeSeconds}s`, x, padding - 10);
    }
  }, [episode, currentFrame, selectedJoints, jointNames, jointRanges, isMinimized, size]);

  // Mouse event handlers for dragging
  const handleMouseDownHeader = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('drag-handle')) {
      return;
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  // Mouse event handlers for resizing
  const handleMouseDownResize = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
  };

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
          newWidth = Math.max(400, resizeStart.width + deltaX);
        }
        if (resizeDirection.includes('s')) {
          newHeight = Math.max(300, resizeStart.height + deltaY);
        }
        if (resizeDirection.includes('w')) {
          const width = Math.max(400, resizeStart.width - deltaX);
          if (width > 400) {
            newWidth = width;
            newX = position.x + deltaX;
          }
        }
        if (resizeDirection.includes('n')) {
          const height = Math.max(300, resizeStart.height - deltaY);
          if (height > 300) {
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

  return (
    <div
      ref={containerRef}
      className="fixed bg-background border-2 border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '300px' : `${size.width}px`,
        height: isMinimized ? 'auto' : `${size.height}px`,
        zIndex: 9999,
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Header - Draggable */}
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
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Close</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content - Hidden when minimized */}
      {!isMinimized && (
        <>
          {/* Graph Canvas */}
          <div className="flex-1 relative bg-background overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              style={{ background: "#09090b" }}
            />
          </div>

          {/* Controls Panel */}
          <div className="p-3 bg-muted/30 space-y-3 border-t border-border">
            {/* Sync Status */}
            {syncWith3DViewer && (
              <div className="text-xs text-center text-muted-foreground bg-primary/10 border border-primary/30 rounded px-2 py-1">
                <Link className="w-3 h-3 inline mr-1" />
                Synced with 3D Viewer - Use main playback controls
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
                    onClick={() => {
                      setCurrentFrame(0);
                      setIsPlaying(false);
                    }}
                    disabled={totalFrames === 0 || syncWith3DViewer}
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>First frame</p></TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      setCurrentFrame((prev) => Math.max(0, prev - 1));
                      setIsPlaying(false);
                    }}
                    disabled={currentFrame === 0 || syncWith3DViewer}
                  >
                    <StepBack className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Previous frame</p></TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={isPlaying ? "default" : "ghost"}
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (currentFrame >= totalFrames - 1) {
                        setCurrentFrame(0);
                      }
                      setIsPlaying(!isPlaying);
                      lastFrameTimeRef.current = 0;
                    }}
                    disabled={totalFrames === 0 || syncWith3DViewer}
                  >
                    {isPlaying ? (
                      <Square className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{isPlaying ? "Pause" : "Play"}</p></TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      setCurrentFrame((prev) => Math.min(totalFrames - 1, prev + 1));
                      setIsPlaying(false);
                    }}
                    disabled={currentFrame >= totalFrames - 1 || syncWith3DViewer}
                  >
                    <StepForward className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Next frame</p></TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      setCurrentFrame(totalFrames - 1);
                      setIsPlaying(false);
                    }}
                    disabled={totalFrames === 0 || syncWith3DViewer}
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Last frame</p></TooltipContent>
              </Tooltip>

              <div className="flex items-center gap-1 ml-2 px-2 py-1 bg-background rounded border text-xs">
                <span className="text-muted-foreground">Frame:</span>
                <span className="font-mono font-medium">
                  {totalFrames > 0 ? currentFrame + 1 : 0}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="font-mono text-muted-foreground">{totalFrames}</span>
              </div>

              <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs">
                <span className="text-muted-foreground">Time:</span>
                <span className="font-mono font-medium">
                  {totalFrames > 0
                    ? (episode.frames[currentFrame].timestamp / 1000).toFixed(2)
                    : "0.00"}s
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
                  const colors = [
                    "#ec4899", "#eab308", "#22c55e", "#3b82f6",
                    "#a855f7", "#f97316", "#06b6d4", "#ef4444",
                  ];
                  const color = colors[index % colors.length];
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
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'se')}
            style={{ background: 'transparent' }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-1 cursor-s-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 's')}
          />
          <div
            className="absolute top-0 bottom-0 right-0 w-1 cursor-e-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'e')}
          />
          <div
            className="absolute top-0 bottom-0 left-0 w-1 cursor-w-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'w')}
          />
          <div
            className="absolute top-0 left-0 right-0 h-1 cursor-n-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'n')}
          />
          <div
            className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'sw')}
          />
          <div
            className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'ne')}
          />
          <div
            className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize"
            onMouseDown={(e) => handleMouseDownResize(e, 'nw')}
          />
        </>
      )}
    </div>
  );
};
