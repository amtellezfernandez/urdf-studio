import { CAMERA_LINK_PREFIX_PATTERN } from "./cameraAutoGenerationParams";

type CameraTargetJointEdge = {
  parentLink?: string | null;
  childLink?: string | null;
};

type CameraTargetSensor = {
  type?: string | null;
  linkName?: string | null;
};

const decodeUriComponentSafe = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isDecodedVariant = (value: string) => decodeUriComponentSafe(value) === value;
const normalizeLinkKey = (value: string) => decodeUriComponentSafe(value).trim().toLowerCase();

const buildAvailableLinkMap = (availableLinks: string[]) => {
  const byKey = new Map<string, string[]>();
  availableLinks.forEach((linkName) => {
    if (typeof linkName !== "string") return;
    const normalized = linkName.trim();
    if (!normalized) return;
    const key = normalizeLinkKey(normalized);
    const entries = byKey.get(key);
    if (entries) {
      entries.push(normalized);
      return;
    }
    byKey.set(key, [normalized]);
  });
  return byKey;
};

export const resolveCameraPrefixLinks = (availableLinks: string[]) => {
  const seen = new Set<string>();
  const links: string[] = [];

  availableLinks.forEach((linkName) => {
    if (typeof linkName !== "string") return;
    const normalized = linkName.trim();
    if (!normalized) return;

    const decoded = decodeUriComponentSafe(normalized);
    const matches =
      CAMERA_LINK_PREFIX_PATTERN.test(normalized) || CAMERA_LINK_PREFIX_PATTERN.test(decoded);
    if (!matches) return;

    if (seen.has(normalized)) return;
    seen.add(normalized);
    links.push(normalized);
  });

  // Keep stable order, but prefer decoded spellings over encoded spellings of the same link.
  links.sort((left, right) => {
    const leftDecoded = decodeUriComponentSafe(left);
    const rightDecoded = decodeUriComponentSafe(right);
    if (leftDecoded !== rightDecoded) return 0;
    const leftIsDecoded = isDecodedVariant(left);
    const rightIsDecoded = isDecodedVariant(right);
    if (leftIsDecoded === rightIsDecoded) return 0;
    return leftIsDecoded ? -1 : 1;
  });

  return links;
};

const resolveCameraSensorLinks = (
  availableLinks: string[],
  sensors: CameraTargetSensor[]
) => {
  const byKey = buildAvailableLinkMap(availableLinks);
  const preferredKeys = new Set<string>();
  sensors.forEach((sensor) => {
    const sensorType = sensor.type?.trim().toLowerCase();
    if (sensorType !== "camera") return;
    const linkName = sensor.linkName?.trim();
    if (!linkName) return;
    preferredKeys.add(normalizeLinkKey(linkName));
  });

  if (preferredKeys.size === 0) return [];
  const selected: string[] = [];
  const seen = new Set<string>();
  availableLinks.forEach((linkName) => {
    const normalized = linkName.trim();
    if (!normalized) return;
    if (!preferredKeys.has(normalizeLinkKey(normalized))) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    selected.push(normalized);
  });

  // Keep encoded fallback if it is the only available spelling.
  preferredKeys.forEach((key) => {
    if (selected.some((linkName) => normalizeLinkKey(linkName) === key)) return;
    const candidates = byKey.get(key) ?? [];
    candidates.forEach((candidate) => {
      if (seen.has(candidate)) return;
      seen.add(candidate);
      selected.push(candidate);
    });
  });

  return selected;
};

const pruneCameraAncestorLinks = (
  links: string[],
  joints: CameraTargetJointEdge[]
) => {
  if (links.length <= 1 || joints.length === 0) return links;
  const keys = new Set(links.map((linkName) => normalizeLinkKey(linkName)));
  const ancestorKeys = new Set<string>();
  joints.forEach((joint) => {
    const parent = joint.parentLink?.trim();
    const child = joint.childLink?.trim();
    if (!parent || !child) return;
    const parentKey = normalizeLinkKey(parent);
    const childKey = normalizeLinkKey(child);
    if (keys.has(parentKey) && keys.has(childKey)) {
      ancestorKeys.add(parentKey);
    }
  });
  const pruned = links.filter((linkName) => !ancestorKeys.has(normalizeLinkKey(linkName)));
  return pruned.length > 0 ? pruned : links;
};

type ResolveAutoCameraLinksParams = {
  availableLinks: string[];
  joints?: CameraTargetJointEdge[] | null;
  sensors?: CameraTargetSensor[] | null;
};

export const resolveAutoCameraLinks = ({
  availableLinks,
  joints,
  sensors,
}: ResolveAutoCameraLinksParams) => {
  const sensorLinks = resolveCameraSensorLinks(availableLinks, sensors ?? []);
  if (sensorLinks.length > 0) return sensorLinks;

  const prefixLinks = resolveCameraPrefixLinks(availableLinks);
  return pruneCameraAncestorLinks(prefixLinks, joints ?? []);
};
