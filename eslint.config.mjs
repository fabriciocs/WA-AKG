import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These Node CLI helpers run as CommonJS because the package has no ESM type.
    // Keep require limited to their declared runtime modules.
    files: ["scripts/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": ["error", {
        allow: ["^(?:@prisma/client|node:child_process|node:path|net|fs|path|child_process|bcryptjs)$"],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
