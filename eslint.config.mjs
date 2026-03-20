import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  eslintPluginPrettierRecommended,
  {
    rules: {
      // Disallow any types on domain objects — use proper types from src/types/index.ts
      // Warn only (not error) since Meta API responses legitimately need any in some places
      '@typescript-eslint/no-explicit-any': 'warn',

      // Enforce consistent imports — no default exports from lib files
      // (Next.js pages/routes use default exports, so warn not error)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../../*'],
              message: 'Use @/ path alias instead of relative imports.',
            },
          ],
        },
      ],

      // Prevent accidental console.log left in code (console.error/warn are fine)
      'no-console': ['warn', { allow: ['error', 'warn'] }],

      // Unused variables are errors — they clutter the codebase
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Prefer const over let when variable is never reassigned
      'prefer-const': 'error',

      // Padding lines rules for better readability
      'padding-line-between-statements': [
        'warn',
        // Require blank line after variable declarations
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        // Require blank line before return statements
        { blankLine: 'always', prev: '*', next: 'return' },
        // Require blank line after imports
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        // Require blank line before and after blocks
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        // Require blank line after directives
        { blankLine: 'always', prev: 'directive', next: '*' },
        { blankLine: 'any', prev: 'directive', next: 'directive' },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**']),
]);

export default eslintConfig;
