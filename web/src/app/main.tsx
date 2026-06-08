import { createRoot } from "react-dom/client";
import "./index.css";

// Always use dark mode
const root = document.documentElement;
root.classList.remove("light");
root.classList.add("dark");

const appRoot = document.getElementById("root");
const BOOT_RECOVERY_CONFIG = {
  clearStateQueryParam: "urdfStudioClearState",
  pageRetryQueryParam: "urdfStudioBootRetry",
  storageKeyPrefixes: ["urdfstudio:", "urdf-studio-"],
} as const;

const appendTextElement = (
  parent: HTMLElement,
  tagName: keyof HTMLElementTagNameMap,
  text: string,
  className: string
) => {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
};

const retryWithFreshAssets = () => {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(BOOT_RECOVERY_CONFIG.pageRetryQueryParam, String(Date.now()));
  window.location.replace(nextUrl.toString());
};

const clearStoredStudioState = () => {
  const removeStudioStorageKeys = (storage: Storage) => {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string =>
        Boolean(key) &&
        BOOT_RECOVERY_CONFIG.storageKeyPrefixes.some((prefix) => key.startsWith(prefix))
    );
    keys.forEach((key) => storage.removeItem(key));
  };

  try {
    removeStudioStorageKeys(window.localStorage);
  } catch {
    // Storage may be blocked by browser privacy settings.
  }
  try {
    removeStudioStorageKeys(window.sessionStorage);
  } catch {
    // Storage may be blocked by browser privacy settings.
  }
};

const resetStudioStateAndReload = () => {
  clearStoredStudioState();
  retryWithFreshAssets();
};

const recoverFromClearStateQuery = () => {
  const url = new URL(window.location.href);
  if (url.searchParams.get(BOOT_RECOVERY_CONFIG.clearStateQueryParam) !== "1") {
    return false;
  }
  clearStoredStudioState();
  url.searchParams.delete(BOOT_RECOVERY_CONFIG.clearStateQueryParam);
  url.searchParams.set(BOOT_RECOVERY_CONFIG.pageRetryQueryParam, String(Date.now()));
  window.location.replace(url.toString());
  return true;
};

const renderBootFailure = (error: unknown) => {
  console.error("[boot] Failed to start URDF Studio:", error);
  if (!appRoot) return;

  appRoot.replaceChildren();
  const frame = document.createElement("div");
  frame.className =
    "min-h-screen bg-background text-foreground flex items-center justify-center p-6";
  const panel = document.createElement("div");
  panel.className = "w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg";
  const actions = document.createElement("div");
  actions.className = "mt-5 flex flex-wrap justify-end gap-2";

  appendTextElement(
    panel,
    "p",
    "Startup failed",
    "text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
  );
  appendTextElement(panel, "h1", "URDF Studio could not load", "mt-2 text-xl font-semibold");
  appendTextElement(
    panel,
    "p",
    error instanceof Error ? error.message : "The app bundle did not start in this browser tab.",
    "mt-2 text-sm text-muted-foreground"
  );

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className =
    "inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground";
  retryButton.textContent = "Retry";
  retryButton.addEventListener("click", retryWithFreshAssets);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className =
    "inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium";
  clearButton.textContent = "Reset Studio state";
  clearButton.addEventListener("click", resetStudioStateAndReload);

  actions.append(clearButton, retryButton);
  panel.appendChild(actions);
  frame.appendChild(panel);
  appRoot.appendChild(frame);
};

const startApp = async () => {
  if (recoverFromClearStateQuery()) {
    return;
  }
  if (!appRoot) {
    throw new Error("Missing root element.");
  }
  const { default: App } = await import("./App.tsx");
  createRoot(appRoot).render(<App />);
};

void startApp().catch(renderBootFailure);
