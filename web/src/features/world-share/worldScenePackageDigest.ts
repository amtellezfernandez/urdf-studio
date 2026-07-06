import {
  WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE,
  WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_MESSAGE,
  WORLD_SCENE_PACKAGE_DIGEST_ALGORITHM,
} from "@/features/world-share/worldScenePackageParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

class WorldScenePackageBuildError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorldScenePackageBuildError";
    this.code = code;
  }
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const stableStringifyValue = (value: unknown): string | undefined => {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot canonicalize a non-finite world scene package number.");
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyValue(item) ?? "null").join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const sortedKeys = Object.keys(objectValue).sort();
  const fields = sortedKeys.flatMap((key) => {
    const serializedValue = stableStringifyValue(objectValue[key]);
    return serializedValue === undefined ? [] : `${JSON.stringify(key)}:${serializedValue}`;
  });
  return `{${fields.join(",")}}`;
};

export const stableStringify = (value: unknown): string => {
  const serialized = stableStringifyValue(value);
  if (serialized === undefined) {
    throw new Error("Cannot canonicalize an undefined world scene package value.");
  }
  return serialized;
};

const digestSha256 = async (content: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new WorldScenePackageBuildError(
      WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_CODE,
      WORLD_SCENE_PACKAGE_CRYPTO_UNAVAILABLE_ERROR_MESSAGE
    );
  }
  const encoded = new TextEncoder().encode(content);
  const digest = await subtle.digest(WORLD_SCENE_PACKAGE_DIGEST_ALGORITHM, encoded);
  return toHex(new Uint8Array(digest));
};

export const computeWorldSnapshotDigest = (
  snapshot: WorldScenePackageManifest["world_snapshot"]
): Promise<string> => digestSha256(stableStringify(snapshot));
