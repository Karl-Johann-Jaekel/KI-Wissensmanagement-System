/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Markenakzent: gedecktes Grün (Jobgether-inspiriert), Anker #3ca66a.
        primary: {
          50: '#f2f9f5',
          100: '#e0f1e8',
          200: '#c3e3d2',
          300: '#97ceb1',
          400: '#66b28b',
          500: '#3ca66a',
          600: '#2f8a57',
          700: '#276e47',
          800: '#22583b',
          900: '#1d4931',
          950: '#0e281b',
        },
        // Semantische Flächen-Tokens als CSS-Variablen: Komponenten schreiben nie
        // `dark:` für Flächen — das Theme wechselt über :root/.dark in index.css.
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        sunken: 'rgb(var(--c-sunken) / <alpha-value>)',
        edge: 'rgb(var(--c-edge) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
