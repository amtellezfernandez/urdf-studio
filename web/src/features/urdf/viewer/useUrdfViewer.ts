import { useCallback, useState } from "react";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

export const useUrdfViewer = () => {
  const isPlaying = useViewerPlaybackStore((state) => state.isPlaying);
  const hasAnimationFrames = useViewerPlaybackStore((state) => state.hasFrames);
  const currentFrame = useViewerPlaybackStore((state) => state.currentFrame);
  const totalFrames = useViewerPlaybackStore((state) => state.totalFrames);
  const setIsPlaying = useViewerPlaybackStore((state) => state.setIsPlaying);
  const setHasAnimationFrames = useViewerPlaybackStore((state) => state.setHasFrames);
  const setFrameInfo = useViewerPlaybackStore((state) => state.setFrameInfo);

  const [rotationPlaneVisible, setRotationPlaneVisible] = useState(false);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});
  const [viewerSplitView, setViewerSplitView] = useState(false);

  const handleMotionDataUpload = useCallback((file: File) => {
    viewerPlayback.uploadMotionData(file);
  }, []);

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
    collisionVisibility,
    viewerSplitView,
    // Setters
    setIsPlaying,
    setHasAnimationFrames,
    setCurrentFrame,
    setTotalFrames,
    setRotationPlaneVisible,
    setCollisionVisibility,
    setViewerSplitView,
    // Handlers
    handleMotionDataUpload,
    handlePlayAnimation,
    handleFrameChange,
  };
};
