/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:        { DEFAULT: '#0E2A33', 70: '#4A6670', 50: '#7A8E95', 30: '#B4C0C4', 10: '#E3E8E8' },
        paper:      '#F6F7F5',
        surface:    '#FFFFFF',
        signal:     { DEFAULT: '#0B7A6B', dark: '#085C51', tint: '#E6F2F0' },
        restricted: { DEFAULT: '#6B3FA0', dark: '#54307E', tint: '#F0EAF8' },
        alert:      { DEFAULT: '#B3321F', tint: '#FBEAE7' },
        amber:      { DEFAULT: '#B5761F', tint: '#FBF1E2' },
        night:      { DEFAULT: '#1A2F4A', tint: '#E7EBF1' },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { card: '6px' },
      boxShadow: {
        raise: '0 1px 2px rgba(14,42,51,.06), 0 4px 12px rgba(14,42,51,.06)',
        pop:   '0 8px 32px rgba(14,42,51,.16)',
      },
    },
  },
  plugins: [],
};
