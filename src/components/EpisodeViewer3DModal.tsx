import React, { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
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
  Eye,
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
  isPlayingAll?: boolean;
  onPlayAllEpisodes?: (overrideFrame?: number) => void;
  onSetCurrentEpisodeIndex?: (index: number | null) => void;
  globalCurrentFrame?: number;
  onSetGlobalFrame?: (frame: number) => void;
}

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [selectedJoints, setSelectedJoints] = useState<Set<string>>(new Set());
  const [isMinimized, setIsMinimized] = useState(false);
  const [syncWith3DViewer, setSyncWith3DViewer] = useState(true);

  // Helper function to convert episode to animation frames
  const toAnimationFrames = (ep: Episode) =>
    ep.frames.map((frame) => ({
      timestamp: frame.timestamp,
      joints: frame.jointPositions,
    }));

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
  const isDraggingTimelineRef = useRef<boolean>(false);
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Listen to global frame updates from 3D viewer - only when playing
  useEffect(() => {
    if (!syncWith3DViewer || !open || !isPlayingAll) return;

    const handleFrameUpdate = (event: CustomEvent) => {
      const { frame, episodeIndex } = event.detail;

      // Only update if we're viewing the same episode that's playing AND it's actually playing
      if (episodeIndex === currentEpisodeIndex && isPlayingAll) {
        setCurrentFrame(frame);
      }
    };

    window.addEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);

    return () => {
      window.removeEventListener('viewer3d:frameUpdate' as any, handleFrameUpdate);
    };
  }, [syncWith3DViewer, open, currentEpisodeIndex, isPlayingAll]);

  // Sync local currentFrame with globalCurrentFrame when manually set (not playing)
  // This ensures the frame counter reflects the current position when paused
  useEffect(() => {
    // Only sync when NOT playing to prevent timeline from moving when paused
    if (!isPlayingAll && !isPlaying && globalCurrentFrame !== undefined && syncWith3DViewer) {
      setCurrentFrame(globalCurrentFrame);
    }
  }, [isPlayingAll, isPlaying, globalCurrentFrame, syncWith3DViewer]);

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

  // Handle timeline scrubbing (Blender-style) - supports both click and drag
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!episode || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const padding = 40;
    const graphWidth = rect.width - padding * 2;
    const x = e.clientX - rect.left;

    // Check if click is within the graph area
    if (x >= padding && x <= rect.width - padding && episode.frames.length > 0) {
      // Store initial mouse position to detect if it's a click vs drag
      dragStartPositionRef.current = { x: e.clientX, y: e.clientY };
      isDraggingTimelineRef.current = false; // Start as false, will be set to true on move

      const normalizedX = (x - padding) / graphWidth;
      const frameIndex = Math.max(0, Math.min(
        Math.round(normalizedX * (episode.frames.length - 1)),
        episode.frames.length - 1
      ));

      // Update frame immediately on click
      const displayFrame = frameIndex;

      // Only pause playback if it's currently playing (don't do anything if already paused)
      // isPlayingAll indicates global playback is active, so only pause if it's true
      if (isPlayingAll && onPlayAllEpisodes) {
        // onPlayAllEpisodes toggles playback - since isPlayingAll is true, this will pause it
        onPlayAllEpisodes();
      }
      
      // Stop local modal playback only if it's playing
      if (isPlaying) {
        setIsPlaying(false);
      }

      // Stop animation in 3D viewer only if global playback is active
      // We check isPlayingAll because that's the source of truth for global playback state
      if (isPlayingAll) {
        (window as any).viewer3dStopAnimation?.();
      }

      // Update global frame first (this updates parent's currentFrame state)
      if (onSetGlobalFrame) {
        onSetGlobalFrame(displayFrame);
      }

      // Set the current episode index so playback knows which episode to resume from
      if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
        onSetCurrentEpisodeIndex(currentEpisodeIndex);
      } else if (currentEpisodeIndex === null && allEpisodes.length > 0) {
        // If no episode index is set, find the episode in allEpisodes and set it
        const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
        if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
          onSetCurrentEpisodeIndex(episodeIndex);
        }
      }

      // Set the frame directly (don't use viewer3dPlayEpisode as it auto-starts playback)
      // The frames should already be loaded from when the episode viewer was opened
      if (episode) {
        (window as any).viewer3dSetFrame?.(displayFrame);
      }

      // Update local frame for display
      setCurrentFrame(displayFrame);
      // Playback will only resume if user explicitly clicks play
    }
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!episode || !canvasRef.current) return;
    
    // Only process if mouse button is down (dragStartPositionRef indicates mouse is down)
    if (!dragStartPositionRef.current) return;
    
    // Check if mouse has moved enough to consider it a drag (not just a click)
    const moveDistance = Math.sqrt(
      Math.pow(e.clientX - dragStartPositionRef.current.x, 2) +
      Math.pow(e.clientY - dragStartPositionRef.current.y, 2)
    );
    
    // If moved more than 3 pixels, consider it a drag
    if (moveDistance > 3) {
      isDraggingTimelineRef.current = true;
    }
    
    // Only update frame if we're actually dragging (moved more than threshold)
    if (!isDraggingTimelineRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const padding = 40;
    const graphWidth = rect.width - padding * 2;
    const x = e.clientX - rect.left;
    
    if (x >= padding && x <= rect.width - padding && episode.frames.length > 0) {
      const normalizedX = (x - padding) / graphWidth;
      const frameIndex = Math.max(0, Math.min(
        Math.round(normalizedX * (episode.frames.length - 1)),
        episode.frames.length - 1
      ));
      
      // Update frame while dragging
      const displayFrame = frameIndex;

      // Update global frame first
      if (onSetGlobalFrame) {
        onSetGlobalFrame(displayFrame);
      }

      // Set frame directly in 3D viewer (don't call PlayEpisode as it auto-starts playback)
      (window as any).viewer3dSetFrame?.(displayFrame);

      // Update local frame for display
      setCurrentFrame(displayFrame);
      // Note: Playback is already stopped on mouse down
    }
  };

  const handleTimelineMouseUp = () => {
    // If we never started dragging, it was just a click - frame was already set in mouseDown
    isDraggingTimelineRef.current = false;
    dragStartPositionRef.current = null;
  };

  // Handle mouse leave to stop dragging
  const handleTimelineMouseLeave = () => {
    isDraggingTimelineRef.current = false;
    dragStartPositionRef.current = null;
  };

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

    // Draw grid lines and frame labels
    const totalFrames = episode.frames.length;
    const gridDivisions = Math.min(10, totalFrames); // Show up to 10 divisions
    
    for (let i = 0; i <= gridDivisions; i++) {
      const x = padding + (graphWidth * i) / gridDivisions;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      
      // Draw frame number labels
      if (totalFrames > 0) {
        const frameNumber = Math.round((i / gridDivisions) * (totalFrames - 1));
        ctx.fillStyle = "#71717a";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`F${frameNumber}`, x, height - padding + 15);
      }
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
    ctx.fillText("Frame", width / 2, height - 10);

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

      const displayFrame = globalCurrentFrame ?? currentFrame;
      const currentValue = episode.frames[displayFrame]?.jointPositions[jointName];
      if (currentValue !== undefined) {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "10px monospace";
        ctx.fillText(currentValue.toFixed(2), width - padding - 5, labelY + 10);
      }
    });

    if (episode.frames.length > 0) {
      const displayFrame = globalCurrentFrame ?? currentFrame;
      const x = padding + (graphWidth * displayFrame) / (episode.frames.length - 1);
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
      // Show frame number and calculated time based on frame duration
      const totalFrames = episode.frames.length;
      const totalDuration = episode.frames.length > 0 
        ? episode.frames[totalFrames - 1].timestamp - episode.frames[0].timestamp 
        : 0;
      // Get playback speed from viewer if synced, otherwise use local
      const effectiveSpeed = syncWith3DViewer 
        ? ((window as any).viewer3dGetPlaybackSpeed?.() ?? 1.0)
        : playbackSpeed;
      // Calculate frame duration: total duration / (frames - 1) / playback speed
      const frameDuration = totalFrames > 1 
        ? (totalDuration / (totalFrames - 1)) / effectiveSpeed
        : 0;
      const calculatedTime = displayFrame * frameDuration;
      ctx.fillText(`F${displayFrame} (${(calculatedTime / 1000).toFixed(2)}s)`, x, padding - 10);
    }
  }, [episode, currentFrame, globalCurrentFrame, selectedJoints, jointNames, jointRanges, isMinimized, size, syncWith3DViewer, playbackSpeed]);

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

      {/* Content - Hidden when minimized */}
      {!isMinimized && (
        <>
          {/* Graph Canvas */}
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

          {/* Controls Panel */}
          <div className="p-3 bg-muted/30 space-y-3 border-t border-border">
            {/* Sync Status */}
            {syncWith3DViewer && (
              <div className="text-xs text-center text-muted-foreground bg-primary/10 border border-primary/30 rounded px-2 py-1">
                <Link className="w-3 h-3 inline mr-1" />
                Synced with 3D Viewer - Controls work globally
              </div>
            )}

            {/* Playback Controls - Same as Global Controls */}
            <div className="flex items-center justify-center gap-1">
              {/* First Frame */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (allEpisodes.length === 0 || !episode) return;
                      const activeIndex = currentEpisodeIndex ?? 0;
                      const activeEpisode = allEpisodes[activeIndex];
                      if (activeEpisode && activeEpisode.frames.length > 0) {
                        (window as any).viewer3dStopAnimation?.();
                        (window as any).viewer3dPlayAnimation?.(false);
                        const frames = toAnimationFrames(activeEpisode);
                        (window as any).viewer3dPlayEpisode?.(frames);
                        (window as any).viewer3dSetFrame?.(0);
                        onSetCurrentEpisodeIndex?.(activeIndex);
                        onSetGlobalFrame?.(0);
                      }
                    }}
                    disabled={allEpisodes.length === 0 || !episode}
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>First frame</p></TooltipContent>
              </Tooltip>

              {/* Previous Episode */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (allEpisodes.length === 0) return;
                      const currentIndex = currentEpisodeIndex ?? 0;
                      const prevIndex = currentIndex > 0 ? currentIndex - 1 : allEpisodes.length - 1;
                      const prevEpisode = allEpisodes[prevIndex];
                      if (prevEpisode && prevEpisode.frames.length > 0) {
                        (window as any).viewer3dStopAnimation?.();
                        (window as any).viewer3dPlayAnimation?.(false);
                        const frames = toAnimationFrames(prevEpisode);
                        (window as any).viewer3dPlayEpisode?.(frames);
                        (window as any).viewer3dSetFrame?.(0);
                        onSetCurrentEpisodeIndex?.(prevIndex);
                        onSetGlobalFrame?.(0);
                      }
                    }}
                    disabled={allEpisodes.length === 0}
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Previous episode</p></TooltipContent>
              </Tooltip>

              {/* Previous Frame */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (allEpisodes.length === 0 || !episode) return;
                      const activeIndex = currentEpisodeIndex ?? 0;
                      const activeEpisode = allEpisodes[activeIndex];
                      if (!activeEpisode || activeEpisode.frames.length === 0) return;
                      const frames = toAnimationFrames(activeEpisode);
                      (window as any).viewer3dPlayEpisode?.(frames);
                      const currentFrameValue = globalCurrentFrame ?? currentFrame;
                      const newFrame = Math.max(0, currentFrameValue - 1);
                      (window as any).viewer3dSetFrame?.(newFrame);
                      (window as any).viewer3dStopAnimation?.();
                      (window as any).viewer3dPlayAnimation?.(false);
                      onSetCurrentEpisodeIndex?.(activeIndex);
                      onSetGlobalFrame?.(newFrame);
                    }}
                    disabled={allEpisodes.length === 0 || !episode || (globalCurrentFrame ?? currentFrame) === 0}
                  >
                    <StepBack className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Previous frame</p></TooltipContent>
              </Tooltip>

              {/* Play/Pause All Episodes */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={isPlayingAll ? "default" : "ghost"}
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (onPlayAllEpisodes) {
                        // Get the current frame from the timeline position
                        const currentFrameValue = globalCurrentFrame ?? currentFrame;
                        
                        // Ensure the current episode index is set so playback knows which episode to play
                        if (episode) {
                          if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
                            onSetCurrentEpisodeIndex(currentEpisodeIndex);
                          } else if (currentEpisodeIndex === null && allEpisodes.length > 0) {
                            const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
                            if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
                              onSetCurrentEpisodeIndex(episodeIndex);
                            }
                          }
                          
                          // Update the global frame state for consistency
                          if (onSetGlobalFrame) {
                            onSetGlobalFrame(currentFrameValue);
                          }
                        }
                        
                        // Start playback from the timeline position by passing the frame directly
                        // This prevents the jump to frame 0 that happens when the episode is reloaded
                        onPlayAllEpisodes(currentFrameValue);
                      }
                    }}
                    disabled={allEpisodes.length === 0}
                  >
                    {isPlayingAll ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{isPlayingAll ? "Pause" : "Play all episodes"}</p></TooltipContent>
              </Tooltip>

              {/* Next Frame */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (allEpisodes.length === 0 || !episode) return;
                      const activeIndex = currentEpisodeIndex ?? 0;
                      const activeEpisode = allEpisodes[activeIndex];
                      if (!activeEpisode || activeEpisode.frames.length === 0) return;
                      const frames = toAnimationFrames(activeEpisode);
                      (window as any).viewer3dPlayEpisode?.(frames);
                      const currentFrameValue = globalCurrentFrame ?? currentFrame;
                      const maxFrame = activeEpisode.frames.length - 1;
                      const newFrame = Math.min(maxFrame, currentFrameValue + 1);
                      (window as any).viewer3dSetFrame?.(newFrame);
                      (window as any).viewer3dStopAnimation?.();
                      (window as any).viewer3dPlayAnimation?.(false);
                      onSetCurrentEpisodeIndex?.(activeIndex);
                      onSetGlobalFrame?.(newFrame);
                    }}
                    disabled={allEpisodes.length === 0 || !episode || (globalCurrentFrame ?? currentFrame) >= (episode?.frames.length ?? 0) - 1}
                  >
                    <StepForward className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Next frame</p></TooltipContent>
              </Tooltip>

              {/* Next Episode */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (allEpisodes.length === 0) return;
                      const currentIndex = currentEpisodeIndex ?? 0;
                      const nextIndex = (currentIndex + 1) % allEpisodes.length;
                      const nextEpisode = allEpisodes[nextIndex];
                      if (nextEpisode && nextEpisode.frames.length > 0) {
                        (window as any).viewer3dStopAnimation?.();
                        (window as any).viewer3dPlayAnimation?.(false);
                        const frames = toAnimationFrames(nextEpisode);
                        (window as any).viewer3dPlayEpisode?.(frames);
                        (window as any).viewer3dSetFrame?.(0);
                        onSetCurrentEpisodeIndex?.(nextIndex);
                        onSetGlobalFrame?.(0);
                      }
                    }}
                    disabled={allEpisodes.length === 0}
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Next episode</p></TooltipContent>
              </Tooltip>

              {/* Last Frame */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (allEpisodes.length === 0 || !episode) return;
                      const activeIndex = currentEpisodeIndex ?? 0;
                      const activeEpisode = allEpisodes[activeIndex];
                      if (activeEpisode && activeEpisode.frames.length > 0) {
                        (window as any).viewer3dStopAnimation?.();
                        (window as any).viewer3dPlayAnimation?.(false);
                        const frames = toAnimationFrames(activeEpisode);
                        (window as any).viewer3dPlayEpisode?.(frames);
                        (window as any).viewer3dSetFrame?.(activeEpisode.frames.length - 1);
                        onSetCurrentEpisodeIndex?.(activeIndex);
                        onSetGlobalFrame?.(activeEpisode.frames.length - 1);
                      }
                    }}
                    disabled={allEpisodes.length === 0 || !episode}
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Last frame</p></TooltipContent>
              </Tooltip>

              <div className="flex items-center gap-1 ml-2 px-2 py-1 bg-background rounded border text-xs">
                <span className="text-muted-foreground">Frame:</span>
                <span className="font-mono font-medium">
                  {totalFrames > 0 ? (globalCurrentFrame ?? currentFrame) + 1 : 0}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="font-mono text-muted-foreground">{totalFrames}</span>
              </div>

              <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs">
                <span className="text-muted-foreground">Time:</span>
                <span className="font-mono font-medium">
                  {totalFrames > 0 && episode ? (() => {
                    const currentFrameValue = globalCurrentFrame ?? currentFrame;
                    const totalDuration = episode.frames[totalFrames - 1].timestamp - episode.frames[0].timestamp;
                    // Get playback speed from viewer if synced, otherwise use local
                    const effectiveSpeed = syncWith3DViewer 
                      ? ((window as any).viewer3dGetPlaybackSpeed?.() ?? 1.0)
                      : playbackSpeed;
                    // Calculate frame duration: total duration / (frames - 1) / playback speed
                    const frameDuration = totalFrames > 1 
                      ? (totalDuration / (totalFrames - 1)) / effectiveSpeed
                      : 0;
                    const calculatedTime = currentFrameValue * frameDuration;
                    return `${(calculatedTime / 1000).toFixed(2)}s`;
                  })() : "0.00s"}
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
