import { ChevronsLeft } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AssemblyInspectorData } from "@/features/assembly/inspector/buildAssemblyInspectorData";
import { SidebarResizeHandle } from "@/features/layout/page/SidebarResizeHandle";
import { TOP_NAV_HEIGHT, VIEWPORT_HEIGHT_WITH_TOP_NAV } from "@/features/layout/page/constants";
import type { AssemblySubstitutionSession } from "@/features/assembly/workspace/assemblyWorkspaceTypes";

type AssemblyRightRobotsPanelProps = {
  assemblyInspector: AssemblyInspectorData | null;
  onDuplicateAssemblyRobot?: (instanceId: string) => void;
  substitutionSession?: AssemblySubstitutionSession | null;
  rightSidebarWidth: number;
  isRightSidebarCollapsed: boolean;
  onToggleCollapse: () => void;
  onRightSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export const AssemblyRightRobotsPanel = ({
  assemblyInspector,
  onDuplicateAssemblyRobot,
  substitutionSession,
  rightSidebarWidth,
  isRightSidebarCollapsed,
  onToggleCollapse,
  onRightSidebarResizeStart,
}: AssemblyRightRobotsPanelProps) => {
  const robots = assemblyInspector?.robots ?? [];

  return (
    <>
      {!isRightSidebarCollapsed && (
        <div
          className="fixed right-0 z-30 flex h-screen flex-col border-l border-border/35 bg-background/95 backdrop-blur-sm"
          style={{
            width: rightSidebarWidth,
            top: TOP_NAV_HEIGHT,
            height: VIEWPORT_HEIGHT_WITH_TOP_NAV,
          }}
        >
          <div className="border-b border-border/35 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Robots
            </div>
            <div className="mt-1 text-xs text-foreground">Per-robot structure</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {`${robots.length} robot${robots.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {robots.length === 0 ? (
              <div className="text-xs text-muted-foreground">No assembly robots loaded.</div>
            ) : (
              <div className="space-y-2">
                {substitutionSession ? (
                  <div className="rounded-sm border border-border/30 bg-background/60 px-2 py-2 text-[11px] text-muted-foreground">
                    Host and replacement roles are locked for this substitution session.
                  </div>
                ) : null}
                {robots.map((robotInfo) => (
                  <details
                    key={robotInfo.id}
                    open={robotInfo.isPrimary}
                    className="rounded-sm border border-border/30 bg-background/60"
                  >
                    <summary className="cursor-pointer list-none px-2 py-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="truncate text-[11px] font-medium text-foreground">
                          {robotInfo.name}
                        </div>
                        <div className="flex items-center gap-2 pl-1">
                          {robotInfo.role ? (
                            <div className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-foreground">
                              {robotInfo.role}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (substitutionSession) {
                                return;
                              }
                              onDuplicateAssemblyRobot?.(robotInfo.id);
                            }}
                          >
                            Duplicate
                          </button>
                          <div className="whitespace-nowrap text-[10px] text-muted-foreground">
                            {`${robotInfo.links.length}L • ${robotInfo.joints.length}J`}
                          </div>
                        </div>
                      </div>
                    </summary>
                    <div className="grid gap-2 border-t border-border/25 px-2 py-2">
                      <section>
                        <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          Tree
                        </div>
                        <div className="max-h-32 overflow-y-auto text-[11px] text-foreground/90">
                          {robotInfo.treeLines.length === 0 ? (
                            <div className="text-muted-foreground">No tree available.</div>
                          ) : (
                            robotInfo.treeLines.map((line, index) => (
                              <div key={`${robotInfo.id}-tree-${index}`} className="truncate font-mono">
                                {line}
                              </div>
                            ))
                          )}
                        </div>
                      </section>
                      <section>
                        <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          Links
                        </div>
                        <div className="max-h-28 overflow-y-auto text-[11px] text-foreground/90">
                          {robotInfo.links.length === 0 ? (
                            <div className="text-muted-foreground">No links.</div>
                          ) : (
                            robotInfo.links.map((linkName) => (
                              <div key={linkName} className="truncate font-mono">
                                {linkName}
                              </div>
                            ))
                          )}
                        </div>
                      </section>
                      <section>
                        <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          Joints
                        </div>
                        <div className="max-h-28 overflow-y-auto text-[11px] text-foreground/90">
                          {robotInfo.joints.length === 0 ? (
                            <div className="text-muted-foreground">No joints.</div>
                          ) : (
                            robotInfo.joints.map((jointName) => (
                              <div key={jointName} className="truncate font-mono">
                                {jointName}
                              </div>
                            ))
                          )}
                        </div>
                      </section>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!isRightSidebarCollapsed && (
        <SidebarResizeHandle
          side="right"
          sidebarWidth={rightSidebarWidth}
          ariaLabel="Resize assembly robots panel"
          onPointerDown={onRightSidebarResizeStart}
        />
      )}

      {isRightSidebarCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="fixed bottom-6 right-4 z-40 flex items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm shadow-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronsLeft className="h-3 w-3" />
          Robots
        </button>
      )}
    </>
  );
};
