// ESLint-Konfiguration (Flat Config).
//
// Bis hierher gab es keine: das `eslint-disable react-hooks/exhaustive-deps` in
// ChatPage war dekorativ, weil nichts es je gelesen hat. Der Regelsatz ist
// bewusst schmal — er soll Fehler finden, die TypeScript nicht sieht
// (Hook-Abhängigkeiten, unbenutzte Variablen), und nicht über Stil streiten;
// dafür ist der Formatter da.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Absichtlich ungenutzte Argumente mit _ kennzeichnen dürfen.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` ist in dieser Codebasis die Ausnahme (zwei Stellen an der
      // Graph-Bibliothek) und soll auffallen, ohne den Lauf zu stoppen.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Kein HMR-Grenzfall: main.tsx ist der Einstieg, die beiden anderen geben
    // neben der Komponente bewusst Konstanten bzw. einen Hook heraus.
    files: ['src/main.tsx', 'src/components/ui/Toast.tsx', 'src/components/graph/GraphCanvas.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
)
