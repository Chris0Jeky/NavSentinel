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
      globals: { require: "readonly", module: "writable", process: "readonly", __dirname: "readonly", setTimeout: "readonly", document: "readonly" },
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
    // Dependency-free Node scripts, Gym fixture scripts, and this config are
    // JavaScript outside tsconfig. Lint them without a TypeScript project.
    // The browser globals cover page.evaluate callbacks in the Playwright
    // scripts and the Gym fixture script, which runs in the page.
    files: ["scripts/**/*.mjs", "gym/**/*.js", "eslint.config.js"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        AbortSignal: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        chrome: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        HTMLAnchorElement: "readonly",
        innerWidth: "readonly",
        localStorage: "readonly",
        location: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
      parserOptions: {
        project: false,
        projectService: false,
      },
    },
  },
  {
    // Playwright lanes the project service cannot resolve (they are not
    // reachable from tsconfig). Lint them without a TypeScript project; the
    // remaining configs keep type-aware parsing.
    files: [
      "playwright.acceptance.config.ts",
      "playwright.branded.config.ts",
      "playwright.corpus.config.ts",
      "playwright.demo.config.ts",
      "playwright.maintainer.config.ts",
    ],
    languageOptions: {
      parserOptions: {
        project: false,
        projectService: false,
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
      // Follow-up: these scripts need judgment-call fixes before they can
      // join lint coverage. check-release-profile/measure-fp throw without
      // `cause` (preserve-caught-error); deterministic-zip, measure-fp, and
      // release-input-integrity intentionally match control characters
      // (no-control-regex). Do not silence the rules to force green.
      "scripts/check-release-profile.mjs",
      "scripts/deterministic-zip.mjs",
      "scripts/measure-fp.mjs",
      "scripts/release-input-integrity.mjs",
    ],
  }
);
