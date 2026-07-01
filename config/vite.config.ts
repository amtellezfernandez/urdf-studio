import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeConfig, runtimeUrls } from "./runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webRoot = path.resolve(rootDir, "web");
const buildSha =
  process.env.URDF_STUDIO_BUILD_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  "dev";

const resolveClientApiBaseUrl = (mode: string): string =>
  mode === "development" ? "/api" : runtimeUrls.apiBaseUrl;

const createClientConfig = (mode: string) => ({
  apiBaseUrl: resolveClientApiBaseUrl(mode),
});

export default defineConfig(({ mode }) => {
  const clientConfig = createClientConfig(mode);
  const isTestMode = mode === "test" || Boolean(process.env.VITEST);

  return {
    root: webRoot,
    cacheDir: path.resolve(rootDir, "node_modules", ".vite", "web"),
    server: {
      host: runtimeConfig.web.bindHost,
      port: runtimeConfig.web.port,
      strictPort: true,
      allowedHosts: true,
      fs: {
        strict: true,
        allow: [webRoot, path.resolve(rootDir, "node_modules")],
        deny: [
          "**/.env",
          "**/.env.*",
          "**/.git/**",
          "**/*.{pem,key,crt,p12,pfx}",
          "**/id_rsa*",
          "**/id_ed25519*",
        ],
      },
      proxy: {
        "/api": {
          target: runtimeUrls.apiBaseUrl,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
        },
      },
      ...(isTestMode ? { hmr: false, ws: false } : {}),
    },
    plugins: [react()],
    define: {
      __URDF_CONFIG__: JSON.stringify(clientConfig),
      "import.meta.env.VITE_BUILD_SHA": JSON.stringify(buildSha),
    },
    resolve: {
      alias: {
        "@": path.resolve(webRoot, "src"),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("node_modules/urdf-loader")) return "urdf-loader";
            if (id.includes("node_modules/three")) return "three";
            if (id.includes("node_modules/react")) return "react";
            return;
          },
        },
      },
    },
  };
});
