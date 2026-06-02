import { useMemo } from "react";

import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { FeatureGate } from "@/shared/config/featureGates";
import type { FeatureGateAvailability } from "@/shared/lib/featureGateUi";
import { getFeatureGateUiState } from "@/shared/lib/featureGateUi";
import type {
  WorldScenePackageListEntry,
} from "@/features/world-share/worldScenePackageTypes";

type WorldRegistryPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: WorldScenePackageListEntry[];
  filterText: string;
  onFilterTextChange: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  onLoadPackage: (entry: WorldScenePackageListEntry) => void;
  gate?: FeatureGate | FeatureGateAvailability;
};

const TRUST_BADGE_CLASS_BY_LEVEL = {
  metadata_complete: "bg-emerald-600/20 text-emerald-300 border-emerald-500/40",
  signed_metadata: "bg-amber-500/20 text-amber-200 border-amber-400/40",
  metadata_only: "bg-zinc-700/50 text-zinc-300 border-zinc-500/40",
} as const;

type TrustLevel = keyof typeof TRUST_BADGE_CLASS_BY_LEVEL;
const DEFAULT_TRUST_LEVEL: TrustLevel = "metadata_only";

const TRUST_LABEL_BY_LEVEL: Record<TrustLevel, string> = {
  metadata_complete: "metadata-complete",
  signed_metadata: "signed-metadata",
  metadata_only: "metadata-only",
};

const resolveTrustLevel = (trustLevel: string): TrustLevel => {
  if (trustLevel in TRUST_BADGE_CLASS_BY_LEVEL) {
    return trustLevel as TrustLevel;
  }
  return DEFAULT_TRUST_LEVEL;
};

const formatTimestamp = (iso: string) => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
};

export const WorldRegistryPanel = ({
  open,
  onOpenChange,
  entries,
  filterText,
  onFilterTextChange,
  loading,
  onRefresh,
  onLoadPackage,
  gate,
}: WorldRegistryPanelProps) => {
  const refreshGateUi = gate
    ? getFeatureGateUiState("Refresh", gate)
    : { label: "Refresh", disabled: false, title: undefined };
  const loadGateUi = gate
    ? getFeatureGateUiState("Load", gate)
    : { label: "Load", disabled: false, title: undefined };
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedFilter) return entries;
    return entries.filter((entry) => {
      const runtimeTargets = entry.runtime_targets.join(" ").toLowerCase();
      return (
        entry.package_id.toLowerCase().includes(normalizedFilter) ||
        entry.title.toLowerCase().includes(normalizedFilter) ||
        entry.latest_version.toLowerCase().includes(normalizedFilter) ||
        runtimeTargets.includes(normalizedFilter)
      );
    });
  }, [entries, normalizedFilter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl bg-[#1f1f1f] border-[#3d3d3d] text-[#d4d4d4]">
        <DialogHeader>
          <DialogTitle className="text-[#f0f0f0]">World Registry</DialogTitle>
          <DialogDescription className="text-[#a8a8a8]">
            Browse published world packages and load them directly into the workspace.
          </DialogDescription>
          {gate && !gate.enabled ? (
            <DialogDescription className="text-amber-500">
              {gate.disabledBadge}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="flex items-center gap-2">
          <input
            value={filterText}
            onChange={(event) => onFilterTextChange(event.target.value)}
            placeholder="Filter by package, version, runtime target..."
            className="h-9 flex-1 rounded-md border border-[#3d3d3d] bg-[#252526] px-3 text-sm text-[#e2e2e2] outline-none focus:border-[#5a5a5a]"
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
            onClick={onRefresh}
            disabled={loading || refreshGateUi.disabled}
            title={refreshGateUi.title}
          >
            {loading ? "Refreshing..." : refreshGateUi.label}
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border border-[#3d3d3d]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#2a2a2a] text-[#b9b9b9]">
              <tr>
                <th className="px-3 py-2 font-medium">Package</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Runtime Targets</th>
                <th className="px-3 py-2 font-medium">Trust</th>
                <th className="px-3 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => {
                const key = `${entry.package_id}@${entry.latest_version}`;
                const runtimeTargets = entry.runtime_targets;
                const trustLevel = resolveTrustLevel(entry.trust_level);
                const trustLabel = TRUST_LABEL_BY_LEVEL[trustLevel];
                return (
                  <tr key={key} className="border-t border-[#333333]">
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#f2f2f2]">{entry.package_id}</div>
                      <div className="text-[#9e9e9e]">{entry.title}</div>
                    </td>
                    <td className="px-3 py-2 text-[#e3e3e3]">{entry.latest_version}</td>
                    <td className="px-3 py-2 text-[#c5c5c5]">{formatTimestamp(entry.updated_at)}</td>
                    <td className="px-3 py-2 text-[#c5c5c5]">
                      {runtimeTargets.length > 0
                        ? runtimeTargets.join(", ")
                        : "n/a"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={TRUST_BADGE_CLASS_BY_LEVEL[trustLevel]}
                      >
                        {trustLabel}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
                        onClick={() => onLoadPackage(entry)}
                        disabled={loadGateUi.disabled}
                        title={loadGateUi.title}
                      >
                        {loadGateUi.label}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[#9f9f9f]">
                    {loading ? "Loading world registry..." : "No world packages found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
