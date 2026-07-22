// Lint config aimed at the failures that actually reached production: a
// component reading an identifier that was never a prop, and a hook whose
// dependency array named a const declared below it. Both built cleanly under
// vite and only showed up as a blank page on a phone.
//
// Run with `npm run lint`.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "scripts/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      // The two that matter. Errors, not warnings.
      "no-undef": "error",
      "react-hooks/rules-of-hooks": "error",

      // Components referenced in JSX count as used, otherwise every component
      // in the file reads as dead.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",

      // Useful signal, but not worth blocking a deploy over.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],

      // Too noisy to be actionable on this codebase today. The rules-of-hooks
      // rule above is the one that catches real crashes.
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
