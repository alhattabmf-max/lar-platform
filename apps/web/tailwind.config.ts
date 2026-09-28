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
        "line-control": "var(--color-border-control)",
        band: {
          panel: "var(--color-band-panel)",
          "panel-line": "var(--color-band-panel-line)",
        },
        "field-fill": "var(--color-field-fill)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        // Every control shares one radius. `rounded-control` says
        // which rule a component is following; `rounded-md` only says
        // how round it happens to be.
        control: "var(--control-radius)",
        // A card corner, rounder than a control's.
        card: "var(--radius-card)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",

        // SOFT ELEVATION. Named for what the surface IS, not for how
        // dark the shadow is — so a component cannot pick the wrong
        // one and still look deliberate.
        inset: "var(--elevation-inset)",
        raised: "var(--elevation-raised)",
        soft: "var(--elevation-soft)",
        card: "var(--elevation-card)",
        overlay: "var(--elevation-overlay)",
        divide: "var(--elevation-divide)",
        pressed: "var(--elevation-pressed)",

        // FOCUS COMPOSES, it does not replace. A focused field is still
        // a well and a focused button is still raised — the halo is
        // added to what the control already carries, which is why each
        // resting elevation has a focused twin rather than there being
        // one `shadow-focus` that would flatten whatever it lands on.
        "inset-focus": "var(--elevation-inset), var(--ring-focus)",
        "soft-focus": "var(--elevation-soft), var(--ring-focus)",
        "raised-focus": "var(--elevation-raised), var(--ring-focus)",
      },
      height: {
        control: "var(--control-height-button)",
        field: "var(--control-height-field)",
      },
      minHeight: {
        control: "var(--control-height-button)",
        field: "var(--control-height-field)",
        nav: "var(--nav-item-height)",
      },
      spacing: {
        "control-x": "var(--control-pad-x)",
        "control-y": "var(--control-pad-y-button)",
        "control-gap": "var(--control-icon-gap)",
        "card-x": "var(--card-pad-x)",
        "card-y": "var(--card-pad-y)",
        "card-y-sectioned": "var(--card-pad-y-sectioned)",
        "card-gap": "var(--card-gap)",
      },
      size: {
        control: "var(--control-icon)",
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
