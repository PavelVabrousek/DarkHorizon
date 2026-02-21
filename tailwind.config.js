/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'night': {
          50:  '#e8e8f0',
          100: '#c5c5d8',
          200: '#9e9ebd',
          300: '#7777a2',
          400: '#58588e',
          500: '#3a3a7a',
          600: '#2e2e66',
          700: '#1e1e4d',
          800: '#12122e',
          900: '#0a0a1a',
          950: '#050510',
        },
        'star': {
          yellow:  '#f59e0b',
          blue:    '#93c5fd',
          white:   '#f1f5f9',
        },
        'score': {
          green:  '#22c55e',
          yellow: '#eab308',
          red:    '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
