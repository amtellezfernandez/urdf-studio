import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const rootDir = resolve(new URL("../..", import.meta.url).pathname);
const webSrcDir = resolve(rootDir, "web", "src");

const ALLOWLIST_PREFIXES = [
  "app/pages/Index.tsx",
  "app/pages/index/",
  "shared/config/demo.ts",
  "shared/config/backends.ts",
  "shared/samples/",
  "features/layout/panels/EpisodesPanel.tsx",
  "features/viewer/Viewer3D.tsx",
];

const walkFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
};

const usesDemoMode = [];
for (const file of walkFiles(webSrcDir)) {
  const rel = relative(webSrcDir, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf-8");
  if (!/\bDEMO_MODE\b/.test(source)) continue;
  usesDemoMode.push(rel);
}

const notAllowed = usesDemoMode.filter(
  (file) => !ALLOWLIST_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix))
);

if (notAllowed.length > 0) {
  console.error("[demo-mode-boundaries] DEMO_MODE usage outside allowlist:");
  notAllowed.forEach((file) => console.error(` - ${file}`));
  process.exit(1);
}

console.log(`[demo-mode-boundaries] OK (${usesDemoMode.length} files)`);
