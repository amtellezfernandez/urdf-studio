import { useEffect, useRef } from "react";
import { convertMotionFramesToNodes } from "@/features/viewer/convertMotionFramesToNodes";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { Edge, Node } from "reactflow";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

type UsePlaybackNotificationsParams = {
  animationFrames: AnimationFrame[] | null;
  isPlaying: boolean;
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;
  onAnimationFramesChange?: (hasFrames: boolean) => void;
  onMotionDataNodesGenerated?: (nodes: Node[], edges: Edge[]) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onFrameChange?: (currentFrame: number, totalFrames?: number) => void;
  onJointChange?: (jointName: string, value: number) => void;
};

export const usePlaybackNotifications = ({
  animationFrames,
  isPlaying,
  currentFrame,
  setCurrentFrame,
  onAnimationFramesChange,
  onMotionDataNodesGenerated,
  onPlayingChange,
  onFrameChange,
  onJointChange,
}: UsePlaybackNotificationsParams) => {
  const previousFramesRef = useRef<AnimationFrame[] | null>(null);
  const setPlaybackIsPlaying = useViewerPlaybackStore((state) => state.setIsPlaying);
  const setPlaybackHasFrames = useViewerPlaybackStore((state) => state.setHasFrames);
  const setPlaybackFrameInfo = useViewerPlaybackStore((state) => state.setFrameInfo);

  useEffect(() => {
    if (previousFramesRef.current === animationFrames) {
      return;
    }

    previousFramesRef.current = animationFrames;
    const hasFrames = animationFrames !== null && animationFrames.length > 0;

    setPlaybackHasFrames(hasFrames);
    onAnimationFramesChange?.(hasFrames);

    if (!hasFrames) {
      setCurrentFrame(0);
      setPlaybackFrameInfo(0, 0);
      return;
    }

    setPlaybackFrameInfo(currentFrame, animationFrames.length);
  }, [
    animationFrames,
    onAnimationFramesChange,
    setCurrentFrame,
    setPlaybackFrameInfo,
    setPlaybackHasFrames,
    currentFrame,
  ]);

  useEffect(() => {
    if (!onMotionDataNodesGenerated) return;
    if (!animationFrames || animationFrames.length === 0) {
      onMotionDataNodesGenerated([], []);
      return;
    }
    const { nodes, edges } = convertMotionFramesToNodes({
      frames: animationFrames,
      onJointChange,
    });
    onMotionDataNodesGenerated(nodes, edges);
  }, [animationFrames, onJointChange, onMotionDataNodesGenerated]);

  useEffect(() => {
    setPlaybackIsPlaying(isPlaying);
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange, setPlaybackIsPlaying]);

  useEffect(() => {
    if (animationFrames && animationFrames.length > 0) {
      setPlaybackFrameInfo(currentFrame, animationFrames.length);
      onFrameChange?.(currentFrame, animationFrames.length);
    }
  }, [currentFrame, animationFrames, onFrameChange, setPlaybackFrameInfo]);
};
