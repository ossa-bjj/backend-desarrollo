// eslint.config.js
//
// Misma base que el frontend, sin lo que alli es de React. El backend no tenia
// linter ni formateador: el estilo lo decidia quien escribia, y en el lado del
// dinero eso significa que nadie avisa de un `await` olvidado.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'seed.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      // `console.log` no: en serverless el log es la unica traza que queda, y
      // mezclar depuracion con avisos reales la vuelve inservible.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',

      // Una promesa sin esperar en un flujo de cobro es dinero que se mueve sin
      // que nadie compruebe si salio bien.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // Va el ultimo: apaga las reglas de estilo que ya gobierna Prettier.
  prettier,
);
