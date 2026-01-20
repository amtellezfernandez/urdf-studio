import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import {
  GripHorizontal,
  Eye,
  Pencil,
  X,
  Save,
  Sparkles,
  Undo2,
  Redo2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { NumberInput } from "@/shared/ui/number-input";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { toAnimationFrames, type Episode, type RecordedFrame } from "@/features/dataset";

// Constants
const CANVAS_PADDING = 40;
const MIN_WINDOW_WIDTH = 400;
const MIN_WINDOW_HEIGHT = 300;
const DRAG_THRESHOLD = 3;
const TIMELINE_HEADER_HEIGHT = 60; // Height of the top area where dragging is allowed (FRAME/SECS area)
const JOINT_COLORS = [
  "#ec4899", "#eab308", "#22c55e", "#3b82f6",
  "#a855f7", "#f97316", "#06b6d4", "#ef4444",
] as const;

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
  showOnlyHeader?: boolean; // If true, only show the header (for collapsed view)
  onSaveEpisode?: (episode: Episode, saveAsNew: boolean, newName?: string) => void; // Callback to save/update episode
}

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

// Helper to update frame in 3D viewer (for timeline scrubbing)
// This does NOT reload the episode, just sets the frame and ensures playback is stopped
// NOTE: We only call viewer3dStopAnimation, NOT viewer3dPlayAnimation(false)
// because the parent's onSetGlobalFrame will call stopAllPlayback() which clears frames,
// and calling viewer3dPlayAnimation with cleared frames would trigger "upload data first" error
  const updateViewerFrame = (frame: number) => {
    viewerPlayback.setFrame(frame);
    viewerPlayback.stopAnimation();
  };

  const computeEpisodeFps = (candidate?: Episode | null) => {
    if (!candidate || candidate.frames.length < 2) return 0;
    const metaFps = candidate.metadata?.fps;
    if (Number.isFinite(metaFps) && metaFps > 0) {
      return metaFps;
    }
    const durationMs =
      candidate.frames[candidate.frames.length - 1].timestamp - candidate.frames[0].timestamp;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
    return (candidate.frames.length - 1) / (durationMs / 1000);
  };

// Simple moving-average smoother for joint trajectories
const smoothSeries = (values: number[], windowSize = 5, passes = 2) => {
  if (values.length < 3) return values.slice();
  const size = Math.max(3, windowSize | 1); // ensure odd window
  const radius = Math.floor(size / 2);
  let current = values.slice();

  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((value, idx) => {
      // Keep endpoints untouched to preserve start/end poses
      if (idx === 0 || idx === current.length - 1) return values[idx];

      let sum = 0;
      let weightSum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const target = idx + offset;
        if (target < 0 || target >= current.length) continue;
        const weight = offset === 0 ? 2 : 1;
        sum += current[target] * weight;
        weightSum += weight;
      }
      return weightSum > 0 ? sum / weightSum : value;
    });
    current = next;
  }

  return current;
};

// Helper to smooth curve around a point using Catmull-Rom spline
const smoothCurveAroundPoint = (
  values: number[],
  pointIndex: number,
  newValue: number,
  influenceRadius: number = 3
): number[] => {
  const result = [...values];
  result[pointIndex] = newValue;
  
  // Apply smoothing to nearby points
  const start = Math.max(0, pointIndex - influenceRadius);
  const end = Math.min(values.length - 1, pointIndex + influenceRadius);
  
  for (let i = start; i <= end; i++) {
    if (i === pointIndex) continue;
    
    const distance = Math.abs(i - pointIndex);
    const influence = 1 - (distance / influenceRadius);
    
    if (influence > 0) {
      // Interpolate between original and new value based on distance
      const original = values[i];
      const target = newValue;
      result[i] = original + (target - original) * influence * 0.3; // 0.3 is smoothing factor
    }
  }
  
  return result;
};

// Bezier curve interpolation helper
const bezierInterpolate = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  
  return uuu * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + ttt * p3;
};

// Apply Bezier curve interpolation using tangent handles
// Handles control the curve shape through their position and length
const applyBezierCurve = (
  values: number[],
  pointIndex: number,
  leftHandle: {x: number, y: number, value: number, length: number} | null,
  rightHandle: {x: number, y: number, value: number, length: number} | null,
  frames: RecordedFrame[],
  jointName: string,
  pointX: number, // Screen X position of the main point
  canvasWidth: number,
  canvasHeight: number,
  minVal: number,
  maxVal: number
): number[] => {
  const result = [...values];
  
  if (leftHandle === null && rightHandle === null) {
    return result; // No handles, return unchanged
  }
  
  const currentValue = values[pointIndex];
  
  // Determine influence range based on handle length
  // Longer handles affect more points
  const leftInfluence = leftHandle ? Math.max(3, Math.floor(leftHandle.length / 10)) : 3;
  const rightInfluence = rightHandle ? Math.max(3, Math.floor(rightHandle.length / 10)) : 3;
  
  const start = Math.max(0, pointIndex - leftInfluence);
  const end = Math.min(values.length - 1, pointIndex + rightInfluence);
  
  // Get neighboring anchor points
  const prevAnchorIndex = Math.max(0, pointIndex - leftInfluence);
  const nextAnchorIndex = Math.min(values.length - 1, pointIndex + rightInfluence);
  const prevAnchorValue = values[prevAnchorIndex];
  const nextAnchorValue = values[nextAnchorIndex];
  
  // Calculate handle strength based on length (longer = stronger influence)
  const leftStrength = leftHandle ? Math.min(1.0, leftHandle.length / 50) : 0;
  const rightStrength = rightHandle ? Math.min(1.0, rightHandle.length / 50) : 0;
  
  // Apply Bezier interpolation
  for (let i = start; i <= end; i++) {
    if (i === pointIndex) {
      result[i] = currentValue; // Keep the main point value unchanged
      continue;
    }
    
    // Calculate normalized position (0 to 1) relative to the selected point
    let t: number;
    if (i < pointIndex) {
      // Before the point - use left handle
      if (leftHandle && leftStrength > 0) {
        const segmentLength = pointIndex - prevAnchorIndex;
        t = segmentLength > 0 ? (i - prevAnchorIndex) / segmentLength : 0;
        t = Math.max(0, Math.min(1, t));
        
        // Calculate the control point value based on handle
        // The handle's value represents the tangent direction
        const handleInfluence = leftStrength;
        const controlValue = currentValue + (leftHandle.value - currentValue) * handleInfluence;
        
        // Bezier curve: prevAnchor -> controlValue -> currentPoint
        result[i] = bezierInterpolate(
          prevAnchorValue,
          controlValue,
          currentValue,
          currentValue,
          t
        );
      }
    } else {
      // After the point - use right handle
      if (rightHandle && rightStrength > 0) {
        const segmentLength = nextAnchorIndex - pointIndex;
        t = segmentLength > 0 ? (i - pointIndex) / segmentLength : 0;
        t = Math.max(0, Math.min(1, t));
        
        // Calculate the control point value based on handle
        const handleInfluence = rightStrength;
        const controlValue = currentValue + (rightHandle.value - currentValue) * handleInfluence;
        
        // Bezier curve: currentPoint -> controlValue -> nextAnchor
        result[i] = bezierInterpolate(
          currentValue,
          controlValue,
          nextAnchorValue,
          nextAnchorValue,
          t
        );
      }
    }
  }
  
  return result;
};

// Helper to find closest point on a curve
const findClosestPointOnCurve = (
  mouseX: number,
  mouseY: number,
  frames: RecordedFrame[],
  jointName: string,
  jointRange: { min: number; max: number },
  canvasWidth: number,
  canvasHeight: number
): number | null => {
  const graphWidth = canvasWidth - CANVAS_PADDING * 2;
  const graphHeight = canvasHeight - CANVAS_PADDING * 2;
  const rangePadding = (jointRange.max - jointRange.min) * 0.1 || 0.1;
  const minVal = jointRange.min - rangePadding;
  const maxVal = jointRange.max + rangePadding;
  const valueRange = maxVal - minVal;
  
  let closestIndex: number | null = null;
  let minDistance = Infinity;
  const POINT_SELECTION_RADIUS = 8; // pixels
  
  frames.forEach((frame, frameIndex) => {
    const value = frame.jointPositions[jointName];
    const x = CANVAS_PADDING + (graphWidth * frameIndex) / (frames.length - 1);
    const normalizedValue = (value - minVal) / valueRange;
    const y = canvasHeight - CANVAS_PADDING - graphHeight * normalizedValue;
    
    const distance = Math.sqrt(
      Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2)
    );
    
    if (distance < POINT_SELECTION_RADIUS && distance < minDistance) {
      minDistance = distance;
      closestIndex = frameIndex;
    }
  });
  
  return closestIndex;
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
  showOnlyHeader = false,
  onSaveEpisode,
}) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const playbackSpeed = useViewerPlaybackStore((state) => state.playbackSpeed);
  const [selectedJoints, setSelectedJoints] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  
  // Edit mode states
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingJoint, setEditingJoint] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);
  const [modifiedEpisode, setModifiedEpisode] = useState<Episode | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [newEpisodeName, setNewEpisodeName] = useState("");
  const [showExitConfirmDialog, setShowExitConfirmDialog] = useState(false);
  const [trimRange, setTrimRange] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });
  const [retimeScale, setRetimeScale] = useState(1);
  const [retimeFps, setRetimeFps] = useState(0);

  // Undo/Redo system (Blender-like)
  const [editHistory, setEditHistory] = useState<Episode[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [lastSaveChoice, setLastSaveChoice] = useState<'overwrite' | 'new' | null>(null);
  
  // Tangent handles state: Map<pointIndex, {left: {x, y, value, length}, right: {x, y, value, length}}>
  // x, y are screen coordinates, value is the joint value at that handle position, length is distance from point
  const [tangentHandles, setTangentHandles] = useState<Map<number, {
    left: {x: number, y: number, value: number, length: number}, 
    right: {x: number, y: number, value: number, length: number}
  }>>(new Map());
  const [draggingHandle, setDraggingHandle] = useState<{pointIndex: number, side: 'left' | 'right'} | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingTimelineRef = useRef<boolean>(false);
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
  const preservedFrameRef = useRef<number | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  
  // Handle canvas hover to change cursor
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    
    // Change cursor to pointer only when hovering over the top header area
    if (y <= TIMELINE_HEADER_HEIGHT && x >= CANVAS_PADDING && x <= rect.width - CANVAS_PADDING) {
      canvasRef.current.style.cursor = 'pointer';
    } else {
      canvasRef.current.style.cursor = 'default';
    }
  }, []);

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

  const activeFps = useMemo(() => {
    const target = isEditMode && modifiedEpisode ? modifiedEpisode : episode;
    return computeEpisodeFps(target);
  }, [episode, modifiedEpisode, isEditMode]);

  useEffect(() => {
    if (activeFps <= 0) return;
    setRetimeFps((prev) => {
      const next = Number(activeFps.toFixed(2));
      return Math.abs(prev - next) < 1e-3 ? prev : next;
    });
  }, [activeFps]);

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

    window.addEventListener('viewer3d:frameUpdate', handleFrameUpdate);
    return () => {
      window.removeEventListener('viewer3d:frameUpdate', handleFrameUpdate);
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

  // Helper to check if episode has been modified
  const hasChanges = useMemo(() => {
    if (!episode || !modifiedEpisode) return false;
    if (episode.frames.length !== modifiedEpisode.frames.length) return true;
    
    for (let i = 0; i < episode.frames.length; i++) {
      const original = episode.frames[i];
      const modified = modifiedEpisode.frames[i];
      if (Math.abs(original.timestamp - modified.timestamp) > 0.5) {
        return true;
      }
      const originalJoints = Object.keys(original.jointPositions);
      const modifiedJoints = Object.keys(modified.jointPositions);
      
      if (originalJoints.length !== modifiedJoints.length) return true;
      
      for (const jointName of originalJoints) {
        if (Math.abs(original.jointPositions[jointName] - modified.jointPositions[jointName]) > 0.0001) {
          return true;
        }
      }
    }
    
    return false;
  }, [episode, modifiedEpisode]);

  // Reset state when episode changes
  useEffect(() => {
    setCurrentFrame(0);
    preservedFrameRef.current = 0;
    if (episode) {
      const allJoints = new Set(Object.keys(episode.frames[0]?.jointPositions || {}));
      setSelectedJoints(allJoints);
      // Initialize modified episode copy for editing
      const initialEpisode = {
        ...episode,
        frames: episode.frames.map(f => ({
          ...f,
          jointPositions: { ...f.jointPositions }
        }))
      };
      setModifiedEpisode(initialEpisode);
      // Initialize undo/redo history
      setEditHistory([initialEpisode]);
      setHistoryIndex(0);
    }
    // Reset edit mode when episode changes
    setIsEditMode(false);
    setEditingJoint(null);
    setSelectedPointIndex(null);
    setTangentHandles(new Map());
    setTrimRange({ start: null, end: null });
    setShowSaveDialog(false);
    setSaveAsNew(false);
    setNewEpisodeName("");
    setShowExitConfirmDialog(false);
    setLastSaveChoice(null);
  }, [episode]);

  // Listen for joint visibility toggles from joint list sidebar
  useEffect(() => {
    const handleJointVisibilityToggle = (event: Event) => {
      const customEvent = event as CustomEvent<{ jointName: string; isVisible: boolean }>;
      const { jointName, isVisible } = customEvent.detail;
      setSelectedJoints(prev => {
        const newSelected = new Set(prev);
        if (isVisible) {
          newSelected.add(jointName);
        } else {
          newSelected.delete(jointName);
        }
        // Dispatch event back to sync with joint list
        const syncEvent = new CustomEvent('episodeViewer:jointVisibilityChange', {
          detail: { jointName, isVisible }
        });
        window.dispatchEvent(syncEvent);
        return newSelected;
      });
    };

    window.addEventListener('jointVisibilityToggle', handleJointVisibilityToggle);
    return () => {
      window.removeEventListener('jointVisibilityToggle', handleJointVisibilityToggle);
    };
  }, []);

  // Dispatch visibility changes when selectedJoints changes
  // Use a ref to track previous state and only dispatch for changed joints
  const prevSelectedJointsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!episode) return;
    const jointNames = Object.keys(episode.frames[0]?.jointPositions || {});
    const prev = prevSelectedJointsRef.current;
    
    jointNames.forEach(jointName => {
      const wasVisible = prev.has(jointName);
      const isVisible = selectedJoints.has(jointName);
      // Only dispatch if visibility actually changed
      if (wasVisible !== isVisible) {
        const syncEvent = new CustomEvent('episodeViewer:jointVisibilityChange', {
          detail: { jointName, isVisible }
        });
        window.dispatchEvent(syncEvent);
      }
    });
    
    // Update ref for next comparison
    prevSelectedJointsRef.current = new Set(selectedJoints);
  }, [selectedJoints, episode]);

  // Initialize preserved frame on mount
  useEffect(() => {
    if (preservedFrameRef.current === null) {
      preservedFrameRef.current = globalCurrentFrame ?? currentFrame ?? 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to push a new state to edit history (for undo/redo)
  const pushToHistory = useCallback((newEpisode: Episode) => {
    setEditHistory(prev => {
      // Remove any future history if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1);
      // Add new state
      newHistory.push(newEpisode);
      // Limit history to 50 states to prevent memory issues
      if (newHistory.length > 50) {
        newHistory.shift();
        setHistoryIndex(prev => prev); // Don't change index since we removed from start
        return newHistory;
      }
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [historyIndex]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (historyIndex > 0 && editHistory.length > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setModifiedEpisode(editHistory[newIndex]);
      toast.info("Undo");
    }
  }, [historyIndex, editHistory]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (historyIndex < editHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setModifiedEpisode(editHistory[newIndex]);
      toast.info("Redo");
    }
  }, [historyIndex, editHistory]);

  const handleSmoothTrajectory = useCallback(() => {
    if (!isEditMode || !editingJoint || !modifiedEpisode) {
      toast.error("Enter edit mode and pick a joint to smooth");
      return;
    }

    const values = modifiedEpisode.frames.map(
      (frame) => frame.jointPositions[editingJoint] ?? 0
    );

    // Adaptive odd window: 3–9 samples depending on episode length
    const adaptiveWindow = Math.min(
      9,
      Math.max(3, Math.floor(values.length / 20) * 2 + 1)
    );
    const smoothed = smoothSeries(values, adaptiveWindow, 2);

    const newFrames = modifiedEpisode.frames.map((frame, idx) => ({
      ...frame,
      jointPositions: {
        ...frame.jointPositions,
        [editingJoint]: smoothed[idx],
      },
    }));

    const newEpisode = { ...modifiedEpisode, frames: newFrames };
    setModifiedEpisode(newEpisode);
    pushToHistory(newEpisode);
    setSelectedPointIndex(null);
    setDraggingHandle(null);
    setTangentHandles(new Map());
    toast.success(`Smoothed ${editingJoint} trajectory`);
  }, [isEditMode, editingJoint, modifiedEpisode, pushToHistory]);

  const getResolvedTrimRange = useCallback(
    (frameCount: number) => {
      if (trimRange.start === null || trimRange.end === null || frameCount <= 0) return null;
      const maxIndex = Math.max(0, frameCount - 1);
      const rawStart = Math.max(0, Math.min(trimRange.start, maxIndex));
      const rawEnd = Math.max(0, Math.min(trimRange.end, maxIndex));
      return {
        start: Math.min(rawStart, rawEnd),
        end: Math.max(rawStart, rawEnd),
      };
    },
    [trimRange]
  );

  const resolveCurrentFrame = useCallback(
    () => getCurrentFrameValue(preservedFrameRef.current, globalCurrentFrame, currentFrame),
    [globalCurrentFrame, currentFrame]
  );

  const handleSetTrimPoint = useCallback(
    (edge: "start" | "end") => {
      const frame = resolveCurrentFrame();
      setTrimRange((prev) => ({ ...prev, [edge]: frame }));
      toast.info(edge === "start" ? `Set In at F${frame}` : `Set Out at F${frame}`);
    },
    [resolveCurrentFrame]
  );

  const handleClearTrimRange = useCallback(() => {
    setTrimRange({ start: null, end: null });
    toast.info("Cleared range");
  }, []);

  const handleTrimToRange = useCallback(() => {
    if (!isEditMode || !modifiedEpisode) return;
    const resolved = getResolvedTrimRange(modifiedEpisode.frames.length);
    if (!resolved) {
      toast.error("Set In and Out before trimming");
      return;
    }

    const { start, end } = resolved;
    const originalFrames = modifiedEpisode.frames;
    const startFrame = originalFrames[start];
    const endFrame = originalFrames[end];
    if (!startFrame || !endFrame) {
      toast.error("Invalid trim range");
      return;
    }

    const baseTimestamp = startFrame.timestamp;
    const nextFrames = originalFrames.slice(start, end + 1).map((frame) => ({
      timestamp: frame.timestamp - baseTimestamp,
      jointPositions: { ...frame.jointPositions },
    }));

    if (nextFrames.length === 0) {
      toast.error("Trim range produced no frames");
      return;
    }

    const nextEpisode: Episode = {
      ...modifiedEpisode,
      frames: nextFrames,
      metadata: modifiedEpisode.metadata
        ? {
            ...modifiedEpisode.metadata,
            num_frames: nextFrames.length,
            episode_length_sec:
              nextFrames[nextFrames.length - 1]?.timestamp !== undefined
                ? nextFrames[nextFrames.length - 1].timestamp / 1000
                : modifiedEpisode.metadata.episode_length_sec,
          }
        : undefined,
    };

    setModifiedEpisode(nextEpisode);
    pushToHistory(nextEpisode);
    setSelectedPointIndex(null);
    setDraggingHandle(null);
    setTangentHandles(new Map());
    setTrimRange({ start: null, end: null });
    setCurrentFrame(0);
    preservedFrameRef.current = 0;
    onSetGlobalFrame?.(0);
    toast.success("Trimmed range (all joints)");
  }, [isEditMode, modifiedEpisode, getResolvedTrimRange, pushToHistory, onSetGlobalFrame]);

  const handleTimeScale = useCallback(
    (scale: number) => {
      if (!isEditMode || !modifiedEpisode) return;
      if (!Number.isFinite(scale) || scale <= 0) {
        toast.error("Enter a valid scale");
        return;
      }
      if (Math.abs(scale - 1) < 1e-4) {
        toast.info("Scale is already 1x");
        return;
      }
      if (modifiedEpisode.frames.length < 2) {
        toast.error("Not enough frames to retime");
        return;
      }

      const resolved = getResolvedTrimRange(modifiedEpisode.frames.length);
      const startIndex = resolved?.start ?? 0;
      const endIndex = resolved?.end ?? modifiedEpisode.frames.length - 1;
      if (startIndex >= endIndex) {
        toast.error("Select a valid range to retime");
        return;
      }

      const baseTime = modifiedEpisode.frames[startIndex].timestamp;
      const oldEndTime = modifiedEpisode.frames[endIndex].timestamp;
      const scaledEndTime = baseTime + (oldEndTime - baseTime) * scale;
      const deltaAfter = scaledEndTime - oldEndTime;

      const nextFrames = modifiedEpisode.frames.map((frame, idx) => {
        let timestamp = frame.timestamp;
        if (idx >= startIndex && idx <= endIndex) {
          timestamp = baseTime + (frame.timestamp - baseTime) * scale;
        } else if (idx > endIndex) {
          timestamp = frame.timestamp + deltaAfter;
        }
        return {
          ...frame,
          timestamp,
        };
      });

      const lastTimestamp =
        nextFrames[nextFrames.length - 1]?.timestamp ?? modifiedEpisode.frames.at(-1)?.timestamp ?? 0;
      const nextEpisode: Episode = {
        ...modifiedEpisode,
        frames: nextFrames,
        metadata: modifiedEpisode.metadata
          ? {
              ...modifiedEpisode.metadata,
              num_frames: nextFrames.length,
              episode_length_sec: lastTimestamp / 1000,
            }
          : undefined,
      };

      setModifiedEpisode(nextEpisode);
      pushToHistory(nextEpisode);
      setCurrentFrame(startIndex);
      preservedFrameRef.current = startIndex;
      onSetGlobalFrame?.(startIndex);
      toast.success(
        resolved
          ? `Retime ${scale.toFixed(2)}x (range)`
          : `Retime ${scale.toFixed(2)}x (all)`
      );
    },
    [isEditMode, modifiedEpisode, getResolvedTrimRange, pushToHistory, onSetGlobalFrame]
  );

  const handleRescaleFps = useCallback(() => {
    if (!isEditMode || !modifiedEpisode) return;
    if (!Number.isFinite(retimeFps) || retimeFps <= 0) {
      toast.error("Enter a valid FPS");
      return;
    }
    if (modifiedEpisode.frames.length < 2) {
      toast.error("Not enough frames to rescale");
      return;
    }
    const baseTime = modifiedEpisode.frames[0].timestamp;
    const oldDuration =
      modifiedEpisode.frames[modifiedEpisode.frames.length - 1].timestamp - baseTime;
    if (!Number.isFinite(oldDuration) || oldDuration <= 0) {
      toast.error("Invalid timing data");
      return;
    }

    const desiredDurationMs = ((modifiedEpisode.frames.length - 1) / retimeFps) * 1000;
    const scale = desiredDurationMs / oldDuration;
    if (!Number.isFinite(scale) || scale <= 0) {
      toast.error("Invalid FPS scale");
      return;
    }
    if (Math.abs(scale - 1) < 1e-4) {
      toast.info("FPS already matches");
      return;
    }

    const nextFrames = modifiedEpisode.frames.map((frame) => ({
      ...frame,
      timestamp: baseTime + (frame.timestamp - baseTime) * scale,
    }));
    const lastTimestamp =
      nextFrames[nextFrames.length - 1]?.timestamp ?? modifiedEpisode.frames.at(-1)?.timestamp ?? 0;
    const nextEpisode: Episode = {
      ...modifiedEpisode,
      frames: nextFrames,
      metadata: modifiedEpisode.metadata
        ? {
            ...modifiedEpisode.metadata,
            fps: retimeFps,
            num_frames: nextFrames.length,
            episode_length_sec: lastTimestamp / 1000,
          }
        : undefined,
    };

    setModifiedEpisode(nextEpisode);
    pushToHistory(nextEpisode);
    setCurrentFrame(0);
    preservedFrameRef.current = 0;
    onSetGlobalFrame?.(0);
    toast.success(`Rescaled to ${retimeFps.toFixed(2)} FPS`);
  }, [isEditMode, modifiedEpisode, retimeFps, pushToHistory, onSetGlobalFrame]);

  const handleAutoTrimRange = useCallback(() => {
    const targetEpisode = modifiedEpisode ?? episode;
    if (!isEditMode || !targetEpisode) return;
    if (jointNames.length === 0 || targetEpisode.frames.length < 2) {
      toast.error("Not enough frames to auto trim");
      return;
    }

    let maxRange = 0;
    const jointStats = new Map<string, { min: number; max: number }>();
    for (const jointName of jointNames) {
      jointStats.set(jointName, { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });
    }
    for (const frame of targetEpisode.frames) {
      for (const jointName of jointNames) {
        const value = frame.jointPositions[jointName];
        if (!Number.isFinite(value)) continue;
        const stats = jointStats.get(jointName);
        if (!stats) continue;
        stats.min = Math.min(stats.min, value);
        stats.max = Math.max(stats.max, value);
      }
    }
    jointStats.forEach((stats) => {
      if (Number.isFinite(stats.min) && Number.isFinite(stats.max)) {
        maxRange = Math.max(maxRange, stats.max - stats.min);
      }
    });

    if (maxRange < 1e-3) {
      toast.info("Movement too small to auto trim");
      return;
    }

    const epsilon = Math.max(1e-4, maxRange * 0.01);
    const perFrameDelta: number[] = [];
    for (let i = 1; i < targetEpisode.frames.length; i += 1) {
      let maxDelta = 0;
      const current = targetEpisode.frames[i].jointPositions;
      const previous = targetEpisode.frames[i - 1].jointPositions;
      for (const jointName of jointNames) {
        const nextValue = current[jointName];
        const prevValue = previous[jointName];
        if (!Number.isFinite(nextValue) || !Number.isFinite(prevValue)) continue;
        const delta = Math.abs(nextValue - prevValue);
        if (delta > maxDelta) maxDelta = delta;
      }
      perFrameDelta.push(maxDelta);
    }
    const minRun = 2;
    const isMoving = perFrameDelta.map((delta) => delta > epsilon);
    let first = -1;
    let last = -1;

    for (let i = 0; i <= isMoving.length - minRun; i += 1) {
      let run = true;
      for (let j = 0; j < minRun; j += 1) {
        if (!isMoving[i + j]) {
          run = false;
          break;
        }
      }
      if (run) {
        first = i + 1;
        break;
      }
    }

    for (let i = isMoving.length - 1; i >= minRun - 1; i -= 1) {
      let run = true;
      for (let j = 0; j < minRun; j += 1) {
        if (!isMoving[i - j]) {
          run = false;
          break;
        }
      }
      if (run) {
        last = i + 1;
        break;
      }
    }

    if (first === -1 || last === -1) {
      toast.error("No movement detected for auto trim");
      return;
    }

    const start = Math.max(0, first - 1);
    const end = Math.min(targetEpisode.frames.length - 1, Math.max(first, last) + 1);
    if (start <= 1 && end >= targetEpisode.frames.length - 2) {
      toast.info("Already trimmed");
      return;
    }
    setTrimRange({ start, end });
    setCurrentFrame(start);
    preservedFrameRef.current = start;
    onSetGlobalFrame?.(start);
    toast.success("Auto range set");
  }, [isEditMode, modifiedEpisode, episode, jointNames, onSetGlobalFrame]);


  // Keyboard shortcuts (Blender-like)
  useEffect(() => {
    if (!open || !isEditMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S - Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && modifiedEpisode && onSaveEpisode) {
          // Quick save: use last choice if available, otherwise show dialog
          if (lastSaveChoice === 'overwrite') {
            onSaveEpisode(modifiedEpisode, false);
            toast.success(`Episode ${episode?.number ? episode.number - 1 : 0} updated`);
          } else if (lastSaveChoice === 'new') {
            setShowSaveDialog(true);
            setSaveAsNew(true);
            setNewEpisodeName(`Episode ${episode?.number ? episode.number - 1 : allEpisodes.length} (edited)`);
          } else {
            // First time saving, show dialog
            setShowSaveDialog(true);
            setSaveAsNew(false);
            setNewEpisodeName(`Episode ${episode?.number ? episode.number - 1 : allEpisodes.length} (edited)`);
          }
        }
      }
      // Shift+Ctrl+S or Shift+Cmd+S - Save As (always show dialog)
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (hasChanges && modifiedEpisode && onSaveEpisode) {
          setShowSaveDialog(true);
          setSaveAsNew(true);
          setNewEpisodeName(`Episode ${episode?.number ? episode.number - 1 : allEpisodes.length} (edited)`);
        }
      }
      // Ctrl+Z or Cmd+Z - Undo
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z, Cmd+Shift+Z, or Ctrl+Y - Redo
      else if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') ||
               ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
      // Escape - Exit edit mode (with confirmation if unsaved)
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (hasChanges && modifiedEpisode && onSaveEpisode) {
          setShowExitConfirmDialog(true);
        } else {
          setIsEditMode(false);
          setEditingJoint(null);
          setSelectedPointIndex(null);
          setTangentHandles(new Map());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isEditMode, hasChanges, modifiedEpisode, onSaveEpisode, lastSaveChoice, episode, allEpisodes, handleUndo, handleRedo]);

  // Watch for container size changes to redraw canvas
  useEffect(() => {
    if (!canvasContainerRef.current) return;

    // Initialize size on mount
    const rect = canvasContainerRef.current.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });

    resizeObserver.observe(canvasContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);


  // Handle timeline mouse down
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!episode || !canvasRef.current || episode.frames.length === 0) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Only allow dragging in the top header area (FRAME/SECS area)
    if (y > TIMELINE_HEADER_HEIGHT) return;
    
    if (x < CANVAS_PADDING || x > rect.width - CANVAS_PADDING) return;

    dragStartPositionRef.current = { x: e.clientX, y: e.clientY };
    isDraggingTimelineRef.current = false;

    const frameIndex = calculateFrameFromMouse(x, rect.width, episode.frames.length);

    // Update to the clicked frame (stops playback)
    updateViewerFrame(frameIndex);

    onSetGlobalFrame?.(frameIndex);

    if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
      onSetCurrentEpisodeIndex(currentEpisodeIndex);
    } else if (currentEpisodeIndex === null && allEpisodes.length > 0) {
      const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
      if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
        onSetCurrentEpisodeIndex(episodeIndex);
      }
    }

    setCurrentFrame(frameIndex);
  }, [episode, onSetGlobalFrame, currentEpisodeIndex, allEpisodes, onSetCurrentEpisodeIndex]);

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
    const y = e.clientY - rect.top;

    // Only allow dragging if we're in the header area or if we started dragging from the header
    // This allows dragging to continue even if mouse moves slightly below the header
    const initialY = dragStartPositionRef.current.y - rect.top;
    if (initialY > TIMELINE_HEADER_HEIGHT) return;

    if (x >= CANVAS_PADDING && x <= rect.width - CANVAS_PADDING && episode.frames.length > 0) {
      const frameIndex = calculateFrameFromMouse(x, rect.width, episode.frames.length);

      // Update to the dragged frame (stops playback)
      updateViewerFrame(frameIndex);

      onSetGlobalFrame?.(frameIndex);
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

  // Helper to create tangent handles for a point (Photoshop-style)
  const createHandlesForPoint = useCallback((
    pointIndex: number,
    rect: DOMRect,
    range: { min: number; max: number },
    graphWidth: number,
    graphHeight: number,
    minVal: number,
    maxVal: number,
    valueRange: number
  ) => {
    const currentValue = modifiedEpisode!.frames[pointIndex].jointPositions[editingJoint!];
    const normalizedValue = (currentValue - minVal) / valueRange;
    const pointY = rect.height - CANVAS_PADDING - graphHeight * normalizedValue;
    const pointX = CANVAS_PADDING + (graphWidth * pointIndex) / (modifiedEpisode!.frames.length - 1);
    
    // Calculate default handle positions based on curve tangent
    const prevIndex = Math.max(0, pointIndex - 1);
    const nextIndex = Math.min(modifiedEpisode!.frames.length - 1, pointIndex + 1);
    
    const prevValue = modifiedEpisode!.frames[prevIndex].jointPositions[editingJoint!];
    const nextValue = modifiedEpisode!.frames[nextIndex].jointPositions[editingJoint!];
    
    const prevNormalized = (prevValue - minVal) / valueRange;
    const nextNormalized = (nextValue - minVal) / valueRange;
    
    const prevY = rect.height - CANVAS_PADDING - graphHeight * prevNormalized;
    const nextY = rect.height - CANVAS_PADDING - graphHeight * nextNormalized;
    const prevX = CANVAS_PADDING + (graphWidth * prevIndex) / (modifiedEpisode!.frames.length - 1);
    const nextX = CANVAS_PADDING + (graphWidth * nextIndex) / (modifiedEpisode!.frames.length - 1);
    
    // Calculate tangent direction
    const dxLeft = pointX - prevX;
    const dyLeft = pointY - prevY;
    const dxRight = nextX - pointX;
    const dyRight = nextY - pointY;
    
    // Default handle distance
    const defaultHandleDistance = 40;
    
    // Calculate tangent angles
    const leftAngle = Math.atan2(dyLeft, dxLeft);
    const rightAngle = Math.atan2(dyRight, dxRight);
    
    // Position handles along tangent direction
    const leftHandleX = pointX - Math.cos(leftAngle) * defaultHandleDistance;
    const leftHandleY = pointY - Math.sin(leftAngle) * defaultHandleDistance;
    const rightHandleX = pointX + Math.cos(rightAngle) * defaultHandleDistance;
    const rightHandleY = pointY + Math.sin(rightAngle) * defaultHandleDistance;
    
    // Convert handle positions to values
    const leftNormalizedY = 1 - ((leftHandleY - CANVAS_PADDING) / graphHeight);
    const rightNormalizedY = 1 - ((rightHandleY - CANVAS_PADDING) / graphHeight);
    const leftHandleValue = minVal + leftNormalizedY * valueRange;
    const rightHandleValue = minVal + rightNormalizedY * valueRange;
    
    // Calculate handle lengths
    const leftLength = Math.sqrt(Math.pow(leftHandleX - pointX, 2) + Math.pow(leftHandleY - pointY, 2));
    const rightLength = Math.sqrt(Math.pow(rightHandleX - pointX, 2) + Math.pow(rightHandleY - pointY, 2));
    
    return {
      left: { x: leftHandleX, y: leftHandleY, value: leftHandleValue, length: leftLength },
      right: { x: rightHandleX, y: rightHandleY, value: rightHandleValue, length: rightLength }
    };
  }, [editingJoint, modifiedEpisode]);

  // Handle curve editing - click to select point (Photoshop-style: dragging creates handles)
  const handleCurveClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !episode || !canvasRef.current || !modifiedEpisode) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Don't handle clicks in the header area
    if (y <= TIMELINE_HEADER_HEIGHT) return;

    const range = jointRanges[editingJoint];
    if (!range) return;

    const closestIndex = findClosestPointOnCurve(
      x, y,
      modifiedEpisode.frames,
      editingJoint,
      range,
      rect.width,
      rect.height
    );

    if (closestIndex !== null) {
      setSelectedPointIndex(closestIndex);
      setIsDraggingPoint(true);
      
      // Photoshop-style: automatically create handles if they don't exist when dragging
      if (!tangentHandles.has(closestIndex)) {
        const graphWidth = rect.width - CANVAS_PADDING * 2;
        const graphHeight = rect.height - CANVAS_PADDING * 2;
        const rangePadding = (range.max - range.min) * 0.1 || 0.1;
        const minVal = range.min - rangePadding;
        const maxVal = range.max + rangePadding;
        const valueRange = maxVal - minVal;
        
        const handles = createHandlesForPoint(
          closestIndex,
          rect,
          range,
          graphWidth,
          graphHeight,
          minVal,
          maxVal,
          valueRange
        );
        
        const newHandles = new Map(tangentHandles);
        newHandles.set(closestIndex, handles);
        setTangentHandles(newHandles);
      }
    }
  }, [isEditMode, editingJoint, episode, modifiedEpisode, jointRanges, tangentHandles, createHandlesForPoint]);

  // Handle curve editing - drag to modify point (Photoshop-style: uses handles for smooth curves)
  const handleCurveDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !episode || !canvasRef.current || !modifiedEpisode || selectedPointIndex === null || !isDraggingPoint) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Don't handle drags in the header area
    if (y <= TIMELINE_HEADER_HEIGHT) return;

    const range = jointRanges[editingJoint];
    if (!range) return;

    const graphWidth = rect.width - CANVAS_PADDING * 2;
    const graphHeight = rect.height - CANVAS_PADDING * 2;
    const rangePadding = (range.max - range.min) * 0.1 || 0.1;
    const minVal = range.min - rangePadding;
    const maxVal = range.max + rangePadding;
    const valueRange = maxVal - minVal;

    // Convert mouse Y position to joint value
    const normalizedY = 1 - ((y - CANVAS_PADDING) / graphHeight);
    const newValue = minVal + normalizedY * valueRange;
    const clampedValue = Math.max(minVal, Math.min(maxVal, newValue));

    // Update the point value
    const currentValues = modifiedEpisode.frames.map(f => f.jointPositions[editingJoint]);
    currentValues[selectedPointIndex] = clampedValue;

    // Get or create handles (Photoshop-style: handles are always used when dragging)
    let handles = tangentHandles.get(selectedPointIndex);
    const pointX = CANVAS_PADDING + (graphWidth * selectedPointIndex) / (modifiedEpisode.frames.length - 1);

    // If handles don't exist, create them automatically
    if (!handles) {
      handles = createHandlesForPoint(
        selectedPointIndex,
        rect,
        range,
        graphWidth,
        graphHeight,
        minVal,
        maxVal,
        valueRange
      );
      const newHandles = new Map(tangentHandles);
      newHandles.set(selectedPointIndex, handles);
      setTangentHandles(newHandles);
    } else {
      // Update handle positions relative to the new point position (Photoshop-style)
      const oldPointValue = modifiedEpisode.frames[selectedPointIndex].jointPositions[editingJoint];
      const oldPointNormalized = (oldPointValue - minVal) / valueRange;
      const oldPointY = rect.height - CANVAS_PADDING - graphHeight * oldPointNormalized;

      const newPointY = rect.height - CANVAS_PADDING - graphHeight * ((clampedValue - minVal) / valueRange);

      // Calculate offset from old point to handles
      const leftDx = handles.left.x - pointX;
      const leftDy = handles.left.y - oldPointY;
      const rightDx = handles.right.x - pointX;
      const rightDy = handles.right.y - oldPointY;

      // Apply same offset to new point position
      const leftHandleX = pointX + leftDx;
      const leftHandleY = newPointY + leftDy;
      const rightHandleX = pointX + rightDx;
      const rightHandleY = newPointY + rightDy;

      // Convert to values
      const leftNormalizedY = 1 - ((leftHandleY - CANVAS_PADDING) / graphHeight);
      const rightNormalizedY = 1 - ((rightHandleY - CANVAS_PADDING) / graphHeight);
      const leftHandleValue = minVal + leftNormalizedY * valueRange;
      const rightHandleValue = minVal + rightNormalizedY * valueRange;

      // Recalculate lengths
      const leftLength = Math.sqrt(Math.pow(leftHandleX - pointX, 2) + Math.pow(leftHandleY - newPointY, 2));
      const rightLength = Math.sqrt(Math.pow(rightHandleX - pointX, 2) + Math.pow(rightHandleY - newPointY, 2));

      handles = {
        left: { x: leftHandleX, y: leftHandleY, value: leftHandleValue, length: leftLength },
        right: { x: rightHandleX, y: rightHandleY, value: rightHandleValue, length: rightLength }
      };

      const newHandles = new Map(tangentHandles);
      newHandles.set(selectedPointIndex, handles);
      setTangentHandles(newHandles);
    }

    // Always use Bezier interpolation with handles (Photoshop-style)
    const updatedValues = applyBezierCurve(
      currentValues,
      selectedPointIndex,
      handles.left,
      handles.right,
      modifiedEpisode.frames,
      editingJoint,
      pointX,
      rect.width,
      rect.height,
      minVal,
      maxVal
    );

    // Update modified episode
    const updatedFrames = modifiedEpisode.frames.map((frame, index) => ({
      ...frame,
      jointPositions: {
        ...frame.jointPositions,
        [editingJoint]: updatedValues[index]
      }
    }));

    const newEpisode = {
      ...modifiedEpisode,
      frames: updatedFrames
    };
    setModifiedEpisode(newEpisode);
    // Don't push to history while dragging - we'll push on mouse up to avoid too many history states
  }, [isEditMode, editingJoint, episode, modifiedEpisode, selectedPointIndex, isDraggingPoint, jointRanges, tangentHandles, createHandlesForPoint]);

  // Handle curve editing - mouse up
  const handleCurveMouseUp = useCallback(() => {
    // Push to history when done dragging (not on every mouse move)
    if ((isDraggingPoint || draggingHandle) && modifiedEpisode) {
      pushToHistory(modifiedEpisode);
    }
    setIsDraggingPoint(false);
    setDraggingHandle(null);
  }, [isDraggingPoint, draggingHandle, modifiedEpisode, pushToHistory]);


  // Handle dragging tangent handles - allows free 2D movement
  const handleHandleDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !episode || !canvasRef.current || !modifiedEpisode || !draggingHandle) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Don't handle drags in the header area
    if (mouseY <= TIMELINE_HEADER_HEIGHT) return;

    const range = jointRanges[editingJoint];
    if (!range) return;

    const graphWidth = rect.width - CANVAS_PADDING * 2;
    const graphHeight = rect.height - CANVAS_PADDING * 2;
    const rangePadding = (range.max - range.min) * 0.1 || 0.1;
    const minVal = range.min - rangePadding;
    const maxVal = range.max + rangePadding;
    const valueRange = maxVal - minVal;

    // Get the main point position
    const pointValue = modifiedEpisode.frames[draggingHandle.pointIndex].jointPositions[editingJoint];
    const pointNormalized = (pointValue - minVal) / valueRange;
    const pointY = rect.height - CANVAS_PADDING - graphHeight * pointNormalized;
    const pointX = CANVAS_PADDING + (graphWidth * draggingHandle.pointIndex) / (modifiedEpisode.frames.length - 1);

    // Allow free 2D movement - calculate new handle position
    const newHandleX = Math.max(CANVAS_PADDING, Math.min(rect.width - CANVAS_PADDING, mouseX));
    const newHandleY = Math.max(CANVAS_PADDING, Math.min(rect.height - CANVAS_PADDING, mouseY));

    // Calculate handle length (distance from point)
    const handleLength = Math.sqrt(
      Math.pow(newHandleX - pointX, 2) + Math.pow(newHandleY - pointY, 2)
    );

    // Convert handle Y position to joint value
    const normalizedY = 1 - ((newHandleY - CANVAS_PADDING) / graphHeight);
    const newValue = minVal + normalizedY * valueRange;
    const clampedValue = Math.max(minVal, Math.min(maxVal, newValue));

    // Update the handle position, value, and length
    const handles = tangentHandles.get(draggingHandle.pointIndex);
    if (!handles) return;

    const newHandles = new Map(tangentHandles);
    const updatedHandle = draggingHandle.side === 'left' 
      ? { 
          ...handles, 
          left: { x: newHandleX, y: newHandleY, value: clampedValue, length: handleLength },
          right: handles.right
        }
      : { 
          ...handles, 
          left: handles.left,
          right: { x: newHandleX, y: newHandleY, value: clampedValue, length: handleLength }
        };
    newHandles.set(draggingHandle.pointIndex, updatedHandle);
    setTangentHandles(newHandles);

    // Apply Bezier curve interpolation with updated handle positions
    const currentValues = modifiedEpisode.frames.map(f => f.jointPositions[editingJoint]);
    const updatedValues = applyBezierCurve(
      currentValues,
      draggingHandle.pointIndex,
      updatedHandle.left,
      updatedHandle.right,
      modifiedEpisode.frames,
      editingJoint,
      pointX,
      rect.width,
      rect.height,
      minVal,
      maxVal
    );

    // Update modified episode
    const updatedFrames = modifiedEpisode.frames.map((frame, index) => ({
      ...frame,
      jointPositions: {
        ...frame.jointPositions,
        [editingJoint]: updatedValues[index]
      }
    }));

    const newEpisode = {
      ...modifiedEpisode,
      frames: updatedFrames
    };
    setModifiedEpisode(newEpisode);
    // Don't push to history while dragging - we'll push on mouse up to avoid too many history states
  }, [isEditMode, editingJoint, episode, modifiedEpisode, draggingHandle, tangentHandles, jointRanges]);

  // Handle clicking on tangent handles
  const handleHandleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !episode || !canvasRef.current || !modifiedEpisode) return false;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Don't handle clicks in the header area
    if (mouseY <= TIMELINE_HEADER_HEIGHT) return false;

    const HANDLE_RADIUS = 8; // pixels - larger for easier grabbing
    const range = jointRanges[editingJoint];
    if (!range) return false;

    // Check if clicking on any handle (use stored screen coordinates)
    for (const [pointIndex, handles] of tangentHandles.entries()) {
      // Use stored screen coordinates, clamped to canvas bounds
      const leftHandleX = Math.max(CANVAS_PADDING, Math.min(rect.width - CANVAS_PADDING, handles.left.x));
      const leftHandleY = Math.max(CANVAS_PADDING, Math.min(rect.height - CANVAS_PADDING, handles.left.y));
      const rightHandleX = Math.max(CANVAS_PADDING, Math.min(rect.width - CANVAS_PADDING, handles.right.x));
      const rightHandleY = Math.max(CANVAS_PADDING, Math.min(rect.height - CANVAS_PADDING, handles.right.y));
      
      const leftDist = Math.sqrt(
        Math.pow(mouseX - leftHandleX, 2) + Math.pow(mouseY - leftHandleY, 2)
      );
      const rightDist = Math.sqrt(
        Math.pow(mouseX - rightHandleX, 2) + Math.pow(mouseY - rightHandleY, 2)
      );

      if (leftDist < HANDLE_RADIUS) {
        setDraggingHandle({ pointIndex, side: 'left' });
        setSelectedPointIndex(pointIndex);
        return true; // Indicate we handled this click
      }
      if (rightDist < HANDLE_RADIUS) {
        setDraggingHandle({ pointIndex, side: 'right' });
        setSelectedPointIndex(pointIndex);
        return true; // Indicate we handled this click
      }
    }
    return false; // No handle was clicked
  }, [isEditMode, editingJoint, episode, modifiedEpisode, tangentHandles, jointRanges]);

  // Calculate time display
  const calculateTime = useCallback((frame: number): string => {
    const timeEpisode = isEditMode && modifiedEpisode ? modifiedEpisode : episode;
    if (!timeEpisode || timeEpisode.frames.length === 0) return "0.00s";
    
    const totalFrames = timeEpisode.frames.length;
    const totalDuration =
      timeEpisode.frames[totalFrames - 1].timestamp - timeEpisode.frames[0].timestamp;
    const effectiveSpeed = playbackSpeed || 1.0;
    const frameDuration = totalFrames > 1 
      ? (totalDuration / (totalFrames - 1)) / effectiveSpeed
      : 0;
    const calculatedTime = frame * frameDuration;
    return `${(calculatedTime / 1000).toFixed(2)}s`;
  }, [episode, modifiedEpisode, isEditMode, playbackSpeed]);

  // Draw canvas
  useLayoutEffect(() => {
    if (!episode || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    // Use containerSize if available, otherwise fall back to getBoundingClientRect
    const width = containerSize.width > 0 ? containerSize.width : rect.width;
    const height = containerSize.height > 0 ? containerSize.height : rect.height;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const graphHeight = height - CANVAS_PADDING * 2;
    const graphWidth = width - CANVAS_PADDING * 2;

    // Clear canvas
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;

    const totalFrames = episode.frames.length;

    // Draw a line for EVERY frame, equally spaced (no skipping)
    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      // Position evenly across the graph width
      const x = CANVAS_PADDING + (graphWidth * frameNumber) / (totalFrames - 1);

      ctx.beginPath();
      ctx.moveTo(x, CANVAS_PADDING);
      ctx.lineTo(x, height - CANVAS_PADDING);
      ctx.stroke();

      // Label every frame
      ctx.fillStyle = "#71717a";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`F${frameNumber}`, x, height - CANVAS_PADDING + 15);
    }

    for (let i = 0; i <= 5; i++) {
      const y = CANVAS_PADDING + (graphHeight * i) / 5;
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, y);
      ctx.lineTo(width - CANVAS_PADDING, y);
      ctx.stroke();
    }

    if (resolvedTrimRange && totalFrames > 1) {
      const startX =
        CANVAS_PADDING + (graphWidth * resolvedTrimRange.start) / (totalFrames - 1);
      const endX =
        CANVAS_PADDING + (graphWidth * resolvedTrimRange.end) / (totalFrames - 1);
      const leftX = Math.min(startX, endX);
      const rightX = Math.max(startX, endX);

      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(CANVAS_PADDING, CANVAS_PADDING, leftX - CANVAS_PADDING, graphHeight);
      ctx.fillRect(rightX, CANVAS_PADDING, width - CANVAS_PADDING - rightX, graphHeight);

      ctx.strokeStyle = "#52525b";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(leftX, CANVAS_PADDING);
      ctx.lineTo(leftX, height - CANVAS_PADDING);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightX, CANVAS_PADDING);
      ctx.lineTo(rightX, height - CANVAS_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("IN", leftX, CANVAS_PADDING - 4);
      ctx.fillText("OUT", rightX, CANVAS_PADDING - 4);
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
    const activeEpisode = (isEditMode && modifiedEpisode) ? modifiedEpisode : episode;

    selectedJointNames.forEach((jointName) => {
      const color = jointColorMap.get(jointName) || JOINT_COLORS[0];
      const range = jointRanges[jointName];
      if (!range) return;

      const rangePadding = (range.max - range.min) * 0.1 || 0.1;
      const minVal = range.min - rangePadding;
      const maxVal = range.max + rangePadding;
      const valueRange = maxVal - minVal;

      // In edit mode, show non-edited lines in dark grey
      const isEditingThisJoint = isEditMode && editingJoint === jointName;
      const shouldDim = isEditMode && !!editingJoint && editingJoint !== jointName;
      const displayColor = shouldDim ? "#404040" : color;

      ctx.strokeStyle = displayColor;
      ctx.lineWidth = isEditingThisJoint ? 3 : 2; // Thicker line for editing
      ctx.beginPath();

      activeEpisode.frames.forEach((frame, frameIndex) => {
        const value = frame.jointPositions[jointName];
        const x = CANVAS_PADDING + (graphWidth * frameIndex) / (activeEpisode.frames.length - 1);
        const normalizedValue = (value - minVal) / valueRange;
        const y = height - CANVAS_PADDING - graphHeight * normalizedValue;

        if (frameIndex === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw points on the editable line
      if (isEditingThisJoint) {
        activeEpisode.frames.forEach((frame, frameIndex) => {
          const value = frame.jointPositions[jointName];
          const x = CANVAS_PADDING + (graphWidth * frameIndex) / (activeEpisode.frames.length - 1);
          const normalizedValue = (value - minVal) / valueRange;
          const y = height - CANVAS_PADDING - graphHeight * normalizedValue;

          const isSelected = selectedPointIndex === frameIndex;
          const hasHandles = tangentHandles.has(frameIndex);
          
          // Draw tangent handles and lines if they exist
          if (hasHandles && isSelected) {
            const handles = tangentHandles.get(frameIndex);
            if (handles) {
              // Use stored screen coordinates for handles (allows free 2D movement)
              const leftHandleX = Math.max(CANVAS_PADDING, Math.min(width - CANVAS_PADDING, handles.left.x));
              const leftHandleY = Math.max(CANVAS_PADDING, Math.min(height - CANVAS_PADDING, handles.left.y));
              const rightHandleX = Math.max(CANVAS_PADDING, Math.min(width - CANVAS_PADDING, handles.right.x));
              const rightHandleY = Math.max(CANVAS_PADDING, Math.min(height - CANVAS_PADDING, handles.right.y));
              
              // Draw lines from point to handles (thicker, more visible)
              ctx.strokeStyle = "#3b82f6"; // Blue color for handles
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 4]);
              
              // Left handle line
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(leftHandleX, leftHandleY);
              ctx.stroke();
              
              // Right handle line
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(rightHandleX, rightHandleY);
              ctx.stroke();
              
              ctx.setLineDash([]);
              
              // Draw larger, more visible handle circles
              const isDraggingLeft = draggingHandle?.pointIndex === frameIndex && draggingHandle.side === 'left';
              const isDraggingRight = draggingHandle?.pointIndex === frameIndex && draggingHandle.side === 'right';
              
              // Left handle - larger when dragging
              ctx.fillStyle = isDraggingLeft ? "#60a5fa" : "#ffffff";
              ctx.strokeStyle = "#3b82f6";
              ctx.lineWidth = isDraggingLeft ? 3 : 2;
              ctx.beginPath();
              ctx.arc(leftHandleX, leftHandleY, isDraggingLeft ? 6 : 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              
              // Right handle - larger when dragging
              ctx.fillStyle = isDraggingRight ? "#60a5fa" : "#ffffff";
              ctx.strokeStyle = "#3b82f6";
              ctx.lineWidth = isDraggingRight ? 3 : 2;
              ctx.beginPath();
              ctx.arc(rightHandleX, rightHandleY, isDraggingRight ? 6 : 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
          
          // Draw point
          ctx.fillStyle = isSelected ? "#3b82f6" : color; // Blue when selected, original color otherwise
          ctx.beginPath();
          ctx.arc(x, y, isSelected ? 5 : 3, 0, Math.PI * 2);
          ctx.fill();
          
          // Draw a ring around selected point
          if (isSelected) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }
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
  }, [episode, currentFrame, globalCurrentFrame, selectedJoints, jointNames, jointRanges, jointColorMap, size, containerSize, calculateTime, isEditMode, editingJoint, selectedPointIndex, modifiedEpisode, tangentHandles, draggingHandle, getResolvedTrimRange]);

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

  const handleSave = useCallback(() => {
    if (!modifiedEpisode || !onSaveEpisode) return;

    if (saveAsNew && newEpisodeName.trim()) {
      // Save as new episode
      onSaveEpisode(modifiedEpisode, true, newEpisodeName.trim());
      // Remember choice for quick save (Ctrl+S)
      setLastSaveChoice('new');
    } else if (!saveAsNew) {
      // Overwrite existing episode
      onSaveEpisode(modifiedEpisode, false);
      // Remember choice for quick save (Ctrl+S)
      setLastSaveChoice('overwrite');
    }

    // Close dialog and exit edit mode
    setShowSaveDialog(false);
    setIsEditMode(false);
    setEditingJoint(null);
    setSelectedPointIndex(null);
    setTangentHandles(new Map());
    setSaveAsNew(false);
    setNewEpisodeName("");
  }, [modifiedEpisode, onSaveEpisode, saveAsNew, newEpisodeName]);

  const handleCancelSave = useCallback(() => {
    setShowSaveDialog(false);
    setSaveAsNew(false);
    setNewEpisodeName("");
  }, []);

  const handleJointSelect = useCallback((jointName: string) => {
    // Make sure the joint is visible first
    if (!selectedJoints.has(jointName)) {
      const newSelected = new Set(selectedJoints);
      newSelected.add(jointName);
      setSelectedJoints(newSelected);
    }
    // Enter edit mode for the selected joint
    setIsEditMode(true);
    setEditingJoint(jointName);
    setSelectedPointIndex(null);
    setTangentHandles(new Map());
  }, [selectedJoints]);

  const handleEnterTimelineEdit = useCallback(() => {
    setIsEditMode(true);
    setEditingJoint(null);
    setSelectedPointIndex(null);
    setDraggingHandle(null);
    setTangentHandles(new Map());
  }, []);

  if (!open) return null;

  if (!episode) return null;

  const totalFrames = episode?.frames.length ?? 0;
  const timeEpisode = isEditMode && modifiedEpisode ? modifiedEpisode : episode;
  const duration =
    totalFrames > 0 && timeEpisode
      ? timeEpisode.frames[timeEpisode.frames.length - 1].timestamp
      : 0;
  const durationSeconds = (duration / 1000).toFixed(1);
  const displayFrame = getCurrentFrameValue(preservedFrameRef.current, globalCurrentFrame, currentFrame);
  const resolvedTrimRange = getResolvedTrimRange(totalFrames);

  const content = (
    <div
      ref={containerRef}
      className={cn(
        "bg-background flex flex-col overflow-hidden h-full",
        inline ? "border-t border-border" : "fixed border-2 border-border rounded-lg shadow-2xl",
        isEditMode && hasChanges && "bg-orange-500/10 border-orange-500/30"
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
          className="flex items-center justify-between px-3 py-2 bg-muted border-b border-border"
      >
        <div className="flex items-center gap-2 flex-1 pointer-events-none">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">
              Episode {episode ? episode.number - 1 : 0}{isEditMode && hasChanges && <span className="text-orange-500 ml-1 text-lg font-bold">*</span>}
            </h3>
            {/* Timeline Controls */}
            {onPlayAllEpisodes && (
              <div className="flex items-center gap-1 pointer-events-auto" onMouseDown={(e) => e.stopPropagation()}>
                {onSetCurrentEpisodeIndex && allEpisodes.length > 1 && (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allEpisodes.length === 0) return;
                          const currentIndex = currentEpisodeIndex ?? 0;
                          const prevIndex = currentIndex > 0 ? currentIndex - 1 : allEpisodes.length - 1;
                          onSetCurrentEpisodeIndex(prevIndex);
                          onSetGlobalFrame?.(0);
                        }}
                        disabled={allEpisodes.length <= 1}
                      >
                        <SkipBack className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Previous Episode</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayAllEpisodes();
                      }}
                      disabled={!episode || episode.frames.length === 0}
                    >
                      {isPlayingAll ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isPlayingAll ? "Pause" : "Play"}</p>
                  </TooltipContent>
                </Tooltip>
                {onSetCurrentEpisodeIndex && allEpisodes.length > 1 && (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allEpisodes.length === 0) return;
                          const currentIndex = currentEpisodeIndex ?? 0;
                          const nextIndex = (currentIndex + 1) % allEpisodes.length;
                          onSetCurrentEpisodeIndex(nextIndex);
                          onSetGlobalFrame?.(0);
                        }}
                        disabled={allEpisodes.length <= 1}
                      >
                        <SkipForward className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Next Episode</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {isEditMode && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 h-4",
                  hasChanges && "border-orange-500/50 text-orange-500 bg-orange-500/10"
                )}
              >
                EDIT
              </Badge>
            )}
            <div className="flex items-center gap-2 px-1.5 py-0.5 text-[10px] font-mono">
              <span className="tabular-nums">{displayFrame}/{totalFrames - 1}</span>
              <span className="text-muted-foreground/60">•</span>
              <span className="tabular-nums text-muted-foreground">
                {episode ? `${calculateTime(displayFrame).replace('s', '')}/${durationSeconds}s` : "0.00/0.00s"}
              </span>
              {activeFps > 0 && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-muted-foreground">
                    {activeFps.toFixed(2)} fps
                  </span>
                </>
              )}
              {isEditMode && resolvedTrimRange && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-muted-foreground">
                    In {resolvedTrimRange.start} Out {resolvedTrimRange.end}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          {/* Undo/Redo Buttons (only in edit mode) */}
          {isEditMode && (
            <>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUndo();
                    }}
                    disabled={historyIndex <= 0}
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Undo (Ctrl+Z)</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRedo();
                    }}
                    disabled={historyIndex >= editHistory.length - 1}
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Redo (Ctrl+Shift+Z)</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSmoothTrajectory();
                    }}
                    disabled={!editingJoint || !modifiedEpisode}
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                    <span className="text-xs">Smooth</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Smooth current joint curve</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetTrimPoint("start");
                    }}
                    disabled={totalFrames === 0}
                  >
                    <span className="text-xs">In</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Set In (current frame)</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAutoTrimRange();
                    }}
                    disabled={totalFrames < 2}
                  >
                    <span className="text-xs">Auto</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Auto detect In/Out</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetTrimPoint("end");
                    }}
                    disabled={totalFrames === 0}
                  >
                    <span className="text-xs">Out</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Set Out (current frame)</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearTrimRange();
                    }}
                    disabled={!resolvedTrimRange}
                  >
                    <span className="text-xs">Clear</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Clear range</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTrimToRange();
                    }}
                    disabled={!resolvedTrimRange}
                  >
                    <span className="text-xs">Trim</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Trim to range</p>
                </TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-1 px-1">
                <span className="text-[10px] text-muted-foreground">Speed</span>
                <NumberInput
                  value={retimeScale}
                  onValueChange={setRetimeScale}
                  min={0.1}
                  max={10}
                  step={0.05}
                  compact={true}
                  className="w-14"
                />
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTimeScale(retimeScale);
                      }}
                      disabled={totalFrames < 2}
                    >
                      <span className="text-xs">Apply</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Scale time (range or full timeline)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1 px-1">
                <span className="text-[10px] text-muted-foreground">FPS</span>
                <NumberInput
                  value={retimeFps}
                  onValueChange={setRetimeFps}
                  min={1}
                  max={240}
                  step={1}
                  compact={true}
                  className="w-14"
                />
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRescaleFps();
                      }}
                      disabled={totalFrames < 2}
                    >
                      <span className="text-xs">Set</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Rescale timeline to FPS</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </>
          )}
          {/* Save Button (only in edit mode) */}
          {isEditMode && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className="h-6 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (modifiedEpisode && onSaveEpisode) {
                      setShowSaveDialog(true);
                      setSaveAsNew(false);
                      setNewEpisodeName(`Episode ${episode?.number ? episode.number - 1 : allEpisodes.length} (edited)`);
                    }
                  }}
                  disabled={!hasChanges || !modifiedEpisode || !onSaveEpisode}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  <span className="text-xs">Save</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save Changes (Ctrl+S)</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Joint Switcher (edit mode) */}
          {isEditMode && jointNames.length > 0 && (
            <DropdownMenu>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 flex items-center gap-1 text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: editingJoint ? jointColorMap.get(editingJoint) || JOINT_COLORS[0] : "#71717a" }}
                      />
                      <span className="truncate max-w-[90px]">
                        {editingJoint || "Select joint"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Change joint</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                className="w-40 max-h-[220px] overflow-y-auto bg-[#282828] border-[#3d3d3d] p-0.5"
                align="end"
              >
                {jointNames.map((jointName) => {
                  const color = jointColorMap.get(jointName) || JOINT_COLORS[0];
                  const isCurrent = jointName === editingJoint;
                  return (
                    <DropdownMenuItem
                      key={jointName}
                      onClick={() => handleJointSelect(jointName)}
                      className={cn(
                        "text-[10px] font-mono cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                        "flex items-center gap-1 px-1.5 py-0.5",
                        isCurrent && "bg-[#3d3d3d]/60 text-white"
                      )}
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="flex-1 truncate">{jointName}</span>
                      {isCurrent && (
                        <span className="text-[8px] uppercase text-orange-400">editing</span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* Edit Mode Toggle */}
          {isEditMode ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className={cn(
                    "h-6 w-6 p-0",
                    hasChanges && "bg-orange-500 hover:bg-orange-600 border-orange-500/50"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Check if there are changes before exiting
                    if (hasChanges && modifiedEpisode && onSaveEpisode) {
                      // Show exit confirmation dialog (Blender-like)
                      setShowExitConfirmDialog(true);
                    } else {
                      // No changes, just exit
                      setIsEditMode(false);
                      setEditingJoint(null);
                      setSelectedPointIndex(null);
                      setTangentHandles(new Map());
                    }
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Exit Edit Mode (Esc)</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      disabled={jointNames.length === 0}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Edit Curves</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent 
                className="w-36 max-h-[200px] overflow-y-auto bg-[#282828] border-[#3d3d3d] p-0.5"
                align="end"
              >
                <DropdownMenuItem
                  onClick={handleEnterTimelineEdit}
                  className={cn(
                    "text-[9px] font-mono cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                    "flex items-center gap-1 px-1.5 py-0.5"
                  )}
                >
                  <span className="flex-1 truncate">Edit Timeline</span>
                </DropdownMenuItem>
                <div className="h-px bg-[#3d3d3d] my-0.5" />
                {jointNames.length === 0 ? (
                  <div className="text-[9px] text-[#9d9d9d] py-1 px-1.5 text-center">
                    No joints
                  </div>
                ) : (
                  jointNames.map((jointName) => {
                    const color = jointColorMap.get(jointName) || JOINT_COLORS[0];
                    const isVisible = selectedJoints.has(jointName);
                    
                    return (
                      <DropdownMenuItem
                        key={jointName}
                        onClick={() => handleJointSelect(jointName)}
                        className={cn(
                          "text-[9px] font-mono cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          "flex items-center gap-1 px-1.5 py-0.5"
                        )}
                      >
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="flex-1 truncate">{jointName}</span>
                        {!isVisible && (
                          <Eye className="w-2.5 h-2.5 text-[#71717a]" />
                        )}
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content - hidden when showOnlyHeader is true */}
      {!showOnlyHeader && (
      <>
          {/* Graph Canvas */}
          <div className="flex-1 flex overflow-hidden">
            <div ref={canvasContainerRef} className="flex-1 relative bg-background overflow-hidden">
              <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ background: "#09090b", cursor: isEditMode && editingJoint ? 'crosshair' : 'default' }}
                onMouseDown={(e) => {
                  if (isEditMode && editingJoint) {
                    // First check if clicking on a handle
                    const handleClicked = handleHandleClick(e);
                    // If not a handle, check for curve point
                    if (!handleClicked) {
                      handleCurveClick(e);
                    }
                  } else {
                    handleTimelineMouseDown(e);
                  }
                }}
                onMouseMove={(e) => {
                  handleCanvasMouseMove(e);
                  if (isEditMode && editingJoint) {
                    if (draggingHandle) {
                      handleHandleDrag(e);
                    } else if (isDraggingPoint) {
                      handleCurveDrag(e);
                    }
                  } else {
                    handleTimelineMouseMove(e);
                  }
                }}
                onMouseUp={(e) => {
                  if (isEditMode && editingJoint) {
                    handleCurveMouseUp();
                  } else {
                    handleTimelineMouseUp();
                  }
                }}
                onMouseLeave={(e) => {
                  if (canvasRef.current) {
                    canvasRef.current.style.cursor = isEditMode && editingJoint ? 'crosshair' : 'default';
                  }
                  if (isEditMode && editingJoint) {
                    handleCurveMouseUp();
                  } else {
                    handleTimelineMouseLeave();
                  }
                }}
              />
              {/* Edit mode indicator overlay */}
              {isEditMode && editingJoint && (
                <div className="absolute top-2 left-2 pointer-events-none">
                  <div className="text-[8px] font-mono text-[#9d9d9d] bg-[#09090b]/80 px-1.5 py-0.5 rounded">
                    editing trajectory of joint <span style={{ color: jointColorMap.get(editingJoint) || JOINT_COLORS[0] }}>{editingJoint}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  // Save Dialog
  const saveDialog = (
    <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Trajectory Changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes to the trajectory. How would you like to save them?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center space-x-2">
            <input
              type="radio"
              id="overwrite"
              name="saveOption"
              checked={!saveAsNew}
              onChange={() => setSaveAsNew(false)}
              className="h-4 w-4"
            />
            <label htmlFor="overwrite" className="text-sm font-medium cursor-pointer">
              Overwrite existing episode
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="radio"
              id="saveAsNew"
              name="saveOption"
              checked={saveAsNew}
              onChange={() => setSaveAsNew(true)}
              className="h-4 w-4"
            />
            <label htmlFor="saveAsNew" className="text-sm font-medium cursor-pointer">
              Save as new episode
            </label>
          </div>
          {saveAsNew && (
            <div className="pl-6 space-y-2">
              <label htmlFor="newEpisodeName" className="text-sm text-muted-foreground">
                New episode name:
              </label>
              <Input
                id="newEpisodeName"
                value={newEpisodeName}
                onChange={(e) => setNewEpisodeName(e.target.value)}
                placeholder="Enter episode name"
                className="w-full"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancelSave}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveAsNew && !newEpisodeName.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );


  // Exit Confirmation Dialog (Blender-like)
  const exitConfirmDialog = (
    <Dialog open={showExitConfirmDialog} onOpenChange={setShowExitConfirmDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes to the trajectory. Do you want to save before exiting?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              // Don't Save - discard changes and exit
              setShowExitConfirmDialog(false);
              setIsEditMode(false);
              setEditingJoint(null);
              setSelectedPointIndex(null);
              setTangentHandles(new Map());
              // Reset to original episode
              if (episode) {
                setModifiedEpisode({
                  ...episode,
                  frames: episode.frames.map(f => ({
                    ...f,
                    jointPositions: { ...f.jointPositions }
                  }))
                });
              }
            }}
          >
            Don't Save
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              // Cancel - go back to editing
              setShowExitConfirmDialog(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              // Save - show save dialog
              setShowExitConfirmDialog(false);
              setShowSaveDialog(true);
              setSaveAsNew(lastSaveChoice === 'new');
              setNewEpisodeName(`Episode ${episode?.number ? episode.number - 1 : allEpisodes.length} (edited)`);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const contentWithDialog = (
    <>
      {content}
      {saveDialog}
      {exitConfirmDialog}
    </>
  );

  if (inline) {
    return contentWithDialog;
  }

  return typeof window !== 'undefined' ? createPortal(contentWithDialog, document.body) : null;
};
