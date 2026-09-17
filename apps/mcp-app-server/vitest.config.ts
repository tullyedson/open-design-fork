import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@open-design/contracts/mcp-design": resolve(
        import.meta.dirname,
        "../../packages/contracts/src/mcp-design.ts",
      ),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
