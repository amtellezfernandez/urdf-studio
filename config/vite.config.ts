import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "url";
import { componentTagger } from "lovable-tagger";
import { runtimeConfig, runtimeUrls } from "./runtime.js";
import {
  DISABLED_GITHUB_DEV_PROXY_MESSAGE,
  DISABLED_GITHUB_DEV_PROXY_STATUS_CODE,
  buildDevServerProxy,
  shouldBlockGitHubDevProxyRequest,
} from "./devServerProxy.js";
import {
  createTeamSharingState,
  handleTeamSharingControlRequest,
  isTeamSharingControlPath,
  resolveTeamSharingRequestRemoteAddress,
  shouldBlockTeamSharingRequest,
  writeTeamSharingBlockedResponse,
} from "./teamSharingGate.js";
import {
  TEAM_SHARING_DEFAULT_ENABLED,
  TEAM_SHARING_UPGRADE_BLOCK_RESPONSE,
} from "./teamSharingParams.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webRoot = path.resolve(rootDir, "web");
const devServerFileAllowList = [
  webRoot,
  path.resolve(rootDir, "runtime"),
  path.resolve(rootDir, "node_modules"),
];
const devServerFileDenyList = [
  "**/.env",
  "**/.env.*",
  "**/.git/**",
  "**/*.{pem,key,crt,p12,pfx}",
  "**/id_rsa*",
  "**/id_ed25519*",
];
const buildSha =
  process.env.URDF_STUDIO_BUILD_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  "dev";

const resolveClientApiBaseUrl = (mode: string): string =>
  mode === "development" ? "/api" : runtimeUrls.apiBaseUrl;

// In local Vite dev, force frontend API calls through the dev proxy so
// localhost and 127.0.0.1 differences do not trigger browser CORS failures.
const createClientConfig = (mode: string) => ({
  apiBaseUrl: resolveClientApiBaseUrl(mode),
  urdfOpsWebUrl:
    process.env.URDF_OPS_WEB_URL ||
    process.env.VITE_URDF_OPS_WEB_URL ||
    "http://127.0.0.1:5174",
  ikdBaseUrl: runtimeUrls.ikdBaseUrl,
  ikdWsUrl: runtimeUrls.ikdWsUrl,
  teleopHttpBaseUrl: runtimeUrls.teleopHttpBaseUrl,
  ikd: {
    enabled: runtimeConfig.ikd.enabled,
    useForDrag: runtimeConfig.ikd.useForDrag,
    controlHz: runtimeConfig.ikd.controlHz,
    telemetryHz: runtimeConfig.ikd.telemetryHz,
  },
  ik: runtimeConfig.ik,
});


const isTruthyEnvValue = (value: string | undefined): boolean =>
  /^(1|true|yes)$/i.test(value || "");

const createTeamSharingGate = (): Plugin => {
  const state = createTeamSharingState({
    enabled: isTruthyEnvValue(process.env.URDF_TEAM_SHARING_INITIAL_ENABLED)
      ? true
      : TEAM_SHARING_DEFAULT_ENABLED,
    localUrl: process.env.URDF_TEAM_SHARING_LOCAL_URL || runtimeUrls.webBaseUrl,
    teamUrl: process.env.URDF_TEAM_SHARING_TEAM_URL || "",
  });

  // When the server is bound to a loopback address only, the OS-level bind
  // already restricts access to the local machine. WSL2's localhost proxy
  // forwards Windows browser connections but makes them appear as non-loopback
  // IPs. Only trust those private-source addresses while the server itself is
  // bound to loopback; in remote-bind mode they remain remote clients.

  const shouldBlock = (remoteAddress: string | undefined, requestUrl: string | undefined) =>
    shouldBlockTeamSharingRequest({
      enabled: state.enabled,
      remoteAddress: resolveTeamSharingRequestRemoteAddress({
        remoteAddress: remoteAddress ?? "",
        webBindHost: runtimeConfig.web.bindHost,
      }),
      requestUrl: requestUrl ?? "",
    });

  return {
    name: "urdf-team-sharing-gate",
    enforce: "pre",
    configureServer(server) {
      server.httpServer?.prependListener("upgrade", (request, socket) => {
        if (shouldBlock(request.socket.remoteAddress, request.url)) {
          socket.write(TEAM_SHARING_UPGRADE_BLOCK_RESPONSE);
          socket.destroy();
        }
      });

      server.middlewares.use((request, response, next) => {
        if (isTeamSharingControlPath(request.url)) {
          void handleTeamSharingControlRequest({ request, response, state }).catch((error) => {
            response.statusCode = 500;
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.end(error instanceof Error ? error.message : "Team sharing control failed.");
          });
          return;
        }

        if (shouldBlock(request.socket.remoteAddress, request.url)) {
          writeTeamSharingBlockedResponse(response);
          return;
        }

        next();
      });
    },
  };
};

const blockDisabledGitHubDevProxy = (): Plugin => ({
  name: "urdf-block-disabled-github-dev-proxy",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!shouldBlockGitHubDevProxyRequest(request.url, { runtimeConfig })) {
        next();
        return;
      }
      response.statusCode = DISABLED_GITHUB_DEV_PROXY_STATUS_CODE;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(DISABLED_GITHUB_DEV_PROXY_MESSAGE);
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const clientConfig = createClientConfig(mode);

  return {
    root: webRoot,
    base: mode === "demo" ? "/demo/" : undefined,
    cacheDir: path.resolve(rootDir, "node_modules", ".vite", "web"),
    server: {
      host: runtimeConfig.web.bindHost,
      port: runtimeConfig.web.port,
      fs: {
        strict: true,
        allow: devServerFileAllowList,
        deny: devServerFileDenyList,
      },
      proxy: buildDevServerProxy({ runtimeConfig, runtimeUrls }),
      // In WSL2 the Windows host resets idle TCP connections, which Vite
      // misreads as "server down" and calls location.reload(), causing the
      // recurring white-screen reload loop. Pinning the HMR WebSocket to the
      // configured browser-facing host keeps it routed through the WSL2
      // localhost proxy when used, and clientPort prevents port mismatches.
      hmr: (mode === "test" || process.env.VITEST)
        ? false
        : {
            host: runtimeConfig.web.host,
            clientPort: runtimeConfig.web.port,
          },
      ...(mode === "test" || process.env.VITEST ? { ws: false } : {}),
    },
    plugins: [
      createTeamSharingGate(),
      blockDisabledGitHubDevProxy(),
      react(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    define: {
      __URDF_CONFIG__: JSON.stringify(clientConfig),
      "import.meta.env.VITE_BUILD_SHA": JSON.stringify(buildSha),
    },
    css: {
      postcss: path.resolve(__dirname, "postcss.config.js"),
    },
    resolve: {
      alias: {
        "@": path.resolve(webRoot, "src"),
        "@runtime-private": path.resolve(rootDir, "runtime"),
        "hls.js": path.resolve(rootDir, "node_modules", "hls.js", "dist", "hls.js"),
      },
    },
    optimizeDeps: {
      // i-love-urdf ships CJS; force pre-bundling so `export * from "i-love-urdf"`
      // in urdfCore.ts resolves all named exports correctly in dev mode.
      include: ["i-love-urdf"],
      // parquet-wasm resolves its .wasm file relative to import.meta.url.
      // Pre-bundling moves the JS and can break that URL in dev.
      exclude: ["parquet-wasm"],
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("node_modules/@react-three/")) return "react-three";
            if (id.includes("node_modules/three-stdlib")) return "three-stdlib";
            if (id.includes("node_modules/urdf-loader")) return "urdf-loader";
            if (id.includes("node_modules/three")) return "three";
            if (id.includes("node_modules/reactflow")) return "reactflow";
            if (id.includes("node_modules/jszip")) return "jszip";
            if (id.includes("node_modules/@radix-ui/")) return "radix-ui";
            if (id.includes("node_modules/lucide-react")) return "lucide";
            if (id.includes("node_modules/@tanstack/")) return "tanstack";
            if (id.includes("node_modules/zustand")) return "zustand";
            return;
          },
        },
      },
    },
  };
});
