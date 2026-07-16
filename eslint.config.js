import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Light, non-type-checked config: catches real problems (unused vars, unsafe
// patterns) without imposing a heavy stylistic rewrite on the existing codebase.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "lib", "public", "scripts", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
);
