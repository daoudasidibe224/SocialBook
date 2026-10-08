import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: ["node_modules/**", "client/dist/**", "tests/**/*.js", "dist/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
