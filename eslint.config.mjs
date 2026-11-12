import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'src/generated/prisma/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // TypeScript compiler (strict + noImplicitAny) owns unresolved-name checks.
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Existing integration fixtures deliberately use broad test-only casts.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
