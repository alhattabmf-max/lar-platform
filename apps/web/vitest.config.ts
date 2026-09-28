import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest rather than Jest: React 19 + Next 15 need an ESM-native runner
 * with first-class JSX transform support, which Vitest provides without
 * a bespoke transform chain.
 *
 * Playwright and full E2E browser coverage are deliberately NOT here —
 * those are 8G.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    css: false,

    /**
     * A longer per-test budget than the 5-second default.
     *
     * MOST OF THIS SUITE DRIVES FORMS WITH `userEvent`, which types
     * character by character on real timers. Alone, those cases finish
     * in well under a second. Run as sixty-two files competing for the
     * same cores, a handful of them cross five seconds and fail on the
     * clock rather than on anything they are asserting — and a
     * DIFFERENT handful each run, which is the worst kind of failure:
     * it teaches everyone to re-run rather than to read.
     *
     * The budget is raised here, once, rather than in each file that
     * happened to lose the race. It does not make a genuinely hung test
     * pass; it stops a contended machine from being reported as a
     * defect.
     */
    testTimeout: 30_000,
  },
});
