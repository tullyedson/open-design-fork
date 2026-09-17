/** Build a distributable MCP App resource and stdio server, not a daemon lifecycle entrypoint. */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import type { BuildOptions, BuildResult } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { out: { type: "string" } } });
const output = path.resolve(values.out ?? path.join(root, ".tmp/mcp-app"));
const require = createRequire(
  path.join(root, "packages/contracts/package.json"),
);
const esbuild: typeof import("esbuild") = require("esbuild");
const contract = path.join(root, "packages/contracts/src/mcp-design.ts");
const common: BuildOptions = {
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox120"],
  minify: true,
  jsx: "automatic",
  legalComments: "inline",
  alias: {
    "@open-design/components": path.join(
      root,
      "packages/components/src/index.ts",
    ),
    "@open-design/contracts/mcp-design": contract,
    "@open-design/contracts/runtime/deck-stage-fallback": path.join(
      root,
      "packages/contracts/src/runtime/deck-stage-fallback.ts",
    ),
    "@open-design/contracts/runtime/preview-observability": path.join(
      root,
      "packages/contracts/src/runtime/preview-observability.ts",
    ),
  },
  define: { "process.env.NODE_ENV": '"production"' },
};
await mkdir(output, { recursive: true });
const result: BuildResult = await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "apps/web/src/mcp-app/Studio.tsx")],
  outfile: path.join(output, "studio.js"),
});
const js = result.outputFiles?.find((file) => file.path.endsWith(".js"))?.text;
if (!js) throw new Error("The MCP App bundle was not generated.");
const css =
  result.outputFiles?.find((file) => file.path.endsWith(".css"))?.text ?? "";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Design MCP App</title><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await writeFile(path.join(output, "index.html"), html);
await esbuild.build({
  entryPoints: [path.join(root, "apps/mcp-app-server/src/main.ts")],
  bundle: true,
  outfile: path.join(output, "server.mjs"),
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "inline",
  alias: { "@open-design/contracts/mcp-design": contract },
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
await copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await copyFile(
  path.join(root, "docs/mcp-app.md"),
  path.join(output, "README.md"),
);
const manifest = {
  name: "open-design-mcp-app",
  version: "1.0.0",
  upstreamRelease: "open-design-v0.19.2",
  upstreamCommit: "a539ba57ce3ad4200b0a300007da82783ec66e12",
  files: {} as Record<string, string>,
};
for (const file of ["index.html", "server.mjs", "LICENSE", "README.md"]) {
  manifest.files[file] = createHash("sha256")
    .update(await readFile(path.join(output, file)))
    .digest("hex");
}
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({ output, resourceBytes: Buffer.byteLength(html), manifest }),
);
