#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const webRoot = path.join(root, "apps", "web");
const srcRoot = path.join(webRoot, "src");
const entrypoint = path.join(srcRoot, "app", "main.tsx");

const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const graphExtensions = new Set([...codeExtensions, ".json", ".css"]);

const scanDirs = ["apps", "config", "tools"].map((dir) => path.join(root, dir));
const debug = process.env.DEAD_CODE_DEBUG === "1";
if (debug) {
  const sanityRegex = /import\s+/;
  console.error(`Regex sanity: ${sanityRegex} -> ${sanityRegex.test("import foo")}`);
}

const isFile = (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile();
const isDir = (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();

const walk = (dir, filter) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full, filter));
    } else if (filter(entry.name)) {
      files.push(full);
    }
  }
  return files;
};

const extractSpecs = (code) => {
  const specs = new Set();
  const patterns = [
    /import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new\s+Worker\(\s*new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*\)/g,
    /new\s+SharedWorker\(\s*new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*\)/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code))) {
      specs.add(match[1]);
    }
  }

  return specs;
};

const resolveSpec = (spec, fromFile) => {
  let resolved;
  if (spec.startsWith("@/")) {
    resolved = path.join(srcRoot, spec.slice(2));
  } else if (spec.startsWith(".")) {
    resolved = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }

  if (path.extname(resolved)) {
    if (isFile(resolved)) {
      return resolved;
    }
  } else {
    for (const ext of graphExtensions) {
      const candidate = resolved + ext;
      if (isFile(candidate)) {
        return candidate;
      }
    }

    if (isDir(resolved)) {
      for (const ext of graphExtensions) {
        const indexCandidate = path.join(resolved, `index${ext}`);
        if (isFile(indexCandidate)) {
          return indexCandidate;
        }
      }
    }
  }

  return null;
};

const collectUnusedFiles = () => {
  const allFiles = walk(srcRoot, (name) => graphExtensions.has(path.extname(name)))
    .filter((file) => !file.endsWith(".d.ts"));
  const allFilesSet = new Set(allFiles.map((file) => path.normalize(file)));

  const edges = new Map();
  for (const file of allFiles) {
    if (!codeExtensions.has(path.extname(file))) {
      edges.set(path.normalize(file), new Set());
      continue;
    }

    const code = fs.readFileSync(file, "utf8");
    const specs = extractSpecs(code);
    const resolved = new Set();
    if (debug && path.normalize(file) === path.normalize(entrypoint)) {
      console.error(`Entrypoint bytes: ${code.length}`);
      console.error(`Entrypoint head: ${code.slice(0, 120).replace(/\\n/g, "\\\\n")}`);
      console.error(`Entrypoint specs: ${[...specs].join(", ")}`);
    }
    for (const spec of specs) {
      const target = resolveSpec(spec, file);
      if (debug && path.normalize(file) === path.normalize(entrypoint)) {
        console.error(`  ${spec} -> ${target ?? "unresolved"}`);
      }
      if (target && allFilesSet.has(path.normalize(target))) {
        resolved.add(path.normalize(target));
      }
    }
    edges.set(path.normalize(file), resolved);
  }

  const queue = [];
  const reachable = new Set();
  const normalizedEntrypoint = path.normalize(entrypoint);
  if (allFilesSet.has(normalizedEntrypoint)) {
    reachable.add(normalizedEntrypoint);
    queue.push(normalizedEntrypoint);
  } else if (debug) {
    console.error(`Entrypoint not found: ${normalizedEntrypoint}`);
  }

  while (queue.length) {
    const current = queue.shift();
    const nexts = edges.get(current);
    if (debug && current === normalizedEntrypoint) {
      console.error(`Entrypoint edges: ${nexts ? [...nexts].join(", ") : "none"}`);
    }
    if (!nexts) continue;
    for (const next of nexts) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const unused = [];
  for (const file of allFilesSet) {
    if (!reachable.has(file)) {
      unused.push(path.relative(root, file));
    }
  }

  return unused.sort();
};

const collectUnusedDependencies = () => {
  const files = scanDirs.flatMap((dir) =>
    walk(dir, (name) => codeExtensions.has(path.extname(name)))
  );

  const used = new Set();
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    const specs = extractSpecs(code);
    for (const spec of specs) {
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) {
        continue;
      }
      if (spec.startsWith("node:")) {
        continue;
      }

      const parts = spec.split("/");
      const pkg = spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
      used.add(pkg);
    }
  }

  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const deps = Object.keys(pkgJson.dependencies || {});

  return deps.filter((dep) => !used.has(dep)).sort();
};

const unusedFiles = collectUnusedFiles();
const unusedDeps = collectUnusedDependencies();

let hasIssues = false;

if (unusedFiles.length) {
  hasIssues = true;
  console.error("Unused source files detected:");
  for (const file of unusedFiles) {
    console.error(`  - ${file}`);
  }
}

if (unusedDeps.length) {
  hasIssues = true;
  console.error("Unused dependencies detected:");
  for (const dep of unusedDeps) {
    console.error(`  - ${dep}`);
  }
}

if (hasIssues) {
  process.exit(1);
}

console.log("Dead-code scan passed.");
