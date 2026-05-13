import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
];
