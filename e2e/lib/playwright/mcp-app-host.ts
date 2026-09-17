import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  CallToolResult,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

declare global {
  interface Window {
    mcpTestCall: (params: CallToolRequest["params"]) => Promise<CallToolResult>;
    mcpTestEvents: {
      downloads: unknown[];
      messages: unknown[];
      context: unknown[];
    };
    mcpTestBridge: AppBridge;
  }
}

/** Official host SDK counterpart to the production App SDK, with no private host code. */
export async function mount(
  html: string,
  initial: CallToolResult,
  theme: "light" | "dark",
) {
  const frame = document.createElement("iframe");
  frame.title = "MCP App";
  frame.style.cssText = "width:100%;height:680px;border:0";
  frame.setAttribute("sandbox", "allow-scripts");
  document.body.style.margin = "0";
  document.body.append(frame);
  window.mcpTestEvents = { downloads: [], messages: [], context: [] };
  const bridge = new AppBridge(
    null,
    { name: "Reference test host", version: "1.0.0" },
    {
      serverTools: {},
      message: { text: {} },
      updateModelContext: { text: {} },
      downloadFile: {},
    },
  );
  window.mcpTestBridge = bridge;
  bridge.setHostContext({ theme, displayMode: "inline" });
  bridge.oncalltool = (params) => window.mcpTestCall(params);
  bridge.ondownloadfile = async (params) => {
    window.mcpTestEvents.downloads.push(params);
    return {};
  };
  bridge.onmessage = async (params) => {
    window.mcpTestEvents.messages.push(params);
    return {};
  };
  bridge.onupdatemodelcontext = async (params) => {
    window.mcpTestEvents.context.push(params);
    return {};
  };
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({
      arguments: { id: (initial.structuredContent as { id: string }).id },
    });
    await bridge.sendToolResult(initial);
  };
  await bridge.connect(
    new PostMessageTransport(frame.contentWindow!, frame.contentWindow!),
  );
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src blob:; connect-src 'none'">`;
  frame.srcdoc = html.replace("<head>", "<head>" + policy);
}
