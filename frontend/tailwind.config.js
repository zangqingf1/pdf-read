/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Design-system palette (from DESIGN.md) ──
        canvas: {
          DEFAULT: '#faf9f5',
          soft: '#f5f0e8',
        },
        'surface-card': '#efe9de',
        'surface-cream-strong': '#e8e0d2',
        'surface-dark': {
          DEFAULT: '#181715',
          elevated: '#252320',
          soft: '#1f1e1b',
        },

        primary: {
          DEFAULT: '#cc785c',
          active: '#a9583e',
          disabled: '#e6dfd8',
        },

        ink: '#141413',
        body: {
          DEFAULT: '#3d3d3a',
          strong: '#252523',
        },
        muted: {
          DEFAULT: '#6c6a64',
          soft: '#8e8b82',
        },

        hairline: {
          DEFAULT: '#e6dfd8',
          soft: '#ebe6df',
        },

        'on-primary': '#ffffff',
        'on-dark': '#faf9f5',
        'on-dark-soft': '#a09d96',

        accent: {
          teal: '#5db8a6',
          amber: '#e8a55a',
        },

        success: '#5db872',
        warning: '#d4a017',
        error: '#c64545',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Garamond', '"Times New Roman"', 'serif'],
        reading: ['Georgia', '"Times New Roman"', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        chinese: ['"PingFang SC"', '"Noto Sans SC"', '"Microsoft YaHei"', '"Hiragino Sans GB"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '9999px',
        full: '9999px',
      },
      fontSize: {
        'display-xl': ['64px', { lineHeight: '1.05', letterSpacing: '-1.5px' }],
        'display-lg': ['48px', { lineHeight: '1.1', letterSpacing: '-1px' }],
        'display-md': ['36px', { lineHeight: '1.15', letterSpacing: '-0.5px' }],
        'display-sm': ['28px', { lineHeight: '1.2', letterSpacing: '-0.3px' }],
      },
      maxWidth: {
        content: '1200px',
        article: '950px',
        reading: '720px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(20, 20, 19, 0.08)',
        modal: '0 4px 24px rgba(20, 20, 19, 0.12)',
        float: '0 2px 8px rgba(20, 20, 19, 0.10)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
  corePlugins: {
    preflight: true, // No more Ant Design — enable Tailwind reset
  },
};
