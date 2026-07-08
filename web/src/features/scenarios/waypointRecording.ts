// Waypoint recording types + interpolation, kept in lockstep with the backend
// WaypointPolicy (backend/services/scenario_policies/waypoint.py). The
// interpolation below mirrors WaypointPolicy._interpolate exactly so the
// in-browser replay preview matches backend playback.

export type RecordedKeyframe = {
  time_s: number;
  joints: Record<string, number>;
  attach?: string;
  detach?: boolean;
};

export type WaypointsDocument = {
  waypoints: RecordedKeyframe[];
};

const sortByTime = (keyframes: RecordedKeyframe[]): RecordedKeyframe[] =>
  [...keyframes].sort((a, b) => a.time_s - b.time_s);

/** Linear interpolation of joint targets at time `t`, matching WaypointPolicy. */
export const interpolateWaypoints = (
  keyframes: RecordedKeyframe[],
  t: number
): Record<string, number> => {
  if (keyframes.length === 0) return {};
  const sorted = sortByTime(keyframes);
  if (t <= sorted[0].time_s) return { ...sorted[0].joints };
  const last = sorted[sorted.length - 1];
  if (t >= last.time_s) return { ...last.joints };
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const earlier = sorted[i];
    const later = sorted[i + 1];
    if (earlier.time_s <= t && t <= later.time_s) {
      const span = later.time_s - earlier.time_s;
      const alpha = span <= 0 ? 0 : (t - earlier.time_s) / span;
      const names = new Set([...Object.keys(earlier.joints), ...Object.keys(later.joints)]);
      const result: Record<string, number> = {};
      for (const name of names) {
        const a = earlier.joints[name] ?? later.joints[name] ?? 0;
        const b = later.joints[name] ?? earlier.joints[name] ?? 0;
        result[name] = (1 - alpha) * a + alpha * b;
      }
      return result;
    }
  }
  return { ...last.joints };
};

export const waypointsDuration = (keyframes: RecordedKeyframe[]): number =>
  keyframes.reduce((max, keyframe) => Math.max(max, keyframe.time_s), 0);

export const buildWaypointsDocument = (keyframes: RecordedKeyframe[]): WaypointsDocument => ({
  waypoints: sortByTime(keyframes).map((keyframe) => {
    const entry: RecordedKeyframe = {
      time_s: Number(keyframe.time_s.toFixed(3)),
      joints: { ...keyframe.joints },
    };
    if (keyframe.attach) entry.attach = keyframe.attach;
    if (keyframe.detach) entry.detach = true;
    return entry;
  }),
});
