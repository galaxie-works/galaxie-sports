import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/dist/**',
      '**/coverage/**',
      '**/drizzle/**',
      'data/**',
      'docs/**',
      '**/.next/**',
      '**/.turbo/**',
      // Componentes gerados pelos registries (shadcn, ReUI, Animate UI, SmoothUI): mantidos como vêm
      'apps/demo/src/components/{ui,reui,examples,animate-ui,smoothui}/**',
      'apps/demo/src/hooks/**',
      // Fontes dos widgets embutidos como texto (packages/widgets/scripts/embed-sources.mjs)
      'packages/widgets/src/registry/sources.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Scripts k6 (tests/load): rodam no runtime do k6, não no Node.
    files: ['tests/load/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly' },
    },
  },
);
