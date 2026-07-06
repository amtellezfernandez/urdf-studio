import { clampNumberToMin } from "@/shared/lib/numeric";

type CacheEntry<V> = {
  value: V;
};

type LruCache<V> = {
  get: (key: string) => V | undefined;
  set: (key: string, value: V) => void;
  has: (key: string) => boolean;
  invalidate: (key: string) => void;
  clear: () => void;
};

export const createLruCache = <V>(limit: number): LruCache<V> => {
  const store = new Map<string, CacheEntry<V>>();

  const touch = (key: string, entry: CacheEntry<V>) => {
    store.delete(key);
    store.set(key, entry);
  };

  const evict = () => {
    while (store.size > limit) {
      const oldestKey = store.keys().next().value;
      if (typeof oldestKey === "string") {
        store.delete(oldestKey);
      } else {
        break;
      }
    }
  };

  return {
    get: (key) => {
      const entry = store.get(key);
      if (!entry) return undefined;
      touch(key, entry);
      return entry.value;
    },
    set: (key, value) => {
      store.set(key, { value });
      evict();
    },
    has: (key) => store.has(key),
    invalidate: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

export const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
};

export const hashArrayBuffer = (buffer: ArrayBuffer) => {
  const view = new Uint8Array(buffer);
  const length = view.length;
  if (length === 0) return "0";

  const sampleSize = Math.min(2048, length);
  const step = clampNumberToMin(Math.floor(length / sampleSize), 1);
  let hash = 2166136261;

  for (let i = 0; i < length; i += step) {
    hash ^= view[i];
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  hash ^= length;
  return (hash >>> 0).toString(16);
};
