import {
  DEFAULT_BRAND_THEME,
  FIXED_BRAND_COLORS,
  HEX_COLOR_PATTERN,
  type BrandThemeColors,
} from "@platform/types";
import {
  contrastRatio,
  formatIssues,
  parseThemeColors,
  themeFromStoredValue,
  validateThemeContrast,
  validateThemeInput,
} from "./brand-theme.validation";

const VALID: BrandThemeColors = { ...DEFAULT_BRAND_THEME };

describe("contrastRatio", () => {
  it("matches known WCAG reference values", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0B1F33", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#0B1F33"),
      10
    );
  });

  it("reproduces the measured palette ratios", () => {
    expect(contrastRatio("#0B1F33", "#FFFFFF")).toBeCloseTo(16.69, 1);
    expect(contrastRatio("#0F766E", "#FFFFFF")).toBeCloseTo(5.47, 1);
    expect(contrastRatio("#F59E0B", "#0F172A")).toBeCloseTo(8.31, 1);
    expect(contrastRatio("#B45309", "#FFFFFF")).toBeCloseTo(5.02, 1);
  });
});

describe("hex format", () => {
  it("accepts a full six-digit hex in either case", () => {
    expect(parseThemeColors({ ...VALID, primary: "#0b1f33" })).toMatchObject({
      primary: "#0B1F33",
    });
  });

  it("normalises to uppercase", () => {
    const parsed = parseThemeColors({
      primary: "#0b1f33",
      secondary: "#0f766e",
      accent: "#f59e0b",
      accentInteractive: "#b45309",
    });

    expect(parsed).toEqual(DEFAULT_BRAND_THEME);
  });

  it.each([
    ["shorthand hex", "#FFF"],
    ["eight-digit alpha hex", "#0B1F33FF"],
    ["missing hash", "0B1F33"],
    ["rgb()", "rgb(11, 31, 51)"],
    ["rgba()", "rgba(11, 31, 51, 0.5)"],
    ["hsl()", "hsl(210, 65%, 12%)"],
    ["colour keyword", "navy"],
    ["CSS variable", "var(--color-primary)"],
    ["url()", "url(https://evil.example.com/x.png)"],
    ["javascript scheme", "javascript:alert(1)"],
    ["expression", "expression(alert(1))"],
    ["style injection", "#0B1F33; background: url(x)"],
    ["closing brace injection", "#0B1F33 } body { display:none"],
    ["empty string", ""],
    ["whitespace padded", " #0B1F33 "],
  ])("rejects %s", (_label, value) => {
    expect(HEX_COLOR_PATTERN.test(value)).toBe(false);
    expect(parseThemeColors({ ...VALID, primary: value })).toBeNull();
  });

  it.each([
    ["null", null],
    ["array", ["#0B1F33"]],
    ["string", "#0B1F33"],
    ["number", 42],
    ["empty object", {}],
  ])("rejects a non-theme payload: %s", (_label, value) => {
    expect(parseThemeColors(value)).toBeNull();
  });

  it("rejects a missing key rather than defaulting it", () => {
    const { accent: _accent, ...withoutAccent } = VALID;
    expect(parseThemeColors(withoutAccent)).toBeNull();
  });

  it("rejects an unknown extra key instead of silently dropping it", () => {
    expect(parseThemeColors({ ...VALID, background: "#000000" })).toBeNull();
  });

  it("reports a format issue per offending colour", () => {
    const issues = formatIssues({ ...VALID, primary: "red", accent: "var(--x)" });

    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.key).sort()).toEqual(["accent", "primary"]);
    expect(issues.every((i) => i.rule === "FORMAT" && i.code === "INVALID_HEX_COLOR")).toBe(true);
  });
});

describe("contrast validation", () => {
  it("passes for every default pair", () => {
    const result = validateThemeContrast(DEFAULT_BRAND_THEME);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a primary too light for white text", () => {
    const result = validateThemeContrast({ ...VALID, primary: "#FFF9C4" });

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "PRIMARY_ON_WHITE_TEXT");
    expect(issue).toMatchObject({ key: "primary", rule: "CONTRAST", required: 4.5 });
    expect(issue!.ratio).toBeLessThan(4.5);
  });

  it("rejects a secondary too light for white text", () => {
    const result = validateThemeContrast({ ...VALID, secondary: "#A7F3D0" });

    expect(result.issues.some((i) => i.code === "SECONDARY_ON_WHITE_TEXT")).toBe(true);
  });

  it("rejects an accent unreadable against the fixed primary text", () => {
    const result = validateThemeContrast({ ...VALID, accent: "#1E293B" });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "ACCENT_ON_PRIMARY_TEXT")).toBe(true);
  });

  it("rejects an accent-interactive too light for white text", () => {
    const result = validateThemeContrast({ ...VALID, accentInteractive: "#FDE68A" });

    expect(result.issues.some((i) => i.code === "ACCENT_INTERACTIVE_ON_WHITE_TEXT")).toBe(true);
  });

  it("rejects a focus indicator with insufficient contrast on background AND surface", () => {
    // The focus ring is the primary colour; a near-white primary fails
    // both surfaces at the 3:1 non-text threshold.
    const result = validateThemeContrast({ ...VALID, primary: "#FAFAFA" });

    expect(result.issues.some((i) => i.code === "FOCUS_ON_BACKGROUND")).toBe(true);
    expect(result.issues.some((i) => i.code === "FOCUS_ON_SURFACE")).toBe(true);
    expect(result.issues.filter((i) => i.key === "focus").every((i) => i.required === 3)).toBe(true);
  });

  it("checks contrast against the FIXED palette, which admins cannot change", () => {
    expect(FIXED_BRAND_COLORS.text).toBe("#0F172A");
    expect(FIXED_BRAND_COLORS.background).toBe("#F8FAFC");
    expect(FIXED_BRAND_COLORS.surface).toBe("#FFFFFF");
  });

  it("reports the measured ratio rounded to two decimals", () => {
    const issue = validateThemeContrast({ ...VALID, secondary: "#A7F3D0" }).issues.find(
      (i) => i.code === "SECONDARY_ON_WHITE_TEXT"
    )!;

    expect(issue.ratio).toBe(Math.round(issue.ratio! * 100) / 100);
  });
});

describe("validateThemeInput", () => {
  it("reports format issues without attempting contrast", () => {
    const result = validateThemeInput({ ...VALID, primary: "not-a-colour" });

    expect(result.valid).toBe(false);
    expect(result.issues.every((i) => i.rule === "FORMAT")).toBe(true);
  });

  it("reports contrast issues once the format is sound", () => {
    const result = validateThemeInput({ ...VALID, accent: "#1E293B" });

    expect(result.issues.every((i) => i.rule === "CONTRAST")).toBe(true);
  });

  it("accepts the defaults", () => {
    expect(validateThemeInput(DEFAULT_BRAND_THEME).valid).toBe(true);
  });
});

describe("themeFromStoredValue", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["corrupt JSON shape", { primary: "oops" }],
    ["an array", []],
    ["a string", "#0B1F33"],
    ["partial", { primary: "#0B1F33" }],
  ])("falls back to the defaults for %s", (_label, value) => {
    expect(themeFromStoredValue(value)).toEqual(DEFAULT_BRAND_THEME);
  });

  it("returns a stored theme that no longer meets contrast, since format decides usability", () => {
    const lowContrast = { ...VALID, accent: "#1E293B" };

    expect(themeFromStoredValue(lowContrast)).toEqual(lowContrast);
    expect(validateThemeContrast(lowContrast).valid).toBe(false);
  });

  it("returns a copy, so a caller cannot mutate the shared default", () => {
    const first = themeFromStoredValue(null);
    first.primary = "#000000";

    expect(themeFromStoredValue(null).primary).toBe("#0B1F33");
    expect(DEFAULT_BRAND_THEME.primary).toBe("#0B1F33");
  });
});
