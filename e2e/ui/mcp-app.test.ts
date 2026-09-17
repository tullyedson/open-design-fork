import { mcpAppTest as test, expect } from "@/playwright/suite";
import { T } from "@/timeouts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("[P1] standard MCP App host edits, saves, downloads and isolates generated content", async ({
  page,
}, testInfo) => {
  const root = resolve(import.meta.dirname, "../..");
  const data = await mkdtemp(join(tmpdir(), "open-design-app-ui-"));
  const client = new Client({ name: "UI test host", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, ".tmp/mcp-app/server.mjs"), "--data-dir", data],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const initial = await client.callTool(
      { name: "open_design_create", arguments: { title: "Garden studio" } },
      CallToolResultSchema,
    );
    const id = (initial.structuredContent as { id: string }).id;
    const resource = await client.readResource({
      uri: "ui://open-design/studio.html",
    });
    const html = (resource.contents[0] as { text: string }).text;
    const host = await build({
      entryPoints: [join(root, "e2e/lib/playwright/mcp-app-host.ts")],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "McpTestHost",
    });
    await page.route("https://mcp-app.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><head></head><body></body></html>",
      }),
    );
    await page.goto("https://mcp-app.test/");
    await page.clock.install();
    await page.exposeFunction(
      "mcpTestCall",
      (params: CallToolRequest["params"]) =>
        client.callTool(params, CallToolResultSchema),
    );
    await page.addScriptTag({ content: host.outputFiles[0]!.text });
    await page.evaluate(
      async ({ html, initial }) => {
        const host = (
          window as unknown as {
            McpTestHost: {
              mount: (
                html: string,
                initial: unknown,
                theme: string,
              ) => Promise<void>;
            };
          }
        ).McpTestHost;
        await host.mount(html, initial, "light");
      },
      { html, initial },
    );
    const app = page.frameLocator('iframe[title="MCP App"]');
    await expect(app.getByRole("status")).toContainText("Saved", {
      timeout: T.long,
    });
    const preview = app.frameLocator('iframe[title="Open Design preview"]');
    await expect(preview.getByRole("heading")).toHaveText(
      "Your next design starts here.",
    );
    await app.getByRole("button", { name: "Source", exact: true }).click();
    await app
      .getByLabel("Design source")
      .fill(
        '<!doctype html><html><head></head><body><h1 id="hero">Garden plans</h1><script>document.querySelector("h1").dataset.ran="yes";fetch("https://forbidden.invalid/");parent.postMessage({jsonrpc:"2.0",id:789,method:"tools/call",params:{name:"open_design_create",arguments:{title:"Injected"}}},"*")</script></body></html>',
      );
    await app.getByRole("button", { name: "Save", exact: true }).click();
    await expect(app.getByRole("status")).toContainText("Saved");
    const read = await client.callTool({
      name: "open_design_read",
      arguments: { id },
    });
    expect(JSON.stringify(read.structuredContent)).toContain("Garden plans");
    const outgoing: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("forbidden.invalid"))
        outgoing.push(request.url());
    });
    await app.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(preview.getByRole("heading")).toHaveAttribute(
      "data-ran",
      "yes",
    );
    expect(outgoing).toEqual([]);
    const list = await client.callTool({
      name: "open_design_list",
      arguments: {},
    });
    expect(
      (list.structuredContent as { designs: unknown[] }).designs,
    ).toHaveLength(1);
    await app.getByRole("button", { name: "Edit visually" }).click();
    await expect(preview.getByRole("heading")).not.toHaveAttribute(
      "data-ran",
      "yes",
    );
    await preview.getByRole("heading").click();
    await app.getByRole("textbox", { name: "Text", exact: true }).fill("Garden layout");
    await app.getByRole("textbox", { name: "Text", exact: true }).press("Tab");
    await expect(preview.getByRole("heading")).toHaveText("Garden layout");
    await app.getByRole("button", { name: "Save", exact: true }).click();
    await expect(app.getByRole("status")).toContainText("Saved");
    await app.getByRole("button", { name: "Download HTML" }).click();
    await expect
      .poll(() => page.evaluate(() => window.mcpTestEvents.downloads.length))
      .toBe(1);
    expect(
      JSON.stringify(await page.evaluate(() => window.mcpTestEvents.downloads)),
    ).toContain("Garden layout");
    await app.getByRole("button", { name: /^Ask assistant/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.mcpTestEvents.messages.length))
      .toBe(1);
    expect(
      JSON.stringify(await page.evaluate(() => window.mcpTestEvents.messages)),
    ).toContain(id);
    await testInfo.attach("mcp-app-light", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.evaluate(() =>
      window.mcpTestBridge.setHostContext({ theme: "dark" }),
    );
    await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
    await testInfo.attach("mcp-app-dark", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await app.getByRole("button", { name: "Source", exact: true }).click();
    const editor = app.getByLabel("Design source");
    const localDraft = "<h1>Unsent local edits</h1>";
    await editor.fill(localDraft);
    const current = (
      await client.callTool({ name: "open_design_read", arguments: { id } })
    ).structuredContent as {
      revision: string;
      design: Record<string, unknown>;
    };
    await client.callTool({
      name: "open_design_save",
      arguments: {
        id,
        revision: current.revision,
        design: { ...current.design, brief: "A remote edit" },
      },
    });
    await page.clock.runFor(2000);
    await expect(
      app.getByText("Your draft has not been overwritten."),
    ).toBeVisible();
    await expect(editor).toHaveValue(localDraft);
    await expect(
      app.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await app
      .getByRole("button", { name: "Discard draft and load saved" })
      .click();
    await expect(editor).toHaveValue(/Garden layout/);
    await page.evaluate(() => window.mcpTestBridge.teardownResource({}));
  } finally {
    await page.close();
    await client.close();
    await rm(data, { recursive: true, force: true });
  }
});
