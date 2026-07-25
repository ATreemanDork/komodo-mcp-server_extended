// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginSecurity from "eslint-plugin-security";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: ["build/**", "node_modules/**", "**/*.js", "!eslint.config.js"],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript strict rules with type-aware linting
  ...tseslint.configs.strictTypeChecked,

  // Node.js security rules (OWASP patterns: eval, child_process, unsafe regex, etc.)
  pluginSecurity.configs.recommended,

  // Parser options for type-aware rules (scoped to TS files only)
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Framework-specific rule overrides
  {
    rules: {
      // Allow unused vars with _ prefix (common pattern for intentionally unused params)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Allow void for fire-and-forget async calls (used in constructors, event handlers)
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],

      // Async interface compliance — handlers must be async for interface contracts
      "@typescript-eslint/require-await": "off",

      // Defensive coding is intentional at system boundaries
      "@typescript-eslint/no-unnecessary-condition": "warn",

      // Not all string comparisons are security-sensitive
      "security/detect-possible-timing-attacks": "warn",

      // False positives on typed obj[key] access — TypeScript's type system handles this
      "security/detect-object-injection": "off",

      // ESM project — no require() usage
      "security/detect-non-literal-require": "off",
    },
  },

  // Prettier integration (must be last to override conflicting rules)
  eslintConfigPrettier,
  eslintPluginPrettier,
];
