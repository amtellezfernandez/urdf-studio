const DEFAULT_COLOR = "#9ca3af";
const DRAG_HANDLE_BLUE = "#4dabf7";

type JointGroup =
  | "end_effector"
  | "arm"
  | "leg"
  | "torso"
  | "base"
  | "head"
  | "wheel"
  | "sensor"
  | "aux"
  | "unknown";

type JointSide = "left" | "right" | "center" | "none";

type JointGroupConfig = {
  hueCenter: number;
  hueSpan: number;
  saturation: number;
  lightness: number;
};

const GROUP_CONFIGS: Record<JointGroup, JointGroupConfig> = {
  end_effector: { hueCenter: 203, hueSpan: 18, saturation: 92, lightness: 64 },
  arm: { hueCenter: 214, hueSpan: 52, saturation: 86, lightness: 56 },
  leg: { hueCenter: 346, hueSpan: 34, saturation: 82, lightness: 56 },
  torso: { hueCenter: 280, hueSpan: 46, saturation: 72, lightness: 54 },
  base: { hueCenter: 92, hueSpan: 50, saturation: 80, lightness: 54 },
  head: { hueCenter: 178, hueSpan: 32, saturation: 74, lightness: 58 },
  wheel: { hueCenter: 58, hueSpan: 20, saturation: 90, lightness: 52 },
  sensor: { hueCenter: 208, hueSpan: 28, saturation: 76, lightness: 58 },
  aux: { hueCenter: 244, hueSpan: 36, saturation: 70, lightness: 56 },
  unknown: { hueCenter: 210, hueSpan: 360, saturation: 18, lightness: 60 },
};

const LEFT_TOKENS = new Set(["left", "l", "lf", "fl", "rl", "lh"]);
const RIGHT_TOKENS = new Set(["right", "r", "rf", "fr", "rr", "rh"]);
const CENTER_TOKENS = new Set(["center", "mid", "middle", "torso", "waist", "base", "root"]);

const EE_STRONG_TOKENS = new Set(["ee", "tcp", "tool0", "tool", "endeffector", "end_effector"]);
const EE_ANCHOR_TOKENS = new Set(["ee", "tcp", "tool0", "endeffector", "end_effector"]);
const EE_TOKENS = new Set([
  ...EE_STRONG_TOKENS,
  "gripper",
  "finger",
  "claw",
  "jaw",
]);
const ARM_TOKENS = new Set(["arm", "shoulder", "elbow", "forearm", "upperarm", "bicep"]);
const LEG_TOKENS = new Set(["leg", "hip", "knee", "ankle", "thigh", "shin", "calf", "foot", "paw", "hock"]);
const TORSO_TOKENS = new Set(["torso", "spine", "waist", "pelvis", "chest"]);
const BASE_TOKENS = new Set(["base", "root", "world", "chassis"]);
const HEAD_TOKENS = new Set(["head", "neck", "yaw_head", "pitch_head"]);
const WHEEL_TOKENS = new Set(["wheel", "caster"]);
const SENSOR_TOKENS = new Set(["camera", "lidar", "imu", "sensor", "optic"]);
const AUX_TOKENS = new Set(["aux", "helper", "virtual", "dummy"]);

const colorMapCache = new Map<string, Map<string, string>>();
const colorMapByRef = new WeakMap<readonly string[], Map<string, string>>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrapHue = (value: number) => ((value % 360) + 360) % 360;

const normalizeName = (jointName: string) =>
  jointName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();

const tokenizeName = (jointName: string) =>
  normalizeName(jointName)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);

const normalizeNames = (jointNames: readonly string[]): string[] =>
  Array.from(
    new Set(jointNames.map((name) => name.trim()).filter((name) => name.length > 0))
  ).sort((a, b) => a.localeCompare(b));

const cacheKeyForJointNames = (jointNames: readonly string[]): string =>
  normalizeNames(jointNames).join("|");

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hue = wrapHue(h);
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (hue < 60) {
    rPrime = c;
    gPrime = x;
  } else if (hue < 120) {
    rPrime = x;
    gPrime = c;
  } else if (hue < 180) {
    gPrime = c;
    bPrime = x;
  } else if (hue < 240) {
    gPrime = x;
    bPrime = c;
  } else if (hue < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rPrime)}${toHex(gPrime)}${toHex(bPrime)}`;
};

const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const colorDistance = (a: string, b: string) => {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  const dr = ar.r - br.r;
  const dg = ar.g - br.g;
  const db = ar.b - br.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const isDistinctEnough = (candidate: string, usedColors: Set<string>, minDistance: number) => {
  for (const used of usedColors) {
    if (colorDistance(candidate, used) < minDistance) {
      return false;
    }
  }
  return true;
};

const inferJointSide = (tokens: readonly string[]): JointSide => {
  if (tokens.some((token) => LEFT_TOKENS.has(token))) return "left";
  if (tokens.some((token) => RIGHT_TOKENS.has(token))) return "right";
  if (tokens.some((token) => CENTER_TOKENS.has(token))) return "center";
  return "none";
};

const containsToken = (tokens: readonly string[], candidates: Set<string>) =>
  tokens.some((token) => candidates.has(token));

const inferJointGroup = (tokens: readonly string[]): JointGroup => {
  if (containsToken(tokens, EE_TOKENS)) return "end_effector";
  if (containsToken(tokens, ARM_TOKENS)) return "arm";
  if (containsToken(tokens, LEG_TOKENS)) return "leg";
  if (containsToken(tokens, TORSO_TOKENS)) return "torso";
  if (containsToken(tokens, BASE_TOKENS)) return "base";
  if (containsToken(tokens, HEAD_TOKENS)) return "head";
  if (containsToken(tokens, WHEEL_TOKENS)) return "wheel";
  if (containsToken(tokens, SENSOR_TOKENS)) return "sensor";
  if (containsToken(tokens, AUX_TOKENS)) return "aux";
  return "unknown";
};

const isStrongEndEffectorJoint = (tokens: readonly string[]) =>
  tokens.some((token) => EE_STRONG_TOKENS.has(token));

const isAnchorEndEffectorJoint = (tokens: readonly string[]) =>
  tokens.some((token) => EE_ANCHOR_TOKENS.has(token));

const colorForJoint = ({
  group,
  side,
  bucketIndex,
  jointName,
  usedColors,
  isStrongEE,
  isPrimaryAnchorEE,
}: {
  group: JointGroup;
  side: JointSide;
  bucketIndex: number;
  jointName: string;
  usedColors: Set<string>;
  isStrongEE: boolean;
  isPrimaryAnchorEE: boolean;
}): string => {
  if (group === "end_effector" && isPrimaryAnchorEE) {
    return DRAG_HANDLE_BLUE;
  }

  const base = GROUP_CONFIGS[group];
  const hash = hashString(jointName);
  const sideShift = side === "left" ? -8 : side === "right" ? 8 : side === "center" ? 3 : 0;

  const minDistance = group === "arm" || group === "end_effector" ? 52 : 40;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const jitter = ((bucketIndex * 31 + (hash % 23) + attempt * 13) % 100) / 100;
    const spanOffset = (jitter - 0.5) * 2 * base.hueSpan;
    const indexHueShift = ((bucketIndex % 6) - 2.5) * 6;
    const hue = wrapHue(base.hueCenter + sideShift + spanOffset + indexHueShift);
    const saturation = clamp(
      base.saturation + ((hash >> 5) % 11) - 5 + (attempt % 4) * 2,
      group === "end_effector" ? 84 : 62,
      group === "end_effector" ? 98 : 92
    );
    const lightness = clamp(
      base.lightness + ((bucketIndex % 7) - 3) * 3 + ((hash >> 11) % 7) - 3 + attempt,
      group === "end_effector" ? 58 : 42,
      group === "end_effector" ? 74 : 68
    );
    const color = hslToHex(hue, saturation, lightness);
    if (!usedColors.has(color) && isDistinctEnough(color, usedColors, minDistance)) {
      return color;
    }
  }

  return hslToHex(base.hueCenter + sideShift, base.saturation, base.lightness);
};

const buildColorMap = (jointNames: readonly string[]): Map<string, string> => {
  const names = normalizeNames(jointNames);
  const usedColors = new Set<string>();
  const map = new Map<string, string>();
  const buckets = new Map<string, string[]>();
  const metadata = new Map<
    string,
    { group: JointGroup; side: JointSide; isStrongEE: boolean; isAnchorEE: boolean; isPrimaryAnchorEE: boolean }
  >();
  let primaryEeAnchorAssigned = false;

  names.forEach((jointName) => {
    const tokens = tokenizeName(jointName);
    const group = inferJointGroup(tokens);
    const side = inferJointSide(tokens);
    const isStrongEE = isStrongEndEffectorJoint(tokens);
    const isAnchorEE = isAnchorEndEffectorJoint(tokens);
    const isPrimaryAnchorEE = group === "end_effector" && isAnchorEE && !primaryEeAnchorAssigned;
    if (isPrimaryAnchorEE) {
      primaryEeAnchorAssigned = true;
    }
    metadata.set(jointName, { group, side, isStrongEE, isAnchorEE, isPrimaryAnchorEE });
    const key = `${group}:${side}`;
    const values = buckets.get(key) ?? [];
    values.push(jointName);
    buckets.set(key, values);
  });

  Array.from(buckets.values()).forEach((values) => values.sort((a, b) => a.localeCompare(b)));

  buckets.forEach((bucketJointNames) => {
    bucketJointNames.forEach((jointName, bucketIndex) => {
      const info = metadata.get(jointName);
      if (!info) return;
      const color = colorForJoint({
        group: info.group,
        side: info.side,
        bucketIndex,
        jointName,
        usedColors,
        isStrongEE: info.isStrongEE,
        isPrimaryAnchorEE: info.isPrimaryAnchorEE,
      });
      usedColors.add(color);
      map.set(jointName, color);
    });
  });

  return map;
};

/**
 * Deterministic, per-joint unique colors with semantic grouping.
 * End-effector-like joints are pinned to the drag-handle blue family and emphasized.
 */
export function getJointColor(jointName: string, allJointNames: readonly string[]): string {
  const normalized = jointName.trim();
  if (!normalized) return DEFAULT_COLOR;

  const byRef = colorMapByRef.get(allJointNames);
  if (byRef) return byRef.get(normalized) ?? DEFAULT_COLOR;

  const key = cacheKeyForJointNames(allJointNames);
  const cached = colorMapCache.get(key);
  if (cached) {
    colorMapByRef.set(allJointNames, cached);
    return cached.get(normalized) ?? DEFAULT_COLOR;
  }

  const map = buildColorMap(allJointNames);
  colorMapCache.set(key, map);
  colorMapByRef.set(allJointNames, map);
  return map.get(normalized) ?? DEFAULT_COLOR;
}
