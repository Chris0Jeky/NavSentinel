import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

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
    // This dependency-free Node contract is JavaScript, not part of tsconfig.
    // Keep normal lint rules active without requiring a TypeScript project.
    files: ["tests/helpers/release-archive-adversarial.mjs"],
    languageOptions: {
      parserOptions: {
        project: false,
        projectService: false,
      },
    },
  },
  {
    // CommonJS preload loaded with `node --require`; also JavaScript outside
    // tsconfig, so lint it without a TypeScript project.
    files: ["tests/branded/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { require: "readonly", module: "writable", process: "readonly", __dirname: "readonly", setTimeout: "readonly" },
      parserOptions: {
        project: false,
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
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
