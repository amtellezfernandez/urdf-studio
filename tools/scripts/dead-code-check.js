#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import {
  DEAD_CODE_CLUSTER_FILE_POINTS,
  DEAD_CODE_DEFAULT_PATH_RISK,
  DEAD_CODE_EXPORTS_PER_POINT,
  DEAD_CODE_FILE_LINES_PER_POINT,
  DEAD_CODE_MAX_FILE_EXPORT_POINTS,
  DEAD_CODE_MAX_FILE_SIZE_POINTS,
  DEAD_CODE_MAX_UNUSED_EXPORT_POINTS,
  DEAD_CODE_ORPHAN_FILE_POINTS,
  DEAD_CODE_PATH_RISK_RULES,
  DEAD_CODE_REPORT_ITEM_LIMIT,
  DEAD_CODE_TEST_ONLY_FILE_POINTS,
  DEAD_CODE_UNUSED_DEPENDENCY_POINTS,
} from "./deadCodeParams.js";

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

const ALLOWED_UNUSED_FILE_PREFIXES = [];

const ALLOWED_UNUSED_FILE_PATHS = new Set([
  "web/src/features/urdf/inertia/robotMasteringBackend.ts",
  "web/src/features/urdf/synthesis/canonicalSynthesisDraft.ts",
]);

const ALLOWED_UNUSED_EXPORT_FILE_SUFFIXES = ["/types.ts"];

const ALLOWED_UNUSED_EXPORT_FILE_PATHS = new Set([]);

const ALLOWED_UNUSED_EXPORTS_BY_FILE = new Map([
  [
    "web/src/features/urdf/mesh/fixMissingMeshReferences.ts",
    new Set(["fixMissingMeshReferences"]),
  ],
  [
    "web/src/features/world-share/worldHubApi.ts",
    new Set([
      "getWorldHubCapabilities",
      "getWorldScenePackageVersionFromHub",
      "getWorldScenePackageVersionHubUrl",
      "listWorldScenePackagesFromHub",
    ]),
  ],
  [
    "web/src/features/world-share/worldSceneManifest.ts",
    new Set(["coerceWorldSceneSnapshot", "isWorldSceneManifest"]),
  ],
  [
    "web/src/features/world-share/worldScenePackageApi.ts",
    new Set(["getWorldRegistryCapabilities", "getWorldScenePackageVersionUrl"]),
  ],
  [
    "web/src/features/world-share/worldScenePackageBuilder.ts",
    new Set(["toSerializableWorldObject"]),
  ],
  [
    "web/src/features/urdf/inertia/robotMasteringBackend.ts",
    new Set([
      "runBakeExportExecute",
      "runCanonicalSynthesis",
      "runFramePreflight",
      "runGeneratePhysicsMastering",
      "runGeneratePhysicsPreflight",
    ]),
  ],
]);

const normalizeRelPath = (filePath) => filePath.replace(/\\/g, "/");

const normalizeAbsolutePath = (filePath) => path.normalize(filePath);

const isAllowedUnusedFile = (relativePath) => {
  const normalized = normalizeRelPath(relativePath);
  if (ALLOWED_UNUSED_FILE_PATHS.has(normalized)) {
    return true;
  }
  return ALLOWED_UNUSED_FILE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const isAllowedUnusedExportFile = (relativePath) => {
  const normalized = normalizeRelPath(relativePath);
  if (ALLOWED_UNUSED_EXPORT_FILE_PATHS.has(normalized)) {
    return true;
  }
  return ALLOWED_UNUSED_EXPORT_FILE_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix)
  );
};

const filterAllowlistedUnusedExports = (relativePath, names) => {
  const allowlisted = ALLOWED_UNUSED_EXPORTS_BY_FILE.get(relativePath);
  if (!allowlisted || allowlisted.size === 0) {
    return names;
  }
  return names.filter((name) => !allowlisted.has(name));
};

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
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".ts":
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
    return isFile(resolved) ? resolved : null;
  }

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

  return null;
};

const isTestFile = (filePath) => {
  const normalized = normalizeRelPath(filePath);
  if (normalized.includes("/__tests__/")) {
    return true;
  }
  return /\.(test|spec|testFixtures)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized);
};

const countLines = (filePath) => fs.readFileSync(filePath, "utf8").split(/\r?\n/).length;

const createReferenceInfo = () => ({
  nonTestRefCount: 0,
  testRefCount: 0,
});

const buildSourceGraph = ({ includeTests }) => {
  const allFiles = walk(srcRoot, (name) => graphExtensions.has(path.extname(name)))
    .filter((file) => !file.endsWith(".d.ts"))
    .filter((file) => includeTests || !isTestFile(file));
  const allFilesSet = new Set(allFiles.map(normalizeAbsolutePath));
  const edges = new Map();
  const inboundByFile = new Map();

  for (const file of allFiles) {
    const normalizedFile = normalizeAbsolutePath(file);
    const ext = path.extname(file);
    if (!codeExtensions.has(ext) && ext !== ".css") {
      edges.set(normalizedFile, new Set());
      continue;
    }

    const code = fs.readFileSync(file, "utf8");
    const specs = extractSpecs(code);
    const resolvedTargets = new Set();

    if (debug && normalizedFile === normalizeAbsolutePath(entrypoint)) {
      console.error(`Entrypoint bytes: ${code.length}`);
      console.error(`Entrypoint specs: ${[...specs].join(", ")}`);
    }

    for (const spec of specs) {
      const target = resolveSpec(spec, file);
      if (target && allFilesSet.has(normalizeAbsolutePath(target))) {
        const normalizedTarget = normalizeAbsolutePath(target);
        resolvedTargets.add(normalizedTarget);

        const referenceInfo = inboundByFile.get(normalizedTarget) ?? createReferenceInfo();
        if (isTestFile(file)) {
          referenceInfo.testRefCount += 1;
        } else {
          referenceInfo.nonTestRefCount += 1;
        }
        inboundByFile.set(normalizedTarget, referenceInfo);
      }
    }

    edges.set(normalizedFile, resolvedTargets);
  }

  return {
    allFilesSet,
    edges,
    inboundByFile,
  };
};

const buildReachableSet = (graph) => {
  const reachable = new Set();
  const queue = [];
  const normalizedEntrypoint = normalizeAbsolutePath(entrypoint);

  if (graph.allFilesSet.has(normalizedEntrypoint)) {
    reachable.add(normalizedEntrypoint);
    queue.push(normalizedEntrypoint);
  } else if (debug) {
    console.error(`Entrypoint not found: ${normalizedEntrypoint}`);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const nexts = graph.edges.get(current);
    if (!nexts) {
      continue;
    }
    for (const next of nexts) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  return reachable;
};

const collectUnusedFiles = () => {
  const runtimeGraph = buildSourceGraph({ includeTests: false });
  const fullGraph = buildSourceGraph({ includeTests: true });
  const reachable = buildReachableSet(runtimeGraph);
  const unused = [];

  for (const file of runtimeGraph.allFilesSet) {
    if (reachable.has(file)) {
      continue;
    }

    const relativePath = normalizeRelPath(path.relative(root, file));
    if (isAllowedUnusedFile(relativePath)) {
      continue;
    }

    const referenceInfo = fullGraph.inboundByFile.get(file) ?? createReferenceInfo();
    unused.push({
      absolutePath: file,
      relativePath,
      nonTestRefCount: referenceInfo.nonTestRefCount,
      testRefCount: referenceInfo.testRefCount,
    });
  }

  return unused.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
};

const collectUnusedExports = () => {
  const allCodeFiles = scanDirs.flatMap((dir) =>
    walk(dir, (name) => codeExtensions.has(path.extname(name)))
  );
  const exportInfo = new Map();
  const usageInfo = new Map();
  const exportAllTargets = new Map();

  const ensureUsage = (filePath) => {
    const normalized = normalizeAbsolutePath(filePath);
    if (!usageInfo.has(normalized)) {
      usageInfo.set(normalized, {
        used: new Set(),
        allUsed: false,
      });
    }
    return usageInfo.get(normalized);
  };

  const addExport = (filePath, name) => {
    const normalized = normalizeAbsolutePath(filePath);
    if (!exportInfo.has(normalized)) {
      exportInfo.set(normalized, {
        named: new Set(),
      });
    }
    exportInfo.get(normalized).named.add(name);
  };

  const markAllUsed = (filePath) => {
    ensureUsage(filePath).allUsed = true;
  };

  const addExportAllTarget = (filePath, target) => {
    const normalized = normalizeAbsolutePath(filePath);
    if (!exportAllTargets.has(normalized)) {
      exportAllTargets.set(normalized, new Set());
    }
    exportAllTargets.get(normalized).add(normalizeAbsolutePath(target));
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
                usage.used.add((element.propertyName ?? element.name).text);
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

      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const target = resolveSpec(node.moduleSpecifier.text, file);
        if (target) {
          if (!node.exportClause) {
            addExportAllTarget(file, target);
          } else if (ts.isNamedExports(node.exportClause)) {
            const usage = ensureUsage(target);
            for (const element of node.exportClause.elements) {
              if (!element.isTypeOnly) {
                usage.used.add((element.propertyName ?? element.name).text);
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  for (const file of allCodeFiles) {
    if (!file.startsWith(srcRoot)) {
      continue;
    }
    if (isTestFile(file)) {
      continue;
    }

    const source = parseSourceFile(file);
    ts.forEachChild(source, (node) => {
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            if (!element.isTypeOnly) {
              addExport(file, element.name.text);
            }
          }
        }
      }

      if (
        ts.isVariableStatement(node) &&
        node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            addExport(file, decl.name.text);
          }
        }
      }

      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) &&
        node.name
      ) {
        addExport(file, node.name.text);
      }
    });
  }

  const usedByFile = new Map();
  const allUsedByFile = new Set();

  for (const [filePath, usage] of usageInfo.entries()) {
    if (usage.allUsed) {
      allUsedByFile.add(filePath);
    }
    if (usage.used.size > 0) {
      usedByFile.set(filePath, new Set(usage.used));
    }
  }

  const getUsedSet = (filePath) => {
    const normalized = normalizeAbsolutePath(filePath);
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
          if (sourceAllUsed || sourceUsed.size > 0) {
            if (!allUsedByFile.has(target)) {
              allUsedByFile.add(target);
              changed = true;
            }
          }
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
  const exportCountsByFile = new Map();

  for (const [filePath, exports] of exportInfo.entries()) {
    exportCountsByFile.set(filePath, exports.named.size);
    if (exports.named.size === 0 || allUsedByFile.has(filePath)) {
      continue;
    }

    const relativeFilePath = normalizeRelPath(path.relative(root, filePath));
    if (isAllowedUnusedExportFile(relativeFilePath)) {
      continue;
    }

    const used = usedByFile.get(filePath) ?? new Set();
    const unused = [...exports.named].filter((name) => !used.has(name));
    const remainingUnused = filterAllowlistedUnusedExports(relativeFilePath, unused).sort();
    if (remainingUnused.length > 0) {
      unusedExports.push({
        absolutePath: filePath,
        file: relativeFilePath,
        names: remainingUnused,
      });
    }
  }

  unusedExports.sort((left, right) => left.file.localeCompare(right.file));

  return {
    exportCountsByFile,
    unusedExports,
  };
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
      if (
        spec.startsWith(".") ||
        spec.startsWith("/") ||
        spec.startsWith("@/") ||
        spec.startsWith("node:")
      ) {
        continue;
      }

      const parts = spec.split("/");
      const packageName = spec.startsWith("@")
        ? `${parts[0]}/${parts[1]}`
        : parts[0];
      used.add(packageName);
    }
  }

  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return Object.keys(pkgJson.dependencies || {})
    .filter((dep) => !used.has(dep))
    .sort();
};

const resolvePathRisk = (relativePath) =>
  DEAD_CODE_PATH_RISK_RULES.find((rule) => relativePath.startsWith(rule.prefix)) ??
  DEAD_CODE_DEFAULT_PATH_RISK;

const scoreByCount = (count, perPoint, maxPoints) => {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.min(maxPoints, Math.ceil(count / perPoint));
};

const resolveUnusedFileUsageKind = ({ nonTestRefCount, testRefCount }) => {
  if (nonTestRefCount === 0 && testRefCount === 0) {
    return "orphan";
  }
  if (nonTestRefCount === 0) {
    return "test-only";
  }
  return "dead-branch";
};

const resolveUnusedFileUsagePoints = (usageKind) => {
  switch (usageKind) {
    case "orphan":
      return DEAD_CODE_ORPHAN_FILE_POINTS;
    case "test-only":
      return DEAD_CODE_TEST_ONLY_FILE_POINTS;
    default:
      return DEAD_CODE_CLUSTER_FILE_POINTS;
  }
};

const scoreUnusedFile = (entry) => {
  const pathRisk = resolvePathRisk(entry.relativePath);
  const usageKind = resolveUnusedFileUsageKind(entry);
  const sizePoints = scoreByCount(
    entry.lineCount,
    DEAD_CODE_FILE_LINES_PER_POINT,
    DEAD_CODE_MAX_FILE_SIZE_POINTS
  );
  const exportPoints = scoreByCount(
    entry.exportCount,
    DEAD_CODE_EXPORTS_PER_POINT,
    DEAD_CODE_MAX_FILE_EXPORT_POINTS
  );
  const usagePoints = resolveUnusedFileUsagePoints(usageKind);

  return {
    ...entry,
    pathRiskLabel: pathRisk.label,
    pathRiskScore: pathRisk.score,
    score: pathRisk.score + sizePoints + exportPoints + usagePoints,
    usageKind,
  };
};

const scoreUnusedExport = (entry) => {
  const pathRisk = resolvePathRisk(entry.file);
  const countPoints = scoreByCount(
    entry.names.length,
    DEAD_CODE_EXPORTS_PER_POINT,
    DEAD_CODE_MAX_UNUSED_EXPORT_POINTS
  );
  const sizePoints = scoreByCount(
    entry.lineCount,
    DEAD_CODE_FILE_LINES_PER_POINT,
    DEAD_CODE_MAX_FILE_SIZE_POINTS
  );

  return {
    ...entry,
    count: entry.names.length,
    pathRiskLabel: pathRisk.label,
    pathRiskScore: pathRisk.score,
    score: pathRisk.score + countPoints + sizePoints,
  };
};

const scoreUnusedDependency = (name) => ({
  name,
  score: DEAD_CODE_UNUSED_DEPENDENCY_POINTS,
});

const buildDeadCodeReport = () => {
  const { exportCountsByFile, unusedExports } = collectUnusedExports();
  const unusedFiles = collectUnusedFiles()
    .map((entry) => ({
      ...entry,
      exportCount: exportCountsByFile.get(entry.absolutePath) ?? 0,
      lineCount: countLines(entry.absolutePath),
    }))
    .map(scoreUnusedFile)
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));

  const scoredUnusedExports = unusedExports
    .map((entry) => ({
      ...entry,
      lineCount: countLines(entry.absolutePath),
    }))
    .map(scoreUnusedExport)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  const scoredUnusedDependencies = collectUnusedDependencies()
    .map(scoreUnusedDependency)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  const totalRiskScore =
    unusedFiles.reduce((sum, entry) => sum + entry.score, 0) +
    scoredUnusedExports.reduce((sum, entry) => sum + entry.score, 0) +
    scoredUnusedDependencies.reduce((sum, entry) => sum + entry.score, 0);

  return {
    summary: {
      totalRiskScore,
      unusedFileCount: unusedFiles.length,
      orphanFileCount: unusedFiles.filter((entry) => entry.usageKind === "orphan").length,
      testOnlyFileCount: unusedFiles.filter((entry) => entry.usageKind === "test-only").length,
      deadBranchFileCount: unusedFiles.filter((entry) => entry.usageKind === "dead-branch").length,
      unusedExportCount: scoredUnusedExports.reduce(
        (sum, entry) => sum + entry.count,
        0
      ),
      unusedDependencyCount: scoredUnusedDependencies.length,
    },
    unusedDependencies: scoredUnusedDependencies,
    unusedExports: scoredUnusedExports,
    unusedFiles,
  };
};

const printList = (title, items, renderItem, output = console.error) => {
  if (items.length === 0) {
    return;
  }
  output(title);
  for (const item of items) {
    output(`  - ${renderItem(item)}`);
  }
};

const printDeadCodeIssues = (report) => {
  printList(
    "Unused source files detected:",
    report.unusedFiles,
    (entry) => entry.relativePath
  );
  printList(
    "Unused dependencies detected:",
    report.unusedDependencies,
    (entry) => entry.name
  );
  printList(
    "Unused exports detected:",
    report.unusedExports,
    (entry) => `${entry.file}: ${entry.names.join(", ")}`
  );
};

const printRankedSection = (title, items, renderItem) => {
  if (items.length === 0) {
    return;
  }
  console.log(title);
  for (const item of items.slice(0, DEAD_CODE_REPORT_ITEM_LIMIT)) {
    console.log(`  - ${renderItem(item)}`);
  }
};

const printDeadCodeReport = (report) => {
  console.log("Dead surface report:");
  console.log(`  Total risk score: ${report.summary.totalRiskScore}`);
  console.log(
    `  Unused files: ${report.summary.unusedFileCount} (${report.summary.orphanFileCount} orphan, ${report.summary.deadBranchFileCount} dead-branch, ${report.summary.testOnlyFileCount} test-only)`
  );
  console.log(`  Unused exports: ${report.summary.unusedExportCount}`);
  console.log(`  Unused dependencies: ${report.summary.unusedDependencyCount}`);

  printRankedSection(
    "Top unused files:",
    report.unusedFiles,
    (entry) =>
      `${entry.score} ${entry.relativePath} [${entry.usageKind}, ${entry.lineCount} lines, ${entry.exportCount} exports, ${entry.pathRiskLabel}]`
  );
  printRankedSection(
    "Top unused exports:",
    report.unusedExports,
    (entry) =>
      `${entry.score} ${entry.file} [${entry.count} exports, ${entry.lineCount} lines, ${entry.pathRiskLabel}] -> ${entry.names.join(", ")}`
  );
  printRankedSection(
    "Unused dependencies:",
    report.unusedDependencies,
    (entry) => `${entry.score} ${entry.name}`
  );
};

const args = new Set(process.argv.slice(2));
const renderJson = args.has("--json");
const renderReport = renderJson || args.has("--report");
const shouldFailOnIssues = !args.has("--no-fail");

const report = buildDeadCodeReport();
const hasIssues =
  report.unusedFiles.length > 0 ||
  report.unusedExports.length > 0 ||
  report.unusedDependencies.length > 0;

if (renderJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (renderReport) {
    printDeadCodeReport(report);
  }
  if (hasIssues) {
    printDeadCodeIssues(report);
  } else if (!renderReport) {
    console.log("Dead-code scan passed.");
  }
}

if (hasIssues && shouldFailOnIssues) {
  process.exit(1);
}
