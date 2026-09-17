import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "@open-design/contracts/mcp-design": resolve(
        __dirname,
        "../../packages/contracts/src/mcp-design.ts",
      ),
      "@open-design/contracts/runtime/deck-stage-fallback": resolve(
        __dirname,
        "../../packages/contracts/src/runtime/deck-stage-fallback.ts",
      ),
      "@open-design/contracts/runtime/preview-observability": resolve(
        __dirname,
        "../../packages/contracts/src/runtime/preview-observability.ts",
      ),
    },
  },
  test: { include: ["tests/mcp-app/**/*.test.ts"], environment: "node" },
});
