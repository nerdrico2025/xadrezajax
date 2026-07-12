const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/", "coverage/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Args prefixados com _ são intencionais (ex.: assinatura de middleware do Express)
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
