// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.medusa/**",
      // T-078: e2e/app/ is a committed `create-medusa-app` scaffold, not authored source — same
      // treatment as generated code (AGENTS.md §9), reformatting/relinting it is not our call to make.
      "e2e/app/**",
    ],
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
    // T-077 / AGENTS.md §12: text a user reads — an error message, a log line, the admin UI — never points
    // into the private planning workspace. Comments may; string literals in shipped source may not.
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/generated/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: String.raw`Literal[value=/\b[TPMD]-\d{2,3}\b|STRATEGY\.md|plan-v0\.1|plan-[a-z0-9.-]+\.md|ecom docs/]`,
          message:
            "Internal planning references belong in comments, not in text a user reads (AGENTS.md §12).",
        },
        {
          selector: String.raw`TemplateElement[value.raw=/\b[TPMD]-\d{2,3}\b|STRATEGY\.md|plan-v0\.1|plan-[a-z0-9.-]+\.md|ecom docs/]`,
          message:
            "Internal planning references belong in comments, not in text a user reads (AGENTS.md §12).",
        },
      ],
    },
  },
  {
    // tools/codegen/* are plain Node scripts (ADR-002), not bundled — they
    // need Node's globals (console, process, ...).
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
