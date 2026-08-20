import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  BRAND_THEME_COLOR_KEYS,
  DEFAULT_BRAND_THEME,
  type BrandThemeColors,
} from "@platform/types";
import { safeTheme, themeStyle } from "@/lib/theme";

const CUSTOM: BrandThemeColors = {
  primary: "#123456",
  secondary: "#0F766E",
  accent: "#F59E0B",
  accentInteractive: "#B45309",
};

describe("safeTheme", () => {
  it("passes through a valid theme, normalised to uppercase", () => {
    expect(safeTheme({ ...CUSTOM, primary: "#123456".toLowerCase() })).toEqual(CUSTOM);
  });

  it("falls back to the defaults for a missing theme", () => {
    expect(safeTheme(undefined)).toEqual(DEFAULT_BRAND_THEME);
    expect(safeTheme(null)).toEqual(DEFAULT_BRAND_THEME);
  });

  it.each([
    ["CSS variable", "var(--color-primary)"],
    ["url()", "url(https://evil.example.com/x)"],
    ["declaration break-out", "#123456; background: red"],
    ["rule break-out", "#123456 } body { display:none } .x {"],
    ["javascript scheme", "javascript:alert(1)"],
    ["expression", "expression(alert(1))"],
    ["rgb()", "rgb(1,2,3)"],
    ["colour keyword", "red"],
    ["alpha hex", "#12345678"],
    ["shorthand", "#123"],
    ["empty", ""],
    ["number", 123],
    ["object", { toString: () => "#123456" }],
  ])("replaces an unsafe %s with the default for that colour only", (_label, value) => {
    const result = safeTheme({ ...CUSTOM, primary: value as unknown as string });

    expect(result.primary).toBe(DEFAULT_BRAND_THEME.primary);
    // The other three survive: one bad value degrades one colour.
    expect(result.secondary).toBe(CUSTOM.secondary);
    expect(result.accent).toBe(CUSTOM.accent);
    expect(result.accentInteractive).toBe(CUSTOM.accentInteractive);
  });

  it("always returns the full key set", () => {
    expect(Object.keys(safeTheme({})).sort()).toEqual([...BRAND_THEME_COLOR_KEYS].sort());
  });
});

describe("themeStyle", () => {
  it("emits only the four themeable custom properties plus the focus ring", () => {
    const style = themeStyle(CUSTOM) as Record<string, string>;

    expect(Object.keys(style).sort()).toEqual(
      [
        "--color-accent",
        "--color-accent-interactive",
        "--color-focus-ring",
        "--color-primary",
        "--color-secondary",
      ].sort()
    );
  });

  it("never emits a fixed-palette variable", () => {
    const style = themeStyle(CUSTOM) as Record<string, string>;

    for (const fixed of [
      "--color-background",
      "--color-surface",
      "--color-text",
      "--color-text-muted",
      "--color-border",
      "--color-success",
      "--color-warning",
      "--color-danger",
      "--color-border-strong",
    ]) {
      expect(style).not.toHaveProperty(fixed);
    }
  });

  it("ties the focus ring to the primary colour", () => {
    const style = themeStyle(CUSTOM) as Record<string, string>;
    expect(style["--color-focus-ring"]).toBe(CUSTOM.primary);
  });

  it("produces a plain object, not a CSS string", () => {
    const style = themeStyle(CUSTOM);

    expect(typeof style).toBe("object");
    expect(Array.isArray(style)).toBe(false);
    for (const value of Object.values(style as Record<string, string>)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("cannot be used to inject a second declaration or rule", () => {
    const style = themeStyle({
      ...CUSTOM,
      primary: "#123456; background-image: url(https://evil.example.com/x)",
      accent: "#F59E0B } * { display: none } .x {",
    }) as Record<string, string>;

    // The guarantee is about the VALUES, not the serialised object —
    // JSON.stringify always contains braces of its own. Every emitted
    // value must be a strict six-digit hex, which leaves no syntax in
    // which to close a declaration or open a new rule.
    for (const value of Object.values(style)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(style["--color-primary"]).toBe(DEFAULT_BRAND_THEME.primary);
    expect(style["--color-accent"]).toBe(DEFAULT_BRAND_THEME.accent);
  });
});

describe("applied to the DOM", () => {
  it("sets the custom properties on the element via the CSSOM", () => {
    const { container } = render(<div style={themeStyle(CUSTOM)}>content</div>);
    const element = container.firstElementChild as HTMLElement;

    expect(element.style.getPropertyValue("--color-primary")).toBe("#123456");
    expect(element.style.getPropertyValue("--color-focus-ring")).toBe("#123456");
  });

  it("writes nothing into the element's HTML — no CSS text is injected", () => {
    const { container } = render(
      <div style={themeStyle({ ...CUSTOM, primary: "#123456; background: red" })}>content</div>
    );

    expect(container.innerHTML).not.toContain("background: red");
    expect(container.innerHTML).not.toContain("<style");
  });

  it("falls back to defaults when branding is unavailable", () => {
    const { container } = render(<div style={themeStyle(undefined)}>content</div>);
    const element = container.firstElementChild as HTMLElement;

    expect(element.style.getPropertyValue("--color-primary")).toBe(DEFAULT_BRAND_THEME.primary);
    expect(element.style.getPropertyValue("--color-accent")).toBe(DEFAULT_BRAND_THEME.accent);
  });
});
