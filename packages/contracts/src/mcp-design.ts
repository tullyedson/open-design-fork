/** Portable MCP App contract. No daemon, account, transport or filesystem state. */
export const DESIGN_VERSION = 1;
export const MAX_DESIGN_BYTES = 1_000_000;
export type DesignFile = { path: string; content: string };
export type Design = {
  version: 1;
  kind: "prototype" | "slides";
  brief: string;
  designSystem: string;
  entry: string;
  files: DesignFile[];
};
export type SavedDesign = {
  id: string;
  title: string;
  revision: string;
  savedAt: string;
  design: Design;
};
export function normalizeSavedDesign(value: unknown): SavedDesign {
  const input = value as Partial<SavedDesign>;
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.id !== "string" ||
    !input.id ||
    typeof input.revision !== "string" ||
    !input.revision ||
    typeof input.title !== "string" ||
    typeof input.savedAt !== "string"
  )
    throw new Error("Invalid saved design from MCP server.");
  return {
    id: input.id,
    title: input.title,
    revision: input.revision,
    savedAt: input.savedAt,
    design: normalizeDesign(input.design),
  };
}
export function normalizeDesign(value: unknown): Design {
  const input = value as Partial<Design>;
  if (!input || typeof input !== "object" || input.version !== DESIGN_VERSION)
    throw new Error("Unsupported Open Design document version.");
  if (!["prototype", "slides"].includes(input.kind || ""))
    throw new Error("Choose prototype or slides.");
  if (
    !Array.isArray(input.files) ||
    input.files.length < 1 ||
    input.files.length > 40
  )
    throw new Error("A design needs 1–40 source files.");
  const seen = new Set<string>();
  const files = input.files.map((file) => {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    )
      throw new Error("Each design file needs a path and text content.");
    const name = file.path;
    if (
      name.length > 180 ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /[\x00-\x1f<>:"|?*#%]/.test(name) ||
      name
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            part.startsWith(".") ||
            /[ .]$/.test(part),
        ) ||
      !/\.(html?|css|js|json|svg|txt)$/i.test(name)
    )
      throw new Error(
        "Use ordinary relative HTML, CSS, JS, JSON, SVG or text file names.",
      );
    if (seen.has(name.toLowerCase()))
      throw new Error("Design source file names must be unique.");
    seen.add(name.toLowerCase());
    return { path: name, content: file.content };
  });
  if (
    typeof input.entry !== "string" ||
    !files.some(
      (file) => file.path === input.entry && /\.html?$/i.test(file.path),
    )
  )
    throw new Error("The design entry must name one of its HTML files.");
  if (
    typeof input.brief !== "string" ||
    input.brief.length > 20000 ||
    typeof input.designSystem !== "string" ||
    input.designSystem.length > 20000
  )
    throw new Error(
      "The brief and design system must be text, up to 20,000 characters each.",
    );
  const design: Design = {
    version: 1,
    kind: input.kind as Design["kind"],
    brief: input.brief,
    designSystem: input.designSystem,
    entry: input.entry,
    files,
  };
  if (
    new TextEncoder().encode(JSON.stringify(design)).length > MAX_DESIGN_BYTES
  )
    throw new Error(
      "The design source exceeds the 1 MB limit. Embed only small images or split the design.",
    );
  return design;
}
export function emptyDesign(): Design {
  return {
    version: 1,
    kind: "prototype",
    brief: "",
    designSystem: "",
    entry: "index.html",
    files: [
      {
        path: "index.html",
        content:
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New design</title><style>body{margin:0;background:#fcf9ef;color:#243c32;font:16px system-ui}main{max-width:640px;margin:12vh auto;padding:32px}h1{font-size:40px;letter-spacing:-.04em}p{line-height:1.6}</style></head><body><main><h1>Your next design starts here.</h1><p>Describe a design to your assistant, or edit the source here. Preview, refine and save it without leaving your MCP host.</p></main></body></html>',
      },
    ],
  };
}

/** Request coalescing is intentionally absent: an old read can never replace a new draft. */
export class DesignDraft {
  saved: SavedDesign | null = null;
  design: Design | null = null;
  generation = 0;
  conflict = false;
  get dirty() {
    return (
      !!this.saved &&
      JSON.stringify(this.design) !== JSON.stringify(this.saved.design)
    );
  }
  load(saved: SavedDesign) {
    this.saved = structuredClone(saved);
    this.design = structuredClone(saved.design);
    this.generation++;
    this.conflict = false;
  }
  change(design: Design) {
    this.design = normalizeDesign(design);
    this.generation++;
  }
  observe(saved: SavedDesign, requestedGeneration: number) {
    if (
      this.generation !== requestedGeneration ||
      this.saved?.revision === saved.revision
    )
      return false;
    if (this.dirty) {
      this.conflict = true;
      return false;
    }
    this.load(saved);
    return true;
  }
  acknowledge(saved: SavedDesign, submittedGeneration: number) {
    if (this.generation === submittedGeneration) this.load(saved);
    else {
      this.saved = structuredClone(saved);
      this.conflict = false;
    }
  }
}
