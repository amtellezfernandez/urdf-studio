import type {
  RosVizMarkerDeltaBatchPayload,
  RosVizMarkerPayload,
} from "@/runtime_engine/rosviz/types";

export type MarkerStoreEntry = {
  marker: RosVizMarkerPayload;
  expiresAtNs: bigint | null;
};

export type MarkerStoreMap = Map<string, MarkerStoreEntry>;

export const markerStoreKey = (namespace: string, markerId: number): string =>
  `${namespace}::${markerId}`;

export const pruneExpiredMarkers = (
  markers: MarkerStoreMap,
  nowNs: bigint
): MarkerStoreMap => {
  let changed = false;
  const next = new Map(markers);
  next.forEach((entry, key) => {
    if (entry.expiresAtNs !== null && entry.expiresAtNs <= nowNs) {
      next.delete(key);
      changed = true;
    }
  });
  return changed ? next : markers;
};

export const applyMarkerDeltaBatch = (
  markers: MarkerStoreMap,
  payload: RosVizMarkerDeltaBatchPayload,
  nowNs: bigint
): MarkerStoreMap => {
  let next = pruneExpiredMarkers(markers, nowNs);
  payload.deltas.forEach((delta) => {
    if (delta.action === "delete_all") {
      next = new Map();
      return;
    }
    if (delta.action === "delete") {
      if (typeof delta.marker_id === "number") {
        const key = markerStoreKey(delta.namespace, delta.marker_id);
        if (next.has(key)) {
          if (next === markers) {
            next = new Map(next);
          }
          next.delete(key);
        }
      }
      return;
    }
    if (delta.action === "add_or_modify" && delta.marker) {
      const marker = delta.marker;
      const key = markerStoreKey(marker.namespace, marker.marker_id);
      const lifetimeMs = Number.isFinite(marker.lifetime_ms)
        ? Math.max(0, marker.lifetime_ms)
        : 0;
      const expiresAtNs =
        lifetimeMs > 0 ? nowNs + BigInt(lifetimeMs) * 1_000_000n : null;
      if (next === markers) {
        next = new Map(next);
      }
      next.set(key, {
        marker,
        expiresAtNs,
      });
    }
  });
  return next;
};
