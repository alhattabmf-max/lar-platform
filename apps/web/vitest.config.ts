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
  },
});
