/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary (Blue)
        primary: {
          DEFAULT: 'var(--color-primary)',
          dim: 'var(--color-primary-dim)',
          fixed: 'var(--color-primary-fixed)',
          'fixed-dim': 'var(--color-primary-fixed-dim)',
          container: 'var(--color-primary-container)',
          'on-primary': 'var(--color-on-primary)',
          'on-primary-fixed': 'var(--color-on-primary-fixed)',
          'on-primary-container': 'var(--color-on-primary-container)',
        },
        // Secondary (Purple)
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          dim: 'var(--color-secondary-dim)',
          fixed: 'var(--color-secondary-fixed)',
          'fixed-dim': 'var(--color-secondary-fixed-dim)',
          container: 'var(--color-secondary-container)',
          'on-secondary': 'var(--color-on-secondary)',
          'on-secondary-fixed': 'var(--color-on-secondary-fixed)',
          'on-secondary-container': 'var(--color-on-secondary-container)',
        },
        // Tertiary (Pink)
        tertiary: {
          DEFAULT: 'var(--color-tertiary)',
          dim: 'var(--color-tertiary-dim)',
          fixed: 'var(--color-tertiary-fixed)',
          'fixed-dim': 'var(--color-tertiary-fixed-dim)',
          container: 'var(--color-tertiary-container)',
          'on-tertiary': 'var(--color-on-tertiary)',
          'on-tertiary-fixed': 'var(--color-on-tertiary-fixed)',
          'on-tertiary-container': 'var(--color-on-tertiary-container)',
        },
        // Error
        error: {
          DEFAULT: 'var(--color-error)',
          dim: 'var(--color-error-dim)',
          container: 'var(--color-error-container)',
          'on-error': 'var(--color-on-error)',
          'on-error-container': 'var(--color-on-error-container)',
        },
        // Surface
        background: 'var(--color-background)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          dim: 'var(--color-surface-dim)',
          bright: 'var(--color-surface-bright)',
          tint: 'var(--color-surface-tint)',
          container: 'var(--color-surface-container)',
          'container-low': 'var(--color-surface-container-low)',
          'container-high': 'var(--color-surface-container-high)',
          'container-highest': 'var(--color-surface-container-highest)',
          'container-lowest': 'var(--color-surface-container-lowest)',
          variant: 'var(--color-surface-variant)',
        },
        // On-Surface
        'on-background': 'var(--color-on-background)',
        'on-surface': {
          DEFAULT: 'var(--color-on-surface)',
          variant: 'var(--color-on-surface-variant)',
        },
        // Outline
        outline: {
          DEFAULT: 'var(--color-outline)',
          variant: 'var(--color-outline-variant)',
        },
        // Inverse
        'inverse-surface': 'var(--color-inverse-surface)',
        'inverse-on-surface': 'var(--color-inverse-on-surface)',
        'inverse-primary': 'var(--color-inverse-primary)',
      },
      fontFamily: {
        headline: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
        '2xl': '0.75rem',
        full: '1rem',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}