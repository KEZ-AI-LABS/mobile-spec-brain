import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".spec-brain/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Dense one-line statement chains are what made this codebase hard to
      // review; these keep it from drifting back.
      "max-statements-per-line": ["error", { max: 1 }],
      curly: ["error", "multi-line"],
      eqeqeq: ["error", "always"],
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
