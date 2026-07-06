// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

const STORAGE_BLOCKED_ERROR_NAME = "SecurityError";

const restoreLocalStorageDescriptor = (
  descriptor: PropertyDescriptor | undefined
) => {
  if (descriptor) {
    Object.defineProperty(window, "localStorage", descriptor);
  }
};

const withBlockedLocalStorage = (callback: () => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("localStorage blocked", STORAGE_BLOCKED_ERROR_NAME);
    },
  });
  try {
    callback();
  } finally {
    restoreLocalStorageDescriptor(descriptor);
  }
};

const createThrowingStorage = (): Storage =>
  ({
    get length() {
      return 0;
    },
    clear() {
      throw new DOMException("clear blocked", STORAGE_BLOCKED_ERROR_NAME);
    },
    getItem() {
      throw new DOMException("read blocked", STORAGE_BLOCKED_ERROR_NAME);
    },
    key() {
      return null;
    },
    removeItem() {
      throw new DOMException("remove blocked", STORAGE_BLOCKED_ERROR_NAME);
    },
    setItem() {
      throw new DOMException("write blocked", STORAGE_BLOCKED_ERROR_NAME);
    },
  }) as Storage;

const withLocalStorage = (storage: Storage, callback: () => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    callback();
  } finally {
    restoreLocalStorageDescriptor(descriptor);
  }
};

describe("browserStorage", () => {
  it("reads, writes, and removes browser storage items", () => {
    writeBrowserStorageItem("urdf-test-key", "value");

    expect(readBrowserStorageItem("urdf-test-key")).toBe("value");

    removeBrowserStorageItem("urdf-test-key");

    expect(readBrowserStorageItem("urdf-test-key")).toBeNull();
  });

  it("does not throw when browser storage access is blocked", () => {
    withBlockedLocalStorage(() => {
      expect(readBrowserStorageItem("urdf-test-key")).toBeNull();
      expect(() => writeBrowserStorageItem("urdf-test-key", "value")).not.toThrow();
      expect(() => removeBrowserStorageItem("urdf-test-key")).not.toThrow();
    });
  });

  it("does not throw when browser storage methods fail", () => {
    withLocalStorage(createThrowingStorage(), () => {
      expect(readBrowserStorageItem("urdf-test-key")).toBeNull();
      expect(() => writeBrowserStorageItem("urdf-test-key", "value")).not.toThrow();
      expect(() => removeBrowserStorageItem("urdf-test-key")).not.toThrow();
    });
  });
});
