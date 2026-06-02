import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const safeEncodeURI = (value: string): string => {
  try {
    return encodeURI(value);
  } catch {
    return value;
  }
};

const normalizeAliasKey = (value: string): string => safeDecodeURIComponent(value).trim().toLowerCase();

const isLikelyLinkObject = (object: THREE.Object3D | null | undefined): object is THREE.Object3D => {
  if (!object) return false;
  const objectLike = object as THREE.Object3D & { isURDFLink?: boolean; type?: string };
  return objectLike.isURDFLink === true || objectLike.type === "URDFLink";
};

const addAlias = (aliases: Set<string>, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return;
  aliases.add(trimmed);
  const decoded = safeDecodeURIComponent(trimmed);
  aliases.add(decoded);
  aliases.add(safeEncodeURI(decoded));

  const slashIndex = decoded.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < decoded.length - 1) {
    aliases.add(decoded.slice(slashIndex + 1));
  }

  const namespaceIndex = decoded.lastIndexOf("::");
  if (namespaceIndex >= 0 && namespaceIndex < decoded.length - 2) {
    aliases.add(decoded.slice(namespaceIndex + 2));
  }
};

const buildLinkAliasMap = (robot: URDFRobot) => {
  const aliasMap = new Map<string, THREE.Object3D>();

  Object.entries(robot.links ?? {}).forEach(([name, object]) => {
    if (!object) return;
    const aliases = new Set<string>();
    addAlias(aliases, name);
    addAlias(aliases, object.name ?? "");
    aliases.forEach((alias) => {
      aliasMap.set(normalizeAliasKey(alias), object as unknown as THREE.Object3D);
    });
  });

  robot.traverse((node) => {
    if (!isLikelyLinkObject(node)) return;
    const aliases = new Set<string>();
    addAlias(aliases, node.name ?? "");
    aliases.forEach((alias) => {
      const normalized = normalizeAliasKey(alias);
      if (!aliasMap.has(normalized)) {
        aliasMap.set(normalized, node);
      }
    });
  });

  return aliasMap;
};

export type LinkObjectResolver = (linkName: string) => THREE.Object3D | null;

export const createLinkObjectResolver = (robot: URDFRobot | null): LinkObjectResolver => {
  if (!robot) return () => null;
  const aliasMap = buildLinkAliasMap(robot);

  return (linkName: string) => {
    if (!linkName) return null;

    const aliases = new Set<string>();
    addAlias(aliases, linkName);

    for (const alias of aliases) {
      const direct = (robot.links ?? {})[alias];
      if (direct) return direct as unknown as THREE.Object3D;
    }

    for (const alias of aliases) {
      const resolved = aliasMap.get(normalizeAliasKey(alias));
      if (resolved) return resolved;
    }

    for (const alias of aliases) {
      const object = robot.getObjectByName?.(alias);
      if (isLikelyLinkObject(object)) {
        return object;
      }
    }

    return null;
  };
};
