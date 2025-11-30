import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Minimize2,
  Maximize2,
  GripHorizontal,
  Eye,
  LayoutGrid,
  Square,
  Pencil,
  X,
  Save,
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
const TIMELINE_HEADER_HEIGHT = 60; // Height of the top area where dragging is allowed (FRAME/SECS area)
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
  isMinimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  onSaveEpisode?: (episode: Episode, saveAsNew: boolean, newName?: string) => void; // Callback to save/update episode
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

// Helper to update frame in 3D viewer (for timeline scrubbing)
// This does NOT reload the episode, just sets the frame and ensures playback is stopped
// NOTE: We only call viewer3dStopAnimation, NOT viewer3dPlayAnimation(false)
// because the parent's onSetGlobalFrame will call stopAllPlayback() which clears frames,
// and calling viewer3dPlayAnimation with cleared frames would trigger "upload data first" error
const updateViewerFrame = (frame: number) => {
  (window as any).viewer3dSetFrame?.(frame);
  (window as any).viewer3dStopAnimation?.();
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
  onToggleViewMode,
  isMinimized = false,
  onMinimizedChange,
  onSaveEpisode,
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
  
  // Edit mode states
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingJoint, setEditingJoint] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);
  const [modifiedEpisode, setModifiedEpisode] = useState<Episode | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [newEpisodeName, setNewEpisodeName] = useState("");
  
  // Tangent handles state: Map<pointIndex, {left: {x, y, value, length}, right: {x, y, value, length}}>
  // x, y are screen coordinates, value is the joint value at that handle position, length is distance from point
  const [tangentHandles, setTangentHandles] = useState<Map<number, {
    left: {x: number, y: number, value: number, length: number}, 
    right: {x: number, y: number, value: number, length: number}
  }>>(new Map());
  const [draggingHandle, setDraggingHandle] = useState<{pointIndex: number, side: 'left' | 'right'} | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingTimelineRef = useRef<boolean>(false);
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
  const preservedFrameRef = useRef<number | null>(null);
  
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

  // Helper to check if episode has been modified
  const hasChanges = useMemo(() => {
    if (!episode || !modifiedEpisode) return false;
    if (episode.frames.length !== modifiedEpisode.frames.length) return true;
    
    for (let i = 0; i < episode.frames.length; i++) {
      const original = episode.frames[i];
      const modified = modifiedEpisode.frames[i];
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
      setModifiedEpisode({
        ...episode,
        frames: episode.frames.map(f => ({
          ...f,
          jointPositions: { ...f.jointPositions }
        }))
      });
    }
    // Reset edit mode when episode changes
    setIsEditMode(false);
    setEditingJoint(null);
    setSelectedPointIndex(null);
    setTangentHandles(new Map());
    setShowSaveDialog(false);
    setSaveAsNew(false);
    setNewEpisodeName("");
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
  }, [isEditMode, editingJoint, modifiedEpisode]);

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

    setModifiedEpisode({
      ...modifiedEpisode,
      frames: updatedFrames
    });
  }, [isEditMode, editingJoint, episode, modifiedEpisode, selectedPointIndex, isDraggingPoint, jointRanges, tangentHandles]);

  // Handle curve editing - mouse up
  const handleCurveMouseUp = useCallback(() => {
    setIsDraggingPoint(false);
    setDraggingHandle(null);
  }, []);


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

    setModifiedEpisode({
      ...modifiedEpisode,
      frames: updatedFrames
    });
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
      const displayColor = isEditMode 
        ? (isEditingThisJoint ? color : "#404040") // Dark grey for non-edited
        : color;

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
  }, [episode, currentFrame, globalCurrentFrame, selectedJoints, jointNames, jointRanges, jointColorMap, size, calculateTime, isEditMode, editingJoint, selectedPointIndex, modifiedEpisode, tangentHandles]);

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

  // Minimized view - always centered at bottom regardless of inline or floating
  if (isMinimized) {
    const currentTime = episode ? calculateTime(displayFrame).replace('s', '') : "0.00";
    const minimizedContent = (
      <div
        className="bg-muted/95 backdrop-blur-sm border border-border rounded-lg shadow-xl px-3 py-2 fixed left-1/2 -translate-x-1/2"
        style={{
          bottom: '20px',
          zIndex: 99999,
          maxWidth: '95vw',
        }}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Episode Info */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <h3 className="text-sm font-semibold whitespace-nowrap">Episode {episode.number}</h3>
            {episode.metadata?.additional?.sourceType && (
              <div className="flex items-center gap-1">
                <Badge
                  variant={
                    episode.metadata.additional.sourceType === 'hf'
                      ? 'default'
                      : episode.metadata.additional.sourceType === 'local'
                      ? 'secondary'
                      : 'outline'
                  }
                  className="text-[10px] px-1.5 py-0 h-4 whitespace-nowrap"
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
                    className="text-[10px] px-1.5 py-0 h-4 whitespace-nowrap max-w-[100px] truncate"
                    title={episode.metadata.additional.sourceName}
                  >
                    {episode.metadata.additional.sourceName}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Frame Counter */}
          <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs whitespace-nowrap">
            <span className="text-muted-foreground">Frame:</span>
            <span className="font-mono font-medium">{displayFrame}</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono text-muted-foreground">{totalFrames}</span>
          </div>

          {/* Time Display */}
          <div className="flex items-center gap-1 px-2 py-1 bg-background rounded border text-xs whitespace-nowrap">
            <span className="text-muted-foreground">Time:</span>
            <span className="font-mono font-medium">
              {episode ? `${currentTime} / ${durationSeconds} s` : "0.00 / 0.00 s"}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
            {onToggleViewMode && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={onToggleViewMode}
                  >
                    {inline ? (
                      <Square className="w-3.5 h-3.5" />
                    ) : (
                      <LayoutGrid className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{inline ? "Switch to Floating Window" : "Switch to Split View"}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => onMinimizedChange?.(false)}
                >
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Restore</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    );

    // Always use portal to render at document.body level for consistent positioning
    return typeof window !== 'undefined' ? createPortal(minimizedContent, document.body) : null;
  }

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
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
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
                      setNewEpisodeName(`Episode ${episode?.number || allEpisodes.length + 1} (edited)`);
                    }
                  }}
                  disabled={!hasChanges || !modifiedEpisode || !onSaveEpisode}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  <span className="text-xs">Save</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save Changes</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Edit Mode Toggle */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={isEditMode ? "default" : "ghost"}
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isEditMode) {
                    // Check if there are changes before exiting
                    if (hasChanges && modifiedEpisode && onSaveEpisode) {
                      // Show save dialog
                      setShowSaveDialog(true);
                      setSaveAsNew(false);
                      setNewEpisodeName(`Episode ${episode?.number || allEpisodes.length + 1} (edited)`);
                    } else {
                      // No changes, just exit
                      setIsEditMode(false);
                      setEditingJoint(null);
                      setSelectedPointIndex(null);
                      setTangentHandles(new Map());
                    }
                  } else {
                    // Enter edit mode - select first visible joint
                    const firstVisibleJoint = jointNames.find(name => selectedJoints.has(name));
                    if (firstVisibleJoint) {
                      setIsEditMode(true);
                      setEditingJoint(firstVisibleJoint);
                    }
                  }
                }}
                disabled={jointNames.length === 0}
              >
                {isEditMode ? (
                  <X className="w-3.5 h-3.5" />
                ) : (
                  <Pencil className="w-3.5 h-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isEditMode ? "Exit Edit Mode" : "Edit Curves"}</p>
            </TooltipContent>
          </Tooltip>
          {onToggleViewMode && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleViewMode();
                  }}
                >
                  {inline ? (
                    <Square className="w-3 h-3" />
                  ) : (
                    <LayoutGrid className="w-3 h-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{inline ? "Switch to Floating Window" : "Switch to Split View"}</p>
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
                  onMinimizedChange?.(true);
                }}
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Minimize</p>
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
                    const activeEpisode = (isEditMode && modifiedEpisode) ? modifiedEpisode : episode;
                    const currentValue = activeEpisode.frames[displayFrame]?.jointPositions[jointName];
                    const isEditingThisJoint = isEditMode && editingJoint === jointName;

                    return (
                      <div
                        key={jointName}
                        className={cn(
                          "min-w-0 cursor-pointer hover:bg-muted/30 rounded px-1 py-0.5 transition-colors",
                          isEditingThisJoint && "bg-muted/50 border border-primary/50"
                        )}
                        onClick={() => {
                          if (isEditMode) {
                            // In edit mode, clicking selects which joint to edit
                            // Make sure the joint is visible first
                            if (!isVisible) {
                              const newSelected = new Set(selectedJoints);
                              newSelected.add(jointName);
                              setSelectedJoints(newSelected);
                            }
                            setEditingJoint(jointName);
                            setSelectedPointIndex(null);
                            setTangentHandles(new Map()); // Clear handles when switching joints
                          } else {
                            // Normal mode: toggle visibility
                            const newSelected = new Set(selectedJoints);
                            if (isVisible) {
                              newSelected.delete(jointName);
                            } else {
                              newSelected.add(jointName);
                            }
                            setSelectedJoints(newSelected);
                          }
                        }}
                      >
                        <div className="text-xs font-mono truncate leading-tight flex items-center gap-1" style={{ color: displayColor }}>
                          {jointName}
                          {isEditingThisJoint && <Pencil className="w-3 h-3" />}
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

  // Save Dialog
  const handleSave = useCallback(() => {
    if (!modifiedEpisode || !onSaveEpisode) return;
    
    if (saveAsNew && newEpisodeName.trim()) {
      // Save as new episode
      onSaveEpisode(modifiedEpisode, true, newEpisodeName.trim());
    } else if (!saveAsNew) {
      // Overwrite existing episode
      onSaveEpisode(modifiedEpisode, false);
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

  const contentWithDialog = (
    <>
      {content}
      {saveDialog}
    </>
  );

  if (inline) {
    return contentWithDialog;
  }

  return typeof window !== 'undefined' ? createPortal(contentWithDialog, document.body) : null;
};
