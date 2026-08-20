import type { Config } from "tailwindcss";

/**
 * Every colour resolves to a CSS custom property defined in
 * app/globals.css. Nothing here restates a hex value, so the palette has
 * exactly one source of truth (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14).
 *
 * Light mode only — `darkMode` is deliberately not configured, because
 * dark mode is out of Phase 8.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          foreground: "var(--color-on-primary)",
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
          foreground: "var(--color-on-secondary)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-on-accent)",
          interactive: "var(--color-accent-interactive)",
          "interactive-foreground": "var(--color-on-accent-interactive)",
        },
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        content: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
        },
        line: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          foreground: "var(--color-on-success)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          text: "var(--color-warning-text)",
          surface: "var(--color-warning-surface)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          foreground: "var(--color-on-danger)",
        },
        focus: "var(--color-focus-ring)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      screens: {
        // The smallest supported viewport is 360px (§14.2).
        xs: "360px",
      },
    },
  },
  plugins: [],
};

export default config;
