module.exports = {
  root: true,
  ignorePatterns: ['**/dist/**', '**/node_modules/**', 'docs/**'],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
    {
      files: ['packages/web/**/*.{ts,tsx}'],
      env: {
        browser: true,
      },
      plugins: ['react-hooks', 'react-refresh'],
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
        'react-refresh/only-export-components': 'warn',
      },
    },
    {
      files: ['packages/api/**/*.ts'],
      env: {
        node: true,
      },
    },
  ],
};
