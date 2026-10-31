// Shared ESLint flat config. Project rules from CLAUDE.md that a linter can enforce live here:
// - all calendar math goes through @idrok/shared/time (no local Date getters/setters, no Date(string) parsing);
// - no hard-coded colours in UI code (semantic tokens only);
// - layer boundaries (web never touches the DB, the domain layer stays pure).
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const DATE_METHODS = [
  "getDate",
  "getDay",
  "getMonth",
  "getFullYear",
  "getYear",
  "getHours",
  "getMinutes",
  "getTimezoneOffset",
  "setDate",
  "setMonth",
  "setFullYear",
  "setHours",
  "setMinutes",
  "setSeconds",
  "toLocaleDateString",
  "toLocaleTimeString",
];

const TAILWIND_COLOR_UTILITIES =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|accent|caret|divide|placeholder|ring-offset";
const ARBITRARY_COLOR = `(^|\\s|:)(${TAILWIND_COLOR_UTILITIES})-\\[(#|rgb|rgba|hsl|hsla|oklch|oklab|color)`;

export const timeRules = {
  selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(${DATE_METHODS.join("|")})$/]`,
  message: "Local Date math is forbidden (CLAUDE.md §4). Use @idrok/shared/time.",
};

export const dateStringRule = {
  selector: "NewExpression[callee.name='Date'][arguments.length=1][arguments.0.type='Literal']",
  message: "Parsing date strings with new Date(...) is forbidden. Use @idrok/shared/time.",
};

export const colorRules = [
  {
    selector: `Literal[value=/${ARBITRARY_COLOR}/]`,
    message: "Hard-coded colours are forbidden. Use semantic tokens (bg-primary, var(--color-primary)).",
  },
  {
    selector: `TemplateElement[value.raw=/${ARBITRARY_COLOR}/]`,
    message: "Hard-coded colours are forbidden. Use semantic tokens (bg-primary, var(--color-primary)).",
  },
  {
    selector: "Literal[value=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
    message: "Hex colours belong in the token stylesheet, not in components.",
  },
];

/** Restricted-syntax list for code that must stay timezone-safe. */
export const projectSyntaxRules = [timeRules, dateStringRule];

export const baseConfig = tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/coverage/**", "**/generated/**", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": ["error", ...projectSyntaxRules],
    },
  },
  {
    // The time module is the one place allowed to touch Date internals.
    files: ["**/shared/src/time/**"],
    rules: { "no-restricted-syntax": "off" },
  },
);

export const webConfig = tseslint.config(...baseConfig, {
  files: ["**/*.ts", "**/*.tsx"],
  plugins: { "react-hooks": reactHooks },
  languageOptions: { globals: { ...globals.browser } },
  rules: {
    ...reactHooks.configs.recommended.rules,
    "no-restricted-syntax": ["error", ...projectSyntaxRules, ...colorRules],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["@idrok/db", "@idrok/db/*", "@prisma/*"], message: "The web app never talks to the database." },
          { group: ["@idrok/api", "@idrok/api/*"], message: "The web app talks to the API over HTTP only." },
        ],
      },
    ],
  },
});

/** Pure domain layer: no I/O, no framework, no Prisma. */
export const domainRestrictions = {
  files: ["**/src/domain/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@prisma/*", "@idrok/db", "@idrok/db/*", "express", "ioredis", "bullmq", "**/infra/**"],
            message: "The domain layer stays pure (no DB, HTTP or queue imports).",
          },
        ],
      },
    ],
  },
};
