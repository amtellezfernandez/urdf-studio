import { useEffect, useRef } from "react";

export type UseResetPlaybackOnRobotFileChangeOptions = {
  resetPlayback: () => void;
  robotFile: File | null;
};

export const useResetPlaybackOnRobotFileChange = ({
  resetPlayback,
  robotFile,
}: UseResetPlaybackOnRobotFileChangeOptions): void => {
  const resetPlaybackRef = useRef(resetPlayback);
  const previousRobotFileRef = useRef<{
    initialized: boolean;
    robotFile: File | null;
  }>({
    initialized: false,
    robotFile: null,
  });

  useEffect(() => {
    resetPlaybackRef.current = resetPlayback;
  }, [resetPlayback]);

  useEffect(() => {
    const previous = previousRobotFileRef.current;
    if (previous.initialized && previous.robotFile === robotFile) {
      return;
    }
    previousRobotFileRef.current = {
      initialized: true,
      robotFile,
    };
    resetPlaybackRef.current();
  }, [robotFile]);
};
