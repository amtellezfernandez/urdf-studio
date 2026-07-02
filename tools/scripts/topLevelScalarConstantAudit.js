#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const baselinePath = path.join(__dirname, "topLevelScalarConstantBaseline.json");

const AUDIT_PARAMS = {
  ignoredDirectories: [
    ".cache",
    ".claude",
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".uv-cache",
    ".venv",
    ".venv-lerobot",
    ".venv-sim311",
    "dist",
    "node_modules",
    "third_party",
  ],
  sourceExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  schemaVersion: 1,
  sourceLineNumberOffset: 1,
  reportExampleLimit: 12,
  maxViolationExamples: 50,
  baselineSignatureSeparator: "\0",
};
const IGNORED_DIRECTORIES = new Set(AUDIT_PARAMS.ignoredDirectories);
const isIgnoredDirectory = (name) =>
  IGNORED_DIRECTORIES.has(name) || name.startsWith(".venv-");

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return {
    report: args.has("--report"),
    updateBaseline: args.has("--update-baseline"),
  };
};

const toRel = (absolutePath) => path.relative(root, absolutePath).replace(/\\/g, "/");

const walkSourceFiles = (directory, files = []) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && isIgnoredDirectory(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, files);
      continue;
    }

    if (AUDIT_PARAMS.sourceExtensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(fullPath);
    }
  }
  return files;
};

const isScalarInitializer = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNumericLiteral(node) ||
  ts.isBigIntLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  node.kind === ts.SyntaxKind.TrueKeyword ||
  node.kind === ts.SyntaxKind.FalseKeyword ||
  node.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isPrefixUnaryExpression(node) &&
    (ts.isNumericLiteral(node.operand) || ts.isBigIntLiteral(node.operand)));

const parseSourceFile = (absolutePath) => {
  const sourceText = fs.readFileSync(absolutePath, "utf8");
  const isJsx = absolutePath.endsWith(".tsx") || absolutePath.endsWith(".jsx");
  return ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
};

const collectTopLevelScalarConstants = () => {
  const hits = [];
  for (const absolutePath of walkSourceFiles(root)) {
    const sourceFile = parseSourceFile(absolutePath);
    const relativePath = toRel(absolutePath);

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (!isScalarInitializer(declaration.initializer)) continue;

        const { line } = sourceFile.getLineAndCharacterOfPosition(
          declaration.name.getStart(sourceFile)
        );
        hits.push({
          file: relativePath,
          line: line + AUDIT_PARAMS.sourceLineNumberOffset,
          name: declaration.name.text,
          initializer: declaration.initializer.getText(sourceFile),
        });
      }
    }
  }

  return hits.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.name.localeCompare(right.name)
  );
};

const buildBaseline = (hits) => {
  const files = {};
  for (const hit of hits) {
    files[hit.file] ??= [];
    files[hit.file].push({ name: hit.name, initializer: hit.initializer });
  }

  Object.keys(files).forEach((file) => {
    const uniqueEntries = new Map(
      files[file].map((entry) => [hitSignature(entry), entry])
    );
    files[file] = [...uniqueEntries.values()].sort((left, right) =>
      left.name.localeCompare(right.name) || left.initializer.localeCompare(right.initializer)
    );
  });

  return {
    schemaVersion: AUDIT_PARAMS.schemaVersion,
    description:
      "Baseline of existing top-level scalar const declarations. New entries fail tools/scripts/topLevelScalarConstantAudit.js.",
    totalConstants: hits.length,
    fileCount: Object.keys(files).length,
    files,
  };
};

const loadBaseline = () => {
  if (!fs.existsSync(baselinePath)) {
    throw new Error(
      `Missing ${toRel(baselinePath)}. Run node tools/scripts/topLevelScalarConstantAudit.js --update-baseline after reviewing the initial audit.`
    );
  }
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
};

const hitSignature = (hit) =>
  `${hit.name}${AUDIT_PARAMS.baselineSignatureSeparator}${hit.initializer}`;

const findNewViolations = (hits, baseline) => {
  const allowedByFile = new Map(
    Object.entries(baseline.files ?? {}).map(([file, entries]) => [
      file,
      new Set(entries.map((entry) => hitSignature(entry))),
    ])
  );

  return hits.filter((hit) => !allowedByFile.get(hit.file)?.has(hitSignature(hit)));
};

const summarizeBuckets = (hits) => {
  const buckets = new Map();
  const classify = (file) => {
    if (/\.test\.[cm]?[jt]sx?$/.test(file)) return "tests";
    if (/(params|Params|config|Config|constants|Constants)\.[cm]?[jt]sx?$/.test(path.basename(file))) {
      return "params/config/constants";
    }
    if (file.startsWith("config/")) return "config";
    if (file.startsWith("tools/")) return "tools";
    if (file.startsWith("runtime/")) return "runtime";
    return "production-other";
  };

  for (const hit of hits) {
    const bucket = classify(hit.file);
    const summary = buckets.get(bucket) ?? { count: 0, examples: [] };
    summary.count += 1;
    if (summary.examples.length < AUDIT_PARAMS.reportExampleLimit) {
      summary.examples.push(`${hit.file}:${hit.line} ${hit.name}`);
    }
    buckets.set(bucket, summary);
  }

  return [...buckets.entries()].sort((left, right) => right[1].count - left[1].count);
};

const printReport = (hits) => {
  console.log(
    `Top-level scalar const audit: ${hits.length} declaration(s) across ${new Set(hits.map((hit) => hit.file)).size} file(s).`
  );
  for (const [bucket, summary] of summarizeBuckets(hits)) {
    console.log(`\n${bucket}: ${summary.count}`);
    summary.examples.forEach((example) => console.log(`  ${example}`));
  }
};

const writeBaseline = (hits) => {
  const baseline = buildBaseline(hits);
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Updated ${toRel(baselinePath)} with ${baseline.totalConstants} top-level scalar const declaration(s).`
  );
};

const main = () => {
  const options = parseArgs();
  const hits = collectTopLevelScalarConstants();

  if (options.report) {
    printReport(hits);
  }

  if (options.updateBaseline) {
    writeBaseline(hits);
    return;
  }

  const baseline = loadBaseline();
  const violations = findNewViolations(hits, baseline);
  if (violations.length > 0) {
    console.error("Top-level scalar const audit failed: new declaration(s) found.");
    violations.slice(0, AUDIT_PARAMS.maxViolationExamples).forEach((hit) => {
      console.error(`  - ${hit.file}:${hit.line} ${hit.name} = ${hit.initializer}`);
    });
    if (violations.length > AUDIT_PARAMS.maxViolationExamples) {
      console.error(`  ... ${violations.length - AUDIT_PARAMS.maxViolationExamples} more`);
    }
    console.error(
      "Move scalar test data into a local fixture object, or move runtime tunables into a reviewed params/config module and intentionally update the baseline."
    );
    process.exit(1);
  }

  console.log(
    `Top-level scalar const audit passed (${hits.length}/${baseline.totalConstants} baseline declaration(s) remain).`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}

export {
  buildBaseline,
  findNewViolations,
  isScalarInitializer,
  summarizeBuckets,
};
