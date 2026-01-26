#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const webRoot = path.join(root, "web");
const srcRoot = path.join(webRoot, "src");
const entrypoint = path.join(srcRoot, "app", "main.tsx");

const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const graphExtensions = new Set([...codeExtensions, ".json", ".css"]);

const scanDirs = ["web", "backend", "config", "tools"].map((dir) => path.join(root, dir));
const debug = process.env.DEAD_CODE_DEBUG === "1";

// Ignore patterns for new feature modules not yet integrated into main app
// These are exported for future use and will be connected to the app later
const IGNORE_PATTERNS = [
  // RobotOps training features (V1 - will be integrated after full testing)
  "web/src/features/datasets/",
  "web/src/features/evaluation/",
  "web/src/features/experiments/",
  "web/src/features/metrics/",
  "web/src/app/pages/RobotOps.tsx",
  // Sample/demo files for quick start
  "web/src/shared/samples/",
  // Dataset utilities with exports for future use
  "web/src/features/dataset/jointLimitCorrections.ts",
  // Training store selectors not yet wired to UI
  "web/src/features/training/useTrainingStore.ts",
];

// Dependencies that are configured but not directly imported (e.g., via vite alias)
const IGNORE_DEPENDENCIES = [
  "hls.js", // Aliased in vite config for video streaming support
];

const shouldIgnore = (filePath) => {
  const relative = path.relative(root, filePath).replace(/\\/g, "/");
  return IGNORE_PATTERNS.some((pattern) => relative.startsWith(pattern) || relative === pattern);
};
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

const scriptKindForFile = (filePath) => {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".ts":
      return ts.ScriptKind.TS;
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
};

const parseSourceFile = (filePath) => {
  const code = fs.readFileSync(filePath, "utf8");
  return ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(filePath)
  );
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
    /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g,
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
    const ext = path.extname(file);
    if (!codeExtensions.has(ext) && ext !== ".css") {
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
    if (!reachable.has(file) && !shouldIgnore(file)) {
      unused.push(path.relative(root, file));
    }
  }

  return unused.sort();
};

const collectUnusedExports = () => {
  const allCodeFiles = scanDirs.flatMap((dir) =>
    walk(dir, (name) => codeExtensions.has(path.extname(name)))
  );

  const exportInfo = new Map();
  const usageInfo = new Map();
  const exportAllTargets = new Map();

  const ensureUsage = (filePath) => {
    const normalized = path.normalize(filePath);
    if (!usageInfo.has(normalized)) {
      usageInfo.set(normalized, {
        used: new Set(),
        allUsed: false,
      });
    }
    return usageInfo.get(normalized);
  };

  const addExport = (filePath, name) => {
    const normalized = path.normalize(filePath);
    if (!exportInfo.has(normalized)) {
      exportInfo.set(normalized, {
        named: new Set(),
        hasExportAll: false,
      });
    }
    exportInfo.get(normalized).named.add(name);
  };

  const markAllUsed = (filePath) => {
    const usage = ensureUsage(filePath);
    usage.allUsed = true;
  };

  const addExportAllTarget = (filePath, target) => {
    const normalized = path.normalize(filePath);
    if (!exportAllTargets.has(normalized)) {
      exportAllTargets.set(normalized, new Set());
    }
    exportAllTargets.get(normalized).add(path.normalize(target));
  };

  for (const file of allCodeFiles) {
    const source = parseSourceFile(file);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveSpec(node.moduleSpecifier.text, file);
        if (target) {
          const usage = ensureUsage(target);
          const clause = node.importClause;
          if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              usage.allUsed = true;
            } else if (ts.isNamedImports(clause.namedBindings)) {
              for (const element of clause.namedBindings.elements) {
                const name = (element.propertyName ?? element.name).text;
                usage.used.add(name);
              }
            }
          }
        }
      }

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const [arg] = node.arguments;
          if (arg && ts.isStringLiteral(arg)) {
            const target = resolveSpec(arg.text, file);
            if (target) {
              markAllUsed(target);
            }
          }
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          const [arg] = node.arguments;
          if (arg && ts.isStringLiteral(arg)) {
            const target = resolveSpec(arg.text, file);
            if (target) {
              markAllUsed(target);
            }
          }
        }
      }

      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveSpec(node.moduleSpecifier.text, file);
        if (target) {
          if (!node.exportClause) {
            addExportAllTarget(file, target);
          } else if (ts.isNamedExports(node.exportClause)) {
            const usage = ensureUsage(target);
            for (const element of node.exportClause.elements) {
              const name = (element.propertyName ?? element.name).text;
              usage.used.add(name);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  for (const file of allCodeFiles) {
    if (!file.startsWith(srcRoot)) continue;
    const source = parseSourceFile(file);
    ts.forEachChild(source, (node) => {
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            addExport(file, element.name.text);
          }
        }
      }

      if (ts.isVariableStatement(node) && node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            addExport(file, decl.name.text);
          }
        }
      }

      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (node.name) {
          addExport(file, node.name.text);
        }
      }
    });
  }

  const usedByFile = new Map();
  const allUsedByFile = new Set();

  for (const [filePath, usage] of usageInfo.entries()) {
    if (usage.allUsed) {
      allUsedByFile.add(filePath);
    }
    if (usage.used.size) {
      usedByFile.set(filePath, new Set(usage.used));
    }
  }

  const getUsedSet = (filePath) => {
    const normalized = path.normalize(filePath);
    if (!usedByFile.has(normalized)) {
      usedByFile.set(normalized, new Set());
    }
    return usedByFile.get(normalized);
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const [sourceFile, targets] of exportAllTargets.entries()) {
      const sourceAllUsed = allUsedByFile.has(sourceFile);
      const sourceUsed = getUsedSet(sourceFile);
      for (const target of targets) {
        const targetExports = exportInfo.get(target)?.named;
        if (!targetExports || targetExports.size === 0) {
          continue;
        }

        if (sourceAllUsed) {
          if (!allUsedByFile.has(target)) {
            allUsedByFile.add(target);
            changed = true;
          }
          continue;
        }

        const targetUsed = getUsedSet(target);
        for (const name of sourceUsed) {
          if (targetExports.has(name) && !targetUsed.has(name)) {
            targetUsed.add(name);
            changed = true;
          }
        }
      }
    }
  }

  const unusedExports = [];
  for (const [filePath, exports] of exportInfo.entries()) {
    if (exports.named.size === 0) continue;

    // Skip ignored files
    if (shouldIgnore(filePath)) {
      continue;
    }

    if (allUsedByFile.has(filePath)) {
      continue;
    }

    const used = usedByFile.get(filePath) ?? new Set();
    const unused = [...exports.named].filter((name) => !used.has(name));
    if (unused.length) {
      unusedExports.push({
        file: path.relative(root, filePath),
        names: unused.sort(),
      });
    }
  }

  return unusedExports;
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

  return deps.filter((dep) => !used.has(dep) && !IGNORE_DEPENDENCIES.includes(dep)).sort();
};

const unusedFiles = collectUnusedFiles();
const unusedExports = collectUnusedExports();
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

if (unusedExports.length) {
  hasIssues = true;
  console.error("Unused exports detected:");
  for (const entry of unusedExports) {
    console.error(`  - ${entry.file}: ${entry.names.join(", ")}`);
  }
}

if (hasIssues) {
  process.exit(1);
}

console.log("Dead-code scan passed.");
