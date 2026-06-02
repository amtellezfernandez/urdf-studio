import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

import {
  findNewViolations,
  isScalarInitializer,
} from "./topLevelScalarConstantAudit.js";

function parseInitializer(sourceText) {
  const sourceFile = ts.createSourceFile(
    "fixture.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const statement = sourceFile.statements[0];
  assert.ok(ts.isVariableStatement(statement));
  const declaration = statement.declarationList.declarations[0];
  assert.ok(declaration.initializer);
  return declaration.initializer;
}

test("top-level scalar audit identifies scalar initializer shapes", () => {
  const scalarSamples = [
    'const VALUE = "literal";',
    "const VALUE = 42;",
    "const VALUE = -42;",
    "const VALUE = 42n;",
    "const VALUE = true;",
    "const VALUE = false;",
    "const VALUE = null;",
    "const VALUE = `literal`;",
  ];

  for (const sourceText of scalarSamples) {
    assert.equal(isScalarInitializer(parseInitializer(sourceText)), true, sourceText);
  }

  const nonScalarSamples = [
    "const VALUE = { timeoutMs: 42 };",
    "const VALUE = [42];",
    "const VALUE = buildValue(42);",
    "const VALUE = SOME_VALUE;",
  ];

  for (const sourceText of nonScalarSamples) {
    assert.equal(isScalarInitializer(parseInitializer(sourceText)), false, sourceText);
  }
});

test("top-level scalar audit rejects constants missing from the baseline", () => {
  const testFixture = { firstLineNumber: 1 };
  const hits = [
    {
      file: "web/src/allowed.ts",
      line: testFixture.firstLineNumber,
      name: "ALLOWED_EXISTING_VALUE",
      initializer: '"kept"',
    },
    {
      file: "web/src/allowed.ts",
      line: testFixture.firstLineNumber,
      name: "ALLOWED_EXISTING_VALUE",
      initializer: '"changed"',
    },
    {
      file: "web/src/newFeature.ts",
      line: testFixture.firstLineNumber,
      name: "NEW_TOP_LEVEL_VALUE",
      initializer: '"blocked"',
    },
  ];

  const violations = findNewViolations(hits, {
    files: {
      "web/src/allowed.ts": [
        { name: "ALLOWED_EXISTING_VALUE", initializer: '"kept"' },
      ],
    },
  });

  assert.deepEqual(
    violations.map((hit) => hit.name),
    ["ALLOWED_EXISTING_VALUE", "NEW_TOP_LEVEL_VALUE"]
  );
});
