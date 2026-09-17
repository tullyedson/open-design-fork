import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { normalizeSavedDesign } from "@open-design/contracts/mcp-design";
import { DesignStore } from "../src/store";
import { createServer, APP_URI } from "../src/server";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function connected() {
  const store = new DesignStore(":memory:");
  const html = "<!doctype html><title>Open Design MCP App</title>";
  const server = createServer(store, html);
  const client = new Client({ name: "standards-test-host", version: "1.0.0" });
  const [host, service] = InMemoryTransport.createLinkedPair();
  cleanup.push(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  await server.connect(service);
  await client.connect(host);
  return { client, store, html };
}

it("discovers a standard MCP App resource from the tool and negotiates real MCP calls", async () => {
  const { client, html } = await connected();
  const tools = (await client.listTools()).tools;
  for (const name of ["open_design_create", "open_design_open"]) {
    expect(tools.find((tool) => tool.name === name)?._meta?.ui).toMatchObject({
      resourceUri: APP_URI,
    });
  }
  const resources = (await client.listResources()).resources;
  expect(resources.find((resource) => resource.uri === APP_URI)?.mimeType).toBe(
    RESOURCE_MIME_TYPE,
  );
  const content = (await client.readResource({ uri: APP_URI })).contents[0];
  expect(content).toMatchObject({
    uri: APP_URI,
    mimeType: "text/html;profile=mcp-app",
    text: html,
  });
  expect(content?._meta?.ui).toMatchObject({
    csp: { connectDomains: [], resourceDomains: [], frameDomains: ["blob:"] },
  });
});

it("creates, opens, edits and restores through SDK tool calls, never overwriting a stale revision", async () => {
  const { client } = await connected();
  const created = normalizeSavedDesign(
    (
      await client.callTool({
        name: "open_design_create",
        arguments: { title: "A real design" },
      })
    ).structuredContent,
  );
  const opened = await client.callTool({
    name: "open_design_open",
    arguments: { id: created.id },
  });
  expect(normalizeSavedDesign(opened.structuredContent)).toEqual(created);
  const design = { ...created.design, brief: "Make the heading red" };
  const saved = normalizeSavedDesign(
    (
      await client.callTool({
        name: "open_design_save",
        arguments: { id: created.id, revision: created.revision, design },
      })
    ).structuredContent,
  );
  expect(saved.design.brief).toBe(design.brief);
  const stale = await client.callTool({
    name: "open_design_save",
    arguments: {
      id: created.id,
      revision: created.revision,
      design: created.design,
    },
  });
  expect(stale.isError).toBe(true);
  expect(JSON.stringify(stale.content)).toContain("Revision conflict");
  const read = await client.callTool({
    name: "open_design_read",
    arguments: { id: created.id },
  });
  expect(normalizeSavedDesign(read.structuredContent)).toEqual(saved);
  const restored = normalizeSavedDesign(
    (
      await client.callTool({
        name: "open_design_restore",
        arguments: {
          id: created.id,
          revision: saved.revision,
          version: created.revision,
        },
      })
    ).structuredContent,
  );
  expect(restored.design).toEqual(created.design);
  expect(
    (await client.callTool({ name: "open_design_list", arguments: {} }))
      .structuredContent,
  ).toMatchObject({ designs: [{ id: created.id }] });
});

it("rejects malformed IDs, missing designs, escaping source paths and oversize bundles", async () => {
  const { client, store } = await connected();
  const invalidId = await client.callTool({
    name: "open_design_read",
    arguments: { id: "../../private-file" },
  });
  expect(invalidId.isError).toBe(true);
  const missing = await client.callTool({
    name: "open_design_open",
    arguments: { id: "12345678-1234-4234-8234-123456789abc" },
  });
  expect(missing.isError).toBe(true);
  const created = store.create("Fixture");
  const invalid = {
    ...created.design,
    entry: "../escape.html",
    files: [{ path: "../escape.html", content: "bad" }],
  };
  expect(
    (
      await client.callTool({
        name: "open_design_save",
        arguments: {
          id: created.id,
          revision: created.revision,
          design: invalid,
        },
      })
    ).isError,
  ).toBe(true);
  const huge = {
    ...created.design,
    files: [{ path: "index.html", content: "🌱".repeat(260000) }],
  };
  expect(
    (
      await client.callTool({
        name: "open_design_save",
        arguments: { id: created.id, revision: created.revision, design: huge },
      })
    ).isError,
  ).toBe(true);
  expect(store.read(created.id)).toEqual(created);
  expect(store.history(created.id)).toHaveLength(1);
});
