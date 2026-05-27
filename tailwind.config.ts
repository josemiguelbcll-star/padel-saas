import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Todo color y radio se referencia vía CSS custom properties definidas en
// src/styles/globals.css. Para reskinear la app entera basta con cambiar
// las vars en globals.css; ningún componente hardcodea valores.
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        // Estados de reserva (sección "Colores de estado" del sprint).
        // Se referencian desde componentes vía bg-estado-pagada, text-estado-cancelada, etc.
        estado: {
          pendiente: {
            DEFAULT: 'hsl(var(--estado-pendiente) / <alpha-value>)',
            foreground: 'hsl(var(--estado-pendiente-foreground) / <alpha-value>)',
          },
          senada: {
            DEFAULT: 'hsl(var(--estado-senada) / <alpha-value>)',
            foreground: 'hsl(var(--estado-senada-foreground) / <alpha-value>)',
          },
          pagada: {
            DEFAULT: 'hsl(var(--estado-pagada) / <alpha-value>)',
            foreground: 'hsl(var(--estado-pagada-foreground) / <alpha-value>)',
          },
          jugada: {
            DEFAULT: 'hsl(var(--estado-jugada) / <alpha-value>)',
            foreground: 'hsl(var(--estado-jugada-foreground) / <alpha-value>)',
          },
          cancelada: {
            DEFAULT: 'hsl(var(--estado-cancelada) / <alpha-value>)',
            foreground: 'hsl(var(--estado-cancelada-foreground) / <alpha-value>)',
          },
        },
        // Bloques de CLASE en la grilla (violeta). Distinto del set de
        // estados de reserva — las clases conceptualmente no son reservas.
        clase: {
          DEFAULT: 'hsl(var(--clase) / <alpha-value>)',
          foreground: 'hsl(var(--clase-foreground) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // Latido "en vivo" del indicador de caja abierta: parpadeo marcado
        // (opacidad 100%→25%→100%) que llama la atención, suave (ease-in-out).
        latido: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        latido: 'latido 1.3s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
