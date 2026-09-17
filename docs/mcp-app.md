# Open Design MCP App

A host-neutral MCP App edition of Open Design. The host's assistant creates and
refines designs through MCP tools. People use the same source in an embedded
preview, visual editor or source editor. No second model, cloud account, desktop
application, private host API, chat service or account system is required.

This fork starts at upstream `nexu-io/open-design` release `open-design-v0.19.2`
(`a539ba57ce3ad4200b0a300007da82783ec66e12`). It retains upstream's Apache-2.0
license and code history. The upstream standalone app and `od` CLI are unchanged.

## Build and connect

Use Node.js 24 and pnpm 10.33.2, as specified by the repository.

```sh
git clone https://github.com/tullyedson/open-design-fork.git
cd open-design-fork
pnpm install --ignore-scripts --frozen-lockfile --filter '@open-design/web...' --filter '@open-design/mcp-app-server...'
pnpm --filter @open-design/web build:mcp-app
```

The portable output is `.tmp/mcp-app/`: `server.mjs`, `index.html`, license,
instructions and a SHA-256 manifest. Keep these files together. The bundle needs
Node 24 but does not need node_modules or the upstream daemon at runtime.

Configure any MCP Apps-capable host with a stdio server. Replace both absolute
paths below with your own paths (Windows JSON paths need doubled backslashes).
Use the absolute path to Node if your host cannot find `node`.

```json
{
  "mcpServers": {
    "open-design": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-app/server.mjs",
        "--data-dir",
        "/absolute/path/to/private-design-data"
      ]
    }
  }
}
```

Ask the assistant to create a design with `open_design_create`, providing a title
and source bundle; `open_design_open` reopens an existing design ID. A client
without MCP Apps support can still use the tools, but cannot show the editor.
An MCP server does not itself add MCP Apps support to a host.

This small stdio entrypoint is separate from the standalone daemon's lifecycle
and storage. It never reads the daemon's configuration or managed data directory.
The `--data-dir` path is mandatory, private to this server and explicitly selected
by its operator. Designs and up to 100 revisions per design are in `designs.sqlite`.
Point multiple clients at the same directory to share designs; use separate
directories for separate trust boundaries. All connected clients can access all
designs in their server's database. No multi-user authorization is implied.

## Standards and tools

The implementation uses the official `@modelcontextprotocol/ext-apps` 1.7.5 SDK
with the existing upstream MCP SDK 1.29.0. The SDK negotiates the MCP Apps protocol,
performs initialization, dispatches tool results, handles theme changes, sends
size notifications, and acknowledges teardown. There is no private RPC dialect.

- `open_design_create`, `open_design_open`: standard MCP tools declaring
  `_meta.ui.resourceUri` = `ui://open-design/studio.html`.
- `resources/read`: serves that resource as `text/html;profile=mcp-app` with
  standard UI CSP metadata. Only blob frames are requested for isolated previews.
- `open_design_list`, `open_design_read`, `open_design_save`,
  `open_design_history`, `open_design_restore`: source and revision operations
  available to both the app and the host assistant.
- `ui/update-model-context`: current design ID, revision, draft state and selection.
- `ui/message`: an explicit **Ask assistant** action. The host decides whether
  that sends a follow-up immediately or requests confirmation; it is not assumed
  to merely populate a chat draft.
- `ui/download-file`: standalone HTML as a standard embedded resource. The host
  controls approval/downloads. Unsupported optional controls are disabled.

Protocol reference: [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)
and [official SDK](https://github.com/modelcontextprotocol/ext-apps).

## Editing and safety

The app reuses upstream Open Design's preview builder, direct-edit bridge, source
patcher, slide bridge, focus guard and shared Button component. It does not bundle
upstream chat, provider configuration, cloud billing, telemetry, plugins or the
desktop shell. The MCP App uses only the host's tool connection, not host cookies.

Preview, visual text/style editing, source editing, responsive viewport sizes,
undo/redo, explicit Save, version restore and HTML download share one design.
Save before closing: this edition does not silently autosave or run a model.
Clean drafts refresh every two seconds; dirty drafts are preserved with a conflict
notice. Saves and restores require the current revision and run in a SQLite
transaction, including across multiple server processes.

Generated HTML runs in a nested opaque-origin sandbox. It cannot issue MCP calls,
read the editor's state, submit forms, create child frames or fetch the network.
Generated scripts are removed in visual-edit mode before the trusted edit bridge
is installed. Exported HTML is authored code and can run scripts outside the
sandbox: inspect it before opening or distributing it.

Bundles accept 1–40 relative HTML, CSS, JS, JSON, SVG or text files, up to 1 MB
total source. The entry must be an included HTML file. Use self-contained designs:
inline raster images as data URLs; local stylesheet/script/SVG references are
assembled into the preview. External CDNs, package imports and build pipelines
are not supported by this lightweight App edition. The original full app remains
available for workflows requiring those capabilities.

## Validation

```sh
pnpm --filter @open-design/contracts test tests/mcp-design.test.ts
pnpm --filter @open-design/web test:mcp-app
pnpm --filter @open-design/web typecheck:mcp-app
pnpm --filter @open-design/mcp-app-server test
pnpm --filter @open-design/mcp-app-server typecheck
pnpm --filter @open-design/web build:mcp-app
```

Server tests use the actual MCP SDK client and in-memory transport, validating tool
discovery, resource metadata, source round-trips, errors and stale-write rejection.
Store tests cover persistence/reopen, cross-connection conflicts and version isolation.
Draft/preview tests cover in-flight edits, invalid paths, asset assembly and CSP.

The browser witness uses the official `AppBridge` SDK and the built stdio server,
not a private host implementation. It exercises visual/source editing, persisted
saves, downloads, assistant messages, theme changes, dirty-draft conflicts,
teardown and rejection of network/MCP calls from generated content:

```sh
pnpm install --ignore-scripts --frozen-lockfile --filter '@open-design/e2e...'
pnpm --filter @open-design/e2e exec playwright install chromium
pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts ui/mcp-app.test.ts --workers=1
```

Publication validation (2026-09-17): 13 focused tests, the browser witness and the
full workspace typecheck passed. The upstream `pnpm guard` has a Windows CRLF
comparison issue in `check-packaged-leaf-boundary.ts`: its literal CI block matches
after line-ending normalization, but not the unmodified CRLF checkout. The guard
and CI workflow are unchanged from the upstream release; the other guard checks
passed. This is not a claim of certification or testing in every third-party host.
