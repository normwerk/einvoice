// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.medusa/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  prettier,
  {
    rules: {
      // AGENTS.md §13: `any` is forbidden in new code.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // tools/codegen/* are plain Node scripts (ADR-002), not bundled — they
    // need Node's globals (console, process, ...).
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
