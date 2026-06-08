import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const baseTypeScriptRules = {
  ...reactHooks.configs.recommended.rules,
  "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  "@typescript-eslint/no-unused-vars": "off",
  "@typescript-eslint/no-explicit-any": "warn",
};

export default tseslint.config(
  { ignores: [".venv", ".venv-lerobot", ".uv-cache", "node_modules", "**/dist", "third_party"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...baseTypeScriptRules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/runtime/viz2/*"],
              message:
                "Import RosViz runtime modules from '@/runtime_engine/rosviz/*'.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["web/src/runtime_engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/studio_ui/*"],
              message: "runtime_engine must not import studio_ui.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["web/src/studio_core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/studio_ui/*"],
              message: "studio_core must not import studio_ui.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["web/src/studio_ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/runtime/viz2/*"],
              message:
                "studio_ui must consume runtime contracts through '@/runtime_engine/rosviz/*'.",
            },
          ],
        },
      ],
    },
  }
);
