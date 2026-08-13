import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  // Scan all of src so utility classes defined in lib/ (e.g. disposition
  // button colours) are generated, not just those in app/ and components/.
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Nimbaa brand accents (logo-matching)
        brand: {
          green: 'hsl(var(--brand-green))',
          amber: 'hsl(var(--brand-amber))',
          brown: 'hsl(var(--brand-brown))',
        },
        // Disposition colors (D2D turf pins + charts)
        knock: {
          grey: 'hsl(var(--knock-grey))',
          red: 'hsl(var(--knock-red))',
          yellow: 'hsl(var(--knock-yellow))',
          green: 'hsl(var(--knock-green))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
