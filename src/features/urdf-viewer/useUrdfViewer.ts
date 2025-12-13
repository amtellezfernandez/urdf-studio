import { useCallback, useState } from "react";
import type { CollisionVisibility } from "@/components/LinkEditor";
import type { WindowWithViewerHandlers } from "@/pages/index/types";

export const useUrdfViewer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAnimationFrames, setHasAnimationFrames] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [rotationPlaneVisible, setRotationPlaneVisible] = useState(false);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});
  const [viewerSplitView, setViewerSplitView] = useState(false);

  const handleMotionDataUpload = useCallback((file: File) => {
    (window as WindowWithViewerHandlers).viewer3dUploadMotionData?.(file);
  }, []);

  const handlePlayAnimation = useCallback(() => {
    (window as WindowWithViewerHandlers).viewer3dPlayAnimation?.();
  }, []);

  const handleFrameChange = useCallback((frame: number, total: number) => {
    setCurrentFrame(frame);
    setTotalFrames(total);
  }, []);

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

