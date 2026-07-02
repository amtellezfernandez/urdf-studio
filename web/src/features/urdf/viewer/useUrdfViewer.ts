import { useCallback, useState } from "react";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import type { InertialVisualizationSettings } from "@/shared/types/feature";
import { createDefaultInertialVisualizationSettings } from "@/features/layout/page/simulationPrepViewerState";

export const useUrdfViewer = () => {
  const isPlaying = useViewerPlaybackStore((state) => state.isPlaying);
  const hasAnimationFrames = useViewerPlaybackStore((state) => state.hasFrames);
  const currentFrame = useViewerPlaybackStore((state) => state.currentFrame);
  const totalFrames = useViewerPlaybackStore((state) => state.totalFrames);
  const setIsPlaying = useViewerPlaybackStore((state) => state.setIsPlaying);
  const setHasAnimationFrames = useViewerPlaybackStore((state) => state.setHasFrames);
  const setFrameInfo = useViewerPlaybackStore((state) => state.setFrameInfo);

  const [rotationPlaneVisible, setRotationPlaneVisible] = useState(false);
  const [collisionsVisible, setCollisionsVisible] = useState(false);
  const [collisionSimplifyLinks, setCollisionSimplifyLinks] = useState<string[]>([]);
  const [collisionMergedLinks, setCollisionMergedLinks] = useState<string[]>([]);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});
  const [viewerSplitView, setViewerSplitView] = useState(false);
  const [inertialVisualization, setInertialVisualization] = useState<InertialVisualizationSettings>(
    () => createDefaultInertialVisualizationSettings()
  );

  const handlePlayAnimation = useCallback(() => {
    viewerPlayback.playAnimation();
  }, []);

  const handleFrameChange = useCallback((frame: number, total: number) => {
    setFrameInfo(frame, total);
  }, [setFrameInfo]);

  const setCurrentFrame = useCallback(
    (frame: number) => {
      setFrameInfo(frame);
    },
    [setFrameInfo]
  );

  const setTotalFrames = useCallback(
    (total: number) => {
      setFrameInfo(currentFrame, total);
    },
    [currentFrame, setFrameInfo]
  );

  return {
    // State
    isPlaying,
    hasAnimationFrames,
    currentFrame,
    totalFrames,
    rotationPlaneVisible,
    collisionsVisible,
    collisionSimplifyLinks,
    collisionMergedLinks,
    collisionVisibility,
    viewerSplitView,
    inertialVisualization,
    // Setters
    setIsPlaying,
    setHasAnimationFrames,
    setCurrentFrame,
    setTotalFrames,
    setRotationPlaneVisible,
    setCollisionsVisible,
    setCollisionSimplifyLinks,
    setCollisionMergedLinks,
    setCollisionVisibility,
    setViewerSplitView,
    setInertialVisualization,
    // Handlers
    handlePlayAnimation,
    handleFrameChange,
  };
};
