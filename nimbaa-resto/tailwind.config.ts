import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#191C18', soft: '#585F57', faint: '#868C83' },
        paper: '#F6F5F1',
        'surface-2': '#EEEEE7',
        rule: '#DCDBD2',
        service: { DEFAULT: '#0B5D3B', soft: '#E2EEE6' },
      },
    },
  },
  plugins: [],
};
export default config;
