import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";

export const renderWithOptionalProfiler = ({
  enabled,
  id,
  node,
  onRender,
}: {
  enabled: boolean;
  id: string;
  node: ReactNode;
  onRender: ProfilerOnRenderCallback;
}): ReactNode =>
  enabled ? (
    <Profiler id={id} onRender={onRender}>
      {node}
    </Profiler>
  ) : (
    node
  );
