import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { safeDecodeURIComponent } from "@/features/viewer/uri";

const safeEncodeURI = (value: string): string => {
  try {
    return encodeURI(value);
  } catch {
    return value;
  }
};

const normalizeAliasKey = (value: string): string => safeDecodeURIComponent(value).trim().toLowerCase();

const toObject3D = (value: unknown): THREE.Object3D | null =>
  value instanceof THREE.Object3D ? value : null;

const isLikelyLinkObject = (object: unknown): object is THREE.Object3D => {
  const object3d = toObject3D(object);
  if (!object3d) return false;
  const objectLike = object3d as THREE.Object3D & { isURDFLink?: boolean; type?: string };
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
    const linkObject = toObject3D(object);
    if (!linkObject) return;
    const aliases = new Set<string>();
    addAlias(aliases, name);
    addAlias(aliases, linkObject.name ?? "");
    aliases.forEach((alias) => {
      aliasMap.set(normalizeAliasKey(alias), linkObject);
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
      const directLinkObject = toObject3D((robot.links ?? {})[alias]);
      if (directLinkObject) return directLinkObject;
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
