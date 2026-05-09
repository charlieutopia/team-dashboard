import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        trajectory: {
          on_track: '#22c55e',
          ahead: '#3b82f6',
          behind: '#f59e0b',
          stuck: '#ef4444',
          no_activity: '#9ca3af',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
