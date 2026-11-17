import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef5ff', 100: '#d9e8ff', 500: '#2f6fed', 600: '#1f5ad6', 700: '#1847ab', 900: '#0f2b66' },
      },
    },
  },
  plugins: [],
} satisfies Config;
