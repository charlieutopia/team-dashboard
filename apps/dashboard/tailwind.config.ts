import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Everything readable — Hanken Grotesk: names, body, numbers, labels, chips.
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        // Editorial serif — Fraunces — ONLY for the single big banner date.
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      colors: {
        app: 'rgb(var(--app) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        'card-sunken': 'rgb(var(--card-sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',
        'ink-faint': 'rgb(var(--ink-faint) / <alpha-value>)',
        trajectory: {
          on_track: 'rgb(var(--trajectory-on-track) / <alpha-value>)',
          ahead: 'rgb(var(--trajectory-ahead) / <alpha-value>)',
          behind: 'rgb(var(--trajectory-behind) / <alpha-value>)',
          stuck: 'rgb(var(--trajectory-stuck) / <alpha-value>)',
          no_activity: 'rgb(var(--trajectory-no-activity) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
