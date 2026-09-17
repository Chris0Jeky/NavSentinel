import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const happyDomRetentionHelpers = [
  "tests/helpers/happy-dom-mutation-observer-retention.mjs",
  "tests/helpers/happy-dom-mutation-observer-retention-setup.mjs",
];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-empty-pattern": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: happyDomRetentionHelpers,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: happyDomRetentionHelpers,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: [
      "extension/dist/**",
      "dist/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "artifacts/**",
      "gym/**",
      "scripts/**",
      "eslint.config.js",
      "vite.config.ts",
      "playwright.*.config.ts",
      "playwright.config.ts",
    ],
  }
);
