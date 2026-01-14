import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "url";
import { componentTagger } from "lovable-tagger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webRoot = path.resolve(rootDir, "apps", "web");

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  root: webRoot,
  cacheDir: path.resolve(rootDir, "node_modules", ".vite", "apps-web"),
  server: {
    host: "::",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
    ...(mode === "test" || process.env.VITEST ? { hmr: false, ws: false } : {}),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  css: {
    postcss: path.resolve(__dirname, "postcss.config.js"),
  },
  resolve: {
    alias: {
      "@": path.resolve(webRoot, "src"),
    },
  },
  build: {
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
}));
