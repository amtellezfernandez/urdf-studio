import { useCallback, useEffect, useRef } from "react";

export const useDeferredUrdfUpdate = (update: () => void) => {
  const updateRef = useRef(update);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  return useCallback(() => {
    setTimeout(() => updateRef.current(), 0);
  }, []);
};
