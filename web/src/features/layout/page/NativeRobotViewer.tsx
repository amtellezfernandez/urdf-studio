import { useEffect, useRef, useState } from "react";

export type NativeRobotFormat = "MJCF" | "USD";

export type NativeRobotSource = {
  format: NativeRobotFormat;
  files: File[];
  primaryPath: string;
  label: string;
  url?: string;
};

type NativeRobotViewerProps = {
  source: NativeRobotSource;
  onLoaded?: () => void;
};

const pathForFile = (file: File): string =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

export const NativeRobotViewer = ({ source, onLoaded }: NativeRobotViewerProps) => {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [axisNotice, setAxisNotice] = useState<string | null>(null);

  useEffect(() => {
    setReady(false);
    setError(null);
    setAxisNotice(null);
  }, [source]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "IFRAME_READY") setReady(true);
      if (event.data?.type === "USD_AXIS_ADAPTER") {
        const adapter = event.data;
        const source = adapter.sourceUpAxis ? String(adapter.sourceUpAxis).toUpperCase() : "?";
        const target = adapter.targetUpAxis ? String(adapter.targetUpAxis).toUpperCase() : "Z";
        setAxisNotice(adapter.warning || `Axis ${source} → ${target}`);
        if (adapter.warning) console.warn(adapter.warning);
      }
      if (event.data?.type === "SCENE_LOADED" || event.data?.type === "USD_LOADED") onLoaded?.();
      if (event.data?.type === "ERROR") setError(String(event.data.error));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onLoaded]);

  useEffect(() => {
    if (!ready || !frameRef.current?.contentWindow) return;
    const target = frameRef.current.contentWindow;
    if (source.url && source.format === "USD") {
      target.postMessage({ type: "USD_LOAD_URL", url: source.url }, "*");
      return;
    }
    void Promise.all(
      source.files.map(async (file) => ({
        path: pathForFile(file),
        buffer: await file.arrayBuffer(),
      }))
    ).then((entries) => {
      if (source.format === "USD") {
        target.postMessage(
          { type: "USD_LOAD_ENTRIES", entries, primaryPath: source.primaryPath },
          "*",
          entries.map((entry) => entry.buffer)
        );
      } else {
        const primary = entries.find((entry) => entry.path === source.primaryPath);
        if (!primary) throw new Error(`Primary MJCF file not found: ${source.primaryPath}`);
        target.postMessage(
          {
            type: "LOAD_SCENE",
            root: source.primaryPath,
            xml: new TextDecoder().decode(primary.buffer),
            files: entries,
          },
          "*",
          entries.map((entry) => entry.buffer)
        );
      }
    }).catch((loadError) => setError(String(loadError)));
  }, [ready, source]);

  const frameSrc = source.format === "USD" ? "/usd-viewer/usd.html" : "/mujoco/mujoco.html";
  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <iframe
        ref={frameRef}
        title={`${source.format} preview for ${source.label}`}
        src={frameSrc}
        className="h-full w-full border-0"
        allow="fullscreen"
      />
      {!ready ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-border/40 bg-background/85 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm">
          Loading {source.format} scene…
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-destructive/40 bg-background/95 p-3 text-xs text-destructive shadow-lg">
          {source.format} scene failed to load: {error}
        </div>
      ) : null}
      {axisNotice && source.format === "USD" ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-border/50 bg-background/85 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
          {axisNotice}
        </div>
      ) : null}
    </div>
  );
};
