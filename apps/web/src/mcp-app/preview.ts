import { buildSrcdoc } from "../runtime/srcdoc";
import type { Design } from "@open-design/contracts/mcp-design";

function localPath(owner: string, reference: string): string | null {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) return null;
  const parts = reference.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const part of (reference.split(/[?#]/)[0] || "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("An asset escapes the design.");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Assemble the exact saved bundle without fetching assets from the host or the network. */
export function standaloneHtml(design: Design): string {
  const files = new Map(design.files.map((file) => [file.path, file.content]));
  const doc = new DOMParser().parseFromString(
    files.get(design.entry) || "",
    "text/html",
  );
  doc
    .querySelectorAll('base,meta[http-equiv="refresh" i]')
    .forEach((node) => node.remove());
  const requireFile = (owner: string, reference: string) => {
    const name = localPath(owner, reference);
    if (!name) return null;
    if (!files.has(name)) throw new Error(`Missing design asset: ${name}`);
    return { name, content: files.get(name)! };
  };
  const css = (text: string, owner: string) =>
    text.replace(
      /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
      (full, _quote, reference) => {
        const file = requireFile(owner, reference);
        if (!file) return full;
        if (!file.name.endsWith(".svg"))
          throw new Error(
            "Inline raster images as data URLs. Only SVG files can be used as CSS image assets.",
          );
        return `url("data:image/svg+xml,${encodeURIComponent(file.content)}")`;
      },
    );
  for (const link of doc.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href]',
  )) {
    const file = requireFile(design.entry, link.getAttribute("href")!);
    if (!file) continue;
    const style = doc.createElement("style");
    style.textContent = css(file.content, file.name);
    link.replaceWith(style);
  }
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const file = requireFile(design.entry, script.getAttribute("src")!);
    if (!file) continue;
    script.removeAttribute("src");
    script.textContent = file.content.replace(/<\/script/gi, "<\\/script");
  }
  for (const img of doc.querySelectorAll<HTMLImageElement>("img[src]")) {
    const file = requireFile(design.entry, img.getAttribute("src")!);
    if (file) {
      if (!file.name.endsWith(".svg"))
        throw new Error("Inline raster images as data URLs.");
      img.src = `data:image/svg+xml,${encodeURIComponent(file.content)}`;
    }
  }
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

export function previewHtml(design: Design, editing: boolean): string {
  let source = standaloneHtml(design);
  // During direct editing only trusted Open Design bridges run; generated
  // application scripts run solely in the separate, network-denied preview.
  if (editing) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    doc.querySelectorAll("script").forEach((node) => node.remove());
    for (const node of doc.querySelectorAll("*"))
      for (const attr of [...node.attributes]) {
        if (
          /^on/i.test(attr.name) ||
          /^(?:javascript|vbscript):/i.test(
            attr.value.replace(/[\x00-\x20]/g, ""),
          )
        )
          node.removeAttribute(attr.name);
      }
    source = "<!doctype html>" + doc.documentElement.outerHTML;
  }
  const html = buildSrcdoc(source, {
    editBridge: editing,
    previewFocusGuard: true,
    deck: design.kind === "slides",
  });
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">`;
  return html.replace(/<head[^>]*>/i, (head) => head + policy);
}
