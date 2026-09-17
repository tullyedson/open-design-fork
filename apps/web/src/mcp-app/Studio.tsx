import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Button } from "@open-design/components";
import { applyManualEditPatch } from "../edit-mode/source-patches";
import type { ManualEditPatch, ManualEditTarget } from "../edit-mode/types";
import {
  DesignDraft,
  normalizeSavedDesign,
  type Design,
} from "@open-design/contracts/mcp-design";
import { previewHtml, standaloneHtml } from "./preview";
import "./studio.css";

function toolData(result: CallToolResult): unknown {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (result.isError)
    throw new Error(text || "Open Design could not finish that operation.");
  return result.structuredContent ?? JSON.parse(text || "{}");
}

function Studio() {
  const app = useMemo(
    () =>
      new App(
        { name: "Open Design", version: "1.0.0" },
        {},
        { autoResize: false },
      ),
    [],
  );
  const [ready, setReady] = useState(false);
  const draft = useRef(new DesignDraft()).current;
  const frame = useRef<HTMLIFrameElement>(null);
  const [counter, redraw] = useState(0);
  const [mode, setMode] = useState<"preview" | "edit" | "source">("preview");
  const [width, setWidth] = useState("100%");
  const [filePath, setFilePath] = useState("");
  const [status, setStatus] = useState("Opening design…");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<ManualEditTarget | null>(null);
  const [history, setHistory] = useState<
    { revision: string; savedAt: string }[] | null
  >(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const undo = useRef<Design[]>([]),
    redo = useRef<Design[]>([]);
  const callDesign = async (
    name: string,
    args: Record<string, unknown> = {},
  ) => {
    if (!draft.saved) return Promise.reject(new Error("Open a design first."));
    return toolData(
      await app.callServerTool({
        name,
        arguments: { ...args, id: draft.saved.id },
      }),
    );
  };
  const callSaved = async (name: string, args: Record<string, unknown> = {}) =>
    normalizeSavedDesign(await callDesign(name, args));
  const refresh = () => redraw((value) => value + 1);
  const showError = (error: unknown) =>
    setStatus(error instanceof Error ? error.message : String(error));
  const busyRef = useRef(false);
  const design = draft.design;
  const currentPath = design?.files.some((file) => file.path === filePath)
    ? filePath
    : design?.entry;
  const source =
    design?.files.find((file) => file.path === currentPath)?.content || "";
  const change = (next: Design, remember = true) => {
    const previous = draft.design;
    try {
      draft.change(next);
    } catch (error) {
      showError(error);
      return;
    }
    if (remember && previous) {
      undo.current.push(structuredClone(previous));
      undo.current = undo.current.slice(-30);
      redo.current = [];
    }
    setStatus("Unsaved changes");
    refresh();
  };
  const patch = (value: ManualEditPatch) => {
    if (!draft.design) return;
    const entry = draft.design.files.find(
      (file) => file.path === draft.design!.entry,
    )!;
    const result = applyManualEditPatch(entry.content, value);
    if (!result.ok) {
      setStatus(
        result.error ||
          "That element could not be edited. Use Source or ask the assistant.",
      );
      return;
    }
    change({
      ...draft.design,
      files: draft.design.files.map((file) =>
        file.path === entry.path ? { ...file, content: result.source } : file,
      ),
    });
  };
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const publishContext = () => {
    if (
      !ready ||
      !draft.saved ||
      !draft.design ||
      !app.getHostCapabilities()?.updateModelContext
    )
      return;
    return app
      .updateModelContext({
        structuredContent: {
          application: "Open Design · MCP App",
          id: draft.saved.id,
          revision: draft.saved.revision,
          hasUnsavedChanges: draft.dirty,
          view: modeRef.current,
          selectedElement: target
            ? {
                id: target.id,
                tagName: target.tagName,
                text: target.text?.slice(0, 1500),
                styles: target.styles,
              }
            : null,
          brief: draft.design.brief,
          designSystem: draft.design.designSystem,
          entry: draft.design.entry,
        },
      })
      .catch(() => {});
  };
  useEffect(() => {
    void publishContext();
  }, [counter, mode, target, ready]);

  useEffect(() => {
    let alive = true,
      reading = false;
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source === frame.current?.contentWindow) {
        // The generated page is not the MCP app. It cannot issue host requests.
        if (
          modeRef.current !== "edit" ||
          !message ||
          typeof message !== "object"
        )
          return;
        if (
          message.type === "od-edit-select" &&
          message.target &&
          typeof message.target.id === "string"
        )
          setTarget(message.target);
        if (
          message.type === "od-edit-text-commit" &&
          typeof message.id === "string" &&
          typeof message.value === "string" &&
          message.value.length < 20000
        ) {
          patchRef.current({
            kind: "set-text",
            id: message.id,
            value: message.value,
          });
        }
        return;
      }
    };
    app.ontoolresult = (result) => {
      try {
        const saved = normalizeSavedDesign(toolData(result));
        if (draft.saved && draft.saved.id !== saved.id) return;
        if (!draft.saved) draft.load(saved);
        else draft.observe(saved, draft.generation);
        setStatus(
          draft.conflict
            ? "A newer version is saved. Your draft is preserved."
            : "Saved",
        );
        refresh();
      } catch (error) {
        showError(error);
      }
    };
    app.onhostcontextchanged = (context) => {
      if (context.theme) document.documentElement.dataset.theme = context.theme;
    };
    app.onteardown = async () => {
      alive = false;
      clearInterval(poll);
      return {};
    };
    window.addEventListener("message", receive);
    app
      .connect()
      .then(() => {
        if (!alive) return;
        document.documentElement.dataset.theme =
          app.getHostContext()?.theme === "light" ? "light" : "dark";
        setReady(true);
        void app.sendSizeChanged({
          width: document.documentElement.clientWidth,
          height: 650,
        });
      })
      .catch(showError);
    const poll = setInterval(async () => {
      if (!draft.saved || reading || busyRef.current || !alive) return;
      reading = true;
      const generation = draft.generation;
      try {
        const saved = await callSaved("open_design_read");
        if (alive && !busyRef.current && draft.observe(saved, generation)) {
          setStatus("Updated from server");
          refresh();
        } else if (alive && draft.conflict) {
          setStatus(
            "A newer version is saved. Your draft is preserved; save a copy or load the saved version.",
          );
          refresh();
        }
      } catch (error) {
        if (alive) showError(error);
      } finally {
        reading = false;
      }
    }, 2000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draft.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      alive = false;
      clearInterval(poll);
      window.removeEventListener("message", receive);
      window.removeEventListener("beforeunload", beforeUnload);
      void app.close();
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
      refresh();
    }
  };
  const save = () =>
    run(async () => {
      if (!draft.saved || !draft.design) return;
      const generation = draft.generation;
      const saved = await callSaved("open_design_save", {
        revision: draft.saved.revision,
        design: draft.design,
      });
      draft.acknowledge(saved, generation);
      setStatus(draft.dirty ? "Newer edits are still unsaved" : "Saved");
    });
  const askAssistant = () =>
    run(async () => {
      await publishContext();
      const text = target
        ? `In Open Design ${draft.saved?.id}, help refine the selected ${target.tagName} (${target.id}), “${target.text?.slice(0, 500) || target.label}”.`
        : `Help me refine Open Design ${draft.saved?.id}.`;
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text }],
      });
      if (result.isError)
        throw new Error("The host declined the assistant request.");
      setStatus(
        "Continue in the host chat. The host controls how assistant requests are sent.",
      );
    });
  const exportSource = () =>
    run(async () => {
      if (!draft.design) return;
      const content = standaloneHtml(draft.design);
      const filename =
        (draft.saved?.title || "Design")
          .replace(/[^a-z0-9 _-]/gi, "")
          .slice(0, 100) || "Design";
      const result = await app.downloadFile({
        contents: [
          {
            type: "resource",
            resource: {
              uri: `file:///${encodeURIComponent(filename)}.html`,
              mimeType: "text/html",
              text: content,
            },
          },
        ],
      });
      if (result.isError)
        throw new Error("Download was declined or cancelled.");
      setStatus(
        draft.dirty
          ? "Downloaded current unsaved draft"
          : "Downloaded saved design",
      );
    });
  const preview = useMemo(() => {
    try {
      return design ? previewHtml(design, mode === "edit") : "";
    } catch {
      return "";
    }
  }, [design, mode === "edit"]);
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!preview) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(new Blob([preview], { type: "text/html" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  return (
    <main className="mcp-studio">
      <header>
        <strong>Open Design</strong>
        <span className="edition">MCP App</span>
        <span className="spacer" />
        <Button
          onClick={exportSource}
          disabled={
            !design ||
            busy ||
            !ready ||
            !app.getHostCapabilities()?.downloadFile
          }
        >
          Download HTML
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={!draft.dirty || draft.conflict || busy}
        >
          Save
        </Button>
      </header>
      <nav aria-label="Design tools">
        {(["preview", "edit", "source"] as const).map((value) => (
          <Button
            key={value}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setTarget(null);
            }}
          >
            {value === "edit"
              ? "Edit visually"
              : value.charAt(0).toUpperCase() + value.slice(1)}
          </Button>
        ))}
        <select
          aria-label="Preview size"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        >
          <option value="100%">Fit</option>
          <option value="1280px">Desktop</option>
          <option value="768px">Tablet</option>
          <option value="390px">Mobile</option>
        </select>
        <Button
          disabled={!undo.current.length}
          onClick={() => {
            if (!draft.design) return;
            redo.current.push(draft.design);
            change(undo.current.pop()!, false);
          }}
        >
          Undo
        </Button>
        <Button
          disabled={!redo.current.length}
          onClick={() => {
            if (!draft.design) return;
            undo.current.push(draft.design);
            change(redo.current.pop()!, false);
          }}
        >
          Redo
        </Button>
        <Button
          disabled={!design || busy}
          onClick={() =>
            run(async () => {
              const data = (await callDesign("open_design_history")) as {
                versions: { revision: string; savedAt: string }[];
              };
              setHistory(data.versions);
            })
          }
        >
          Versions
        </Button>
        <span className="spacer" />
        <Button
          onClick={askAssistant}
          disabled={
            !design || busy || !ready || !app.getHostCapabilities()?.message
          }
        >
          Ask assistant{target ? " about selection" : ""}
        </Button>
      </nav>
      {draft.conflict && (
        <aside className="conflict">
          <span>Your draft has not been overwritten.</span>
          <Button
            onClick={exportSource}
            disabled={!app.getHostCapabilities()?.downloadFile}
          >
            Download draft
          </Button>
          <Button
            onClick={() =>
              run(async () => {
                draft.load(await callSaved("open_design_read"));
                setStatus("Loaded saved version");
              })
            }
          >
            Discard draft and load saved
          </Button>
        </aside>
      )}
      {history && (
        <section className="versions">
          <h2>Saved versions</h2>
          <Button onClick={() => setHistory(null)}>Close</Button>
          {history.map((version) => (
            <Button
              disabled={draft.dirty || busy}
              key={version.revision}
              onClick={() =>
                run(async () => {
                  const saved = await callSaved("open_design_restore", {
                    revision: draft.saved?.revision,
                    version: version.revision,
                  });
                  draft.load(saved);
                  setStatus("Restored as a new saved version");
                  setHistory(null);
                })
              }
            >
              {version.savedAt} · Restore
            </Button>
          ))}
        </section>
      )}
      <section className="workbench">
        {mode === "source" ? (
          <section className="source-editor">
            <select
              aria-label="Source file"
              value={currentPath}
              onChange={(event) => setFilePath(event.target.value)}
            >
              {design?.files.map((file) => (
                <option key={file.path}>{file.path}</option>
              ))}
            </select>
            <textarea
              aria-label="Design source"
              spellCheck={false}
              value={source}
              onChange={(event) => {
                if (design)
                  change({
                    ...design,
                    files: design.files.map((file) =>
                      file.path === currentPath
                        ? { ...file, content: event.target.value }
                        : file,
                    ),
                  });
              }}
            />
          </section>
        ) : (
          <div className="stage">
            {previewUrl && (
              <iframe
                ref={frame}
                title="Open Design preview"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                style={{ width }}
                src={previewUrl}
                onLoad={() =>
                  frame.current?.contentWindow?.postMessage(
                    {
                      type: "od-edit-mode",
                      enabled: modeRef.current === "edit",
                    },
                    "*",
                  )
                }
              />
            )}
            {!preview && (
              <p>
                {design
                  ? "Cannot assemble this preview. Check the source file references or ask the assistant to correct the bundle."
                  : "Waiting for a design from the MCP host…"}
              </p>
            )}
          </div>
        )}
        {mode === "edit" && (
          <aside className="inspector">
            <h2>{target ? target.tagName : "Select an element"}</h2>
            <p>
              Click text to edit it. Press Enter to commit, Escape to cancel.
              Save when ready.
            </p>
            {target && (
              <>
                <label>
                  Text
                  <textarea
                    key={target.id + target.text}
                    defaultValue={target.text}
                    onBlur={(event) => {
                      if (event.target.value !== target.text)
                        patch({
                          kind: "set-text",
                          id: target.id,
                          value: event.target.value,
                        });
                    }}
                  />
                </label>
                {(
                  [
                    "color",
                    "backgroundColor",
                    "fontSize",
                    "padding",
                    "borderRadius",
                  ] as const
                ).map((name) => (
                  <label key={target.id + name}>
                    {name}
                    <input
                      defaultValue={target.styles?.[name] || ""}
                      onBlur={(event) =>
                        patch({
                          kind: "set-style",
                          id: target.id,
                          styles: { [name]: event.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                <Button
                  onClick={() => {
                    patch({ kind: "remove-element", id: target.id });
                    setTarget(null);
                  }}
                >
                  Remove element
                </Button>
              </>
            )}
          </aside>
        )}
      </section>
      <footer role="status">
        <span>{status}</span>
        <span>
          {design?.files.length || 0} source files ·{" "}
          {draft.dirty ? "Draft" : "Saved document"}
        </span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Studio />);
