import { ChevronsRight } from "lucide-react";
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import type { AssemblyInspectorData } from "@/features/assembly/inspector/buildAssemblyInspectorData";
import { SidebarDock } from "@/features/layout/page/SidebarDock";
import { TOP_NAV_HEIGHT, VIEWPORT_HEIGHT_WITH_TOP_NAV } from "@/features/layout/page/constants";
import { applySubstitutionSubtree } from "@/features/assembly/substitution/substitutionSubtree";
import type {
  AssemblySubstitutionApplyHandler,
  AssemblySubstitutionSession,
} from "@/features/assembly/workspace/assemblyWorkspaceTypes";

type AssemblyLeftUnionPanelProps = {
  assemblyInspector: AssemblyInspectorData | null;
  hasPhysicalContact: boolean;
  contactPairCount: number;
  proposalRequested: boolean;
  onRequestProposal: () => void;
  substitutionSession?: AssemblySubstitutionSession | null;
  onApplySubstitution?: AssemblySubstitutionApplyHandler;
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  onToggleCollapse: () => void;
  onSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export const AssemblyLeftUnionPanel = ({
  assemblyInspector,
  hasPhysicalContact,
  contactPairCount,
  proposalRequested,
  onRequestProposal,
  substitutionSession,
  onApplySubstitution,
  sidebarWidth,
  isSidebarCollapsed,
  onToggleCollapse,
  onSidebarResizeStart,
}: AssemblyLeftUnionPanelProps) => {
  const union = assemblyInspector?.union;
  const links = union?.links ?? [];
  const joints = union?.joints ?? [];
  const rawSuggestions = assemblyInspector?.attachmentSuggestions;
  const suggestions = useMemo(() => rawSuggestions ?? [], [rawSuggestions]);
  const [selectionOverrides, setSelectionOverrides] = useState<
    Record<string, { parentLink: string; childLink: string }>
  >({});
  const [selectedHostRootLink, setSelectedHostRootLink] = useState("");
  const [selectedReplacementRootLink, setSelectedReplacementRootLink] = useState("");

  useEffect(() => {
    setSelectionOverrides((current) => {
      const next: Record<string, { parentLink: string; childLink: string }> = {};
      suggestions.forEach((suggestion) => {
        const existing = current[suggestion.id];
        const parentLink =
          existing?.parentLink && suggestion.parentLinkOptions.includes(existing.parentLink)
            ? existing.parentLink
            : suggestion.parentLink;
        const childLink =
          existing?.childLink && suggestion.childLinkOptions.includes(existing.childLink)
            ? existing.childLink
            : suggestion.childLink;
        next[suggestion.id] = { parentLink, childLink };
      });
      return next;
    });
  }, [suggestions]);

  useEffect(() => {
    const preferredHostLink = substitutionSession?.hostLinkOptions[0] ?? "";
    setSelectedHostRootLink((current) =>
      current && substitutionSession?.hostLinkOptions.includes(current) ? current : preferredHostLink
    );
  }, [substitutionSession]);

  useEffect(() => {
    const replacementOptions = substitutionSession?.replacementRootLinkOptions ?? [];
    const preferredReplacementLink = replacementOptions[0] ?? "";
    setSelectedReplacementRootLink((current) =>
      current && replacementOptions.includes(current) ? current : preferredReplacementLink
    );
  }, [substitutionSession]);

  const jointXmlBySuggestion = useMemo(() => {
    const sanitize = (value: string, fallback: string) =>
      value
        .trim()
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "") || fallback;
    const formatNumber = (value: number) => {
      if (Number.isInteger(value)) return `${value}`;
      return value.toFixed(4).replace(/\.?0+$/, "");
    };
    const next = new Map<string, string>();
    suggestions.forEach((suggestion) => {
      const resolvedParentLink =
        selectionOverrides[suggestion.id]?.parentLink || suggestion.parentLink;
      const resolvedChildLink = selectionOverrides[suggestion.id]?.childLink || suggestion.childLink;
      const jointName = sanitize(
        `${suggestion.jointName}__${resolvedParentLink}__${resolvedChildLink}`,
        "assembly_fixed_joint"
      );
      const xyz = suggestion.origin.xyz.map(formatNumber).join(" ");
      const rpy = suggestion.origin.rpy.map(formatNumber).join(" ");
      next.set(
        suggestion.id,
        `<joint name="${jointName}" type="fixed">\n  <parent link="${resolvedParentLink}"/>\n  <child link="${resolvedChildLink}"/>\n  <origin xyz="${xyz}" rpy="${rpy}"/>\n</joint>`
      );
    });
    return next;
  }, [selectionOverrides, suggestions]);

  const handleCopyJointXml = async (suggestionId: string) => {
    const jointXml = jointXmlBySuggestion.get(suggestionId);
    if (!jointXml) return;
    try {
      await navigator.clipboard.writeText(jointXml);
      toast.success("Joint proposal copied.");
    } catch {
      toast.error("Could not copy joint proposal.");
    }
  };

  const substitutionPreview = useMemo(() => {
    if (
      !substitutionSession ||
      !selectedHostRootLink ||
      !selectedReplacementRootLink ||
      !substitutionSession.hostUrdfContent.trim() ||
      !substitutionSession.replacementUrdfContent.trim()
    ) {
      return null;
    }
    try {
      return applySubstitutionSubtree({
        hostUrdfContent: substitutionSession.hostUrdfContent,
        replacementUrdfContent: substitutionSession.replacementUrdfContent,
        hostRootLink: selectedHostRootLink,
        replacementRootLink: selectedReplacementRootLink,
        replacementUrdfPath: substitutionSession.replacementUrdfPath,
        packageRoots: substitutionSession.packageRoots,
      }).preview;
    } catch {
      return null;
    }
  }, [selectedHostRootLink, selectedReplacementRootLink, substitutionSession]);

  return (
    <SidebarDock
      side="left"
      sidebarWidth={sidebarWidth}
      isCollapsed={isSidebarCollapsed}
      onToggleCollapse={onToggleCollapse}
      onResizeStart={onSidebarResizeStart}
      collapseButtonLabel="Union"
      resizeAriaLabel="Resize assembly union panel"
      CollapseIcon={ChevronsRight}
    >
      <div
        className="fixed left-0 z-30 flex flex-col border-r border-border/35 bg-background/95 shadow-xl backdrop-blur-sm transition-transform duration-200 ease-out"
        style={{
          width: sidebarWidth,
          top: TOP_NAV_HEIGHT,
          height: VIEWPORT_HEIGHT_WITH_TOP_NAV,
          transform: isSidebarCollapsed ? "translateX(-100%)" : undefined,
          pointerEvents: isSidebarCollapsed ? "none" : "auto",
        }}
        aria-hidden={isSidebarCollapsed}
      >
        <div className="border-b border-border/35 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            {substitutionSession ? "Substitution" : "Proposed Union"}
          </div>
          <div className="mt-1 text-xs text-foreground">
            {substitutionSession ? "Replace host robot content" : "Merged assembly structure"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {`${links.length} links • ${joints.length} joints`}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {`Contact pairs: ${contactPairCount}`}
          </div>
          {proposalRequested && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {`Attachment suggestions: ${suggestions.length}`}
            </div>
          )}
          {proposalRequested && hasPhysicalContact && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onRequestProposal}
                className="rounded-sm border border-border/55 bg-muted/45 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Regenerate Proposal
              </button>
            </div>
          )}
        </div>
        {substitutionSession ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <div className="w-full max-w-[20rem] rounded-sm border border-border/30 bg-background/60 px-3 py-3">
              <div className="text-xs text-foreground">
                {`${substitutionSession.hostRobotName} <- ${substitutionSession.replacementRobotName}`}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Choose the host subtree root and the replacement subtree root before applying.
              </div>
              <label className="mt-3 flex flex-col gap-1 text-[11px]">
                <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Host Target Link
                </span>
                <select
                  value={selectedHostRootLink}
                  onChange={(event) => setSelectedHostRootLink(event.target.value)}
                  className="rounded-sm border border-border/45 bg-background px-1.5 py-1 text-[11px] text-foreground"
                >
                  {substitutionSession.hostLinkOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 flex flex-col gap-1 text-[11px]">
                <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Replacement Root Link
                </span>
                <select
                  value={selectedReplacementRootLink}
                  onChange={(event) => setSelectedReplacementRootLink(event.target.value)}
                  className="rounded-sm border border-border/45 bg-background px-1.5 py-1 text-[11px] text-foreground"
                >
                  {substitutionSession.replacementRootLinkOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              {substitutionPreview ? (
                <div className="mt-3 rounded-sm border border-border/25 bg-background/70 px-2 py-2 text-[11px] text-muted-foreground">
                  <div>{`Replace ${substitutionPreview.replacedLinkCount} host link(s) / ${substitutionPreview.replacedJointCount} joint(s)`}</div>
                  <div>{`Import ${substitutionPreview.importedLinkCount} replacement link(s) / ${substitutionPreview.importedJointCount} joint(s)`}</div>
                  <div>{`Mesh path rewrites: ${substitutionPreview.rewrittenMeshPaths.length}`}</div>
                  <div>{`Imported materials: ${substitutionPreview.importedMaterialCount}`}</div>
                  <div>{`Imported transmissions: ${substitutionPreview.importedTransmissionCount}`}</div>
                  <div>{`Imported gazebo blocks: ${substitutionPreview.importedGazeboCount}`}</div>
                  {substitutionPreview.renamedLinks.length > 0 ? (
                    <div>{`Renamed links: ${substitutionPreview.renamedLinks.length}`}</div>
                  ) : null}
                  {substitutionPreview.renamedJoints.length > 0 ? (
                    <div>{`Renamed joints: ${substitutionPreview.renamedJoints.length}`}</div>
                  ) : null}
                  {substitutionPreview.renamedMaterials.length > 0 ? (
                    <div>{`Renamed materials: ${substitutionPreview.renamedMaterials.length}`}</div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 rounded-sm border border-border/25 bg-background/70 px-2 py-2 text-[11px] text-muted-foreground">
                  Preview unavailable for the current link selection.
                </div>
              )}
              <button
                type="button"
                onClick={() => onApplySubstitution?.(selectedHostRootLink, selectedReplacementRootLink)}
                disabled={!substitutionPreview}
                className="mt-3 w-full rounded-sm border border-border/60 bg-muted/55 px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Apply Replacement
              </button>
            </div>
          </div>
        ) : !proposalRequested ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <div className="w-full max-w-[20rem] rounded-sm border border-border/30 bg-background/60 px-3 py-3">
              <div className="text-xs text-foreground">
                {hasPhysicalContact ? "Contact detected." : "No contact detected yet."}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Generate a proposed merged assembly from the current robot positions.
                {!hasPhysicalContact ? " We will use a heuristic suggestion." : ""}
              </div>
              <button
                type="button"
                onClick={onRequestProposal}
                className="mt-3 w-full rounded-sm border border-border/60 bg-muted/55 px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Propose Merged Assembly
              </button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,auto)_minmax(10rem,1fr)] gap-2 p-2">
            <section className="flex min-h-0 flex-col rounded-sm border border-border/30 bg-background/60">
              <div className="border-b border-border/25 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Suggested Attachments
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {!hasPhysicalContact && (
                  <div className="mb-2 rounded-sm border border-border/25 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                    Contact not detected. Suggestions are heuristic until robots touch.
                  </div>
                )}
                {suggestions.length === 0 ? (
                  <div className="rounded-sm border border-border/25 bg-background/70 px-2 py-2 text-[11px] text-muted-foreground">
                    No attachment suggestion available yet. Move robots until contacts are stable.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {suggestions.map((suggestion) => {
                      const selectedLinks = selectionOverrides[suggestion.id];
                      const selectedParentLink = selectedLinks?.parentLink ?? suggestion.parentLink;
                      const selectedChildLink = selectedLinks?.childLink ?? suggestion.childLink;
                      return (
                        <div
                          key={suggestion.id}
                          className="rounded-sm border border-border/25 bg-background/70 px-2 py-2 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-foreground">
                              {`${suggestion.parentRobotName} → ${suggestion.childRobotName}`}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                              {suggestion.confidence}
                            </div>
                          </div>
                          <div className="mt-1 text-muted-foreground">{suggestion.reason}</div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="flex min-w-0 flex-col gap-1">
                              <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                                Parent Link
                              </span>
                              <select
                                value={selectedParentLink}
                                onChange={(event) =>
                                  setSelectionOverrides((current) => ({
                                    ...current,
                                    [suggestion.id]: {
                                      parentLink: event.target.value,
                                      childLink: selectedChildLink,
                                    },
                                  }))
                                }
                                className="truncate rounded-sm border border-border/45 bg-background px-1.5 py-1 text-[11px] text-foreground"
                              >
                                {suggestion.parentLinkOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex min-w-0 flex-col gap-1">
                              <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                                Child Link
                              </span>
                              <select
                                value={selectedChildLink}
                                onChange={(event) =>
                                  setSelectionOverrides((current) => ({
                                    ...current,
                                    [suggestion.id]: {
                                      parentLink: selectedParentLink,
                                      childLink: event.target.value,
                                    },
                                  }))
                                }
                                className="truncate rounded-sm border border-border/45 bg-background px-1.5 py-1 text-[11px] text-foreground"
                              >
                                {suggestion.childLinkOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {`origin xyz="${suggestion.origin.xyz.join(" ")}" rpy="${suggestion.origin.rpy.join(" ")}"`}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyJointXml(suggestion.id)}
                              className="shrink-0 rounded-sm border border-border/50 bg-muted/45 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted"
                            >
                              Copy Joint XML
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
            <section className="flex min-h-0 flex-col rounded-sm border border-border/30 bg-background/60">
              <div className="border-b border-border/25 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Links
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 text-[11px] leading-relaxed text-foreground/90">
                {links.length === 0 ? (
                  <div className="text-muted-foreground">No links available.</div>
                ) : (
                  links.map((linkName) => (
                    <div key={linkName} className="truncate font-mono">
                      {linkName}
                    </div>
                  ))
                )}
                <div className="mt-2 border-t border-border/25 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Joints
                </div>
                {joints.length === 0 ? (
                  <div className="text-muted-foreground">No joints available.</div>
                ) : (
                  joints.map((jointName) => (
                    <div key={jointName} className="truncate font-mono">
                      {jointName}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </SidebarDock>
  );
};
