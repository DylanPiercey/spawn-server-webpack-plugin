module.exports = {
  root: true,
  env: {
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json"],
  },
  extends: [
    "eslint:recommended",
    "plugin:jest/recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier/@typescript-eslint",
  ],
  rules: {
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
  },
};
