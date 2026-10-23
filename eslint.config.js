import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [{ ignores: ['dist/', 'node_modules/', '.worktrees/'] }, js.configs.recommended, ...tseslint.configs.recommended, { files: ['scripts/**', 'test/**', 'eval/**'], languageOptions: { globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } }];
