// @vitest-environment jsdom
import { it, expect } from "vitest";
import { emptyDesign } from "@open-design/contracts/mcp-design";
import { standaloneHtml, previewHtml } from "../../src/mcp-app/preview";
it("assembles project assets without network or host paths", () => {
  const design = emptyDesign();
  design.files = [
    {
      path: "index.html",
      content:
        '<link rel="stylesheet" href="style.css"><h1>Garden</h1><script src="app.js"></script>',
    },
    { path: "style.css", content: "h1{color:green}" },
    { path: "app.js", content: 'document.title="Garden"' },
  ];
  const html = standaloneHtml(design);
  expect(html).toContain("h1{color:green}");
  expect(html).toContain('document.title="Garden"');
  expect(html).not.toContain('src="app.js"');
  expect(previewHtml(design, false)).toContain("connect-src 'none'");
  expect(previewHtml(design, true)).not.toContain('document.title="Garden"');
});
it("missing source assets fail explicitly rather than pretending the preview is complete", () => {
  const design = emptyDesign();
  design.files[0]!.content =
    '<html><body><script src="missing.js"></script></body></html>';
  expect(() => standaloneHtml(design)).toThrow(/Missing design asset/);
});
it("removes generated event handlers and obfuscated script URLs from direct-edit mode", () => {
  const design = emptyDesign();
  design.files[0]!.content =
    '<html><head></head><body><a href="&#10;java&#9;script:alert(1)" onclick="alert(2)">Link</a><script>window.owned=true</script></body></html>';
  const html = previewHtml(design, true);
  expect(html).not.toContain("alert(1)");
  expect(html).not.toContain("alert(2)");
  expect(html).not.toContain("window.owned");
  expect(html).toContain("frame-src 'none'");
});
