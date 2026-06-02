export const isPageVisible = (): boolean =>
  document.visibilityState !== "hidden";

export const addPageVisibilityListener = (listener: () => void): (() => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
  };
};

export const startVisiblePageInterval = (
  callback: () => void,
  intervalMs: number
): (() => void) => {
  const runIfVisible = () => {
    if (isPageVisible()) {
      callback();
    }
  };
  const removeVisibilityListener = addPageVisibilityListener(runIfVisible);
  const intervalId = window.setInterval(runIfVisible, intervalMs);
  runIfVisible();

  return () => {
    removeVisibilityListener();
    window.clearInterval(intervalId);
  };
};
