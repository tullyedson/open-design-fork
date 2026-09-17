import { mkdir, readFile } from "node:fs/promises";
import { resolve, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DesignStore } from "./store";
import { createServer } from "./server";

async function main() {
  const { values } = parseArgs({
    options: {
      "data-dir": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.error(
      "Open Design MCP App (stdio)\nUsage: node server.mjs --data-dir <absolute-directory>",
    );
    return;
  }
  if (!values["data-dir"] || !isAbsolute(values["data-dir"]))
    throw new Error(
      "Pass --data-dir with an absolute private storage directory. No application defaults or credentials are read.",
    );
  const root = resolve(values["data-dir"]);
  const appHtml = await readFile(
    resolve(dirname(fileURLToPath(import.meta.url)), "index.html"),
    "utf8",
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const store = new DesignStore(resolve(root, "designs.sqlite"));
  const server = createServer(store, appHtml);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      store.close();
    }
  };
  server.server.onclose = close;
  const shutdown = async () => {
    await server.close();
    close();
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
