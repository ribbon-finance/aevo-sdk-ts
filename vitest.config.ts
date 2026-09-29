import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 90,
        "src/auth.ts": {
          lines: 100
        },
        "src/units.ts": {
          lines: 100
        }
      }
    }
  }
});
