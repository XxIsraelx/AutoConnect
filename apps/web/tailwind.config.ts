import type { Config } from 'tailwindcss';

const config: Config = {
  // 'class' em vez do padrão 'media': antes o tema seguia o sistema operacional
  // e não havia como escolher — abrir em outro computador mudava a aparência.
  // Agora quem manda é a classe `dark` no <html>, definida pelo ThemeProvider.
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0F172A',
          accent: '#3B82F6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
