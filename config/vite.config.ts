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
}));
