// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

const STORAGE_BLOCKED_ERROR_NAME = "SecurityError";

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
    if (descriptor) {
      Object.defineProperty(window, "localStorage", descriptor);
    }
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
});
