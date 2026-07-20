import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  security.configs.recommended,
  {
    // These three syntax-only heuristics flag every validated variable path,
    // bounded dynamic regexp, and indexed lookup. Traversal, archive paths,
    // search patterns, and identifier lookups have dedicated tests instead.
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-object-injection": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);
