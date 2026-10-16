// Files made in the browser for the reader to save: Markdown and plain-text exports. Nothing is stored.

/** Transcript text as literal Markdown: it never turns into headings, lists, quotes, emphasis or links. */
export function markdownEscape(text: string): string {
  return text
    .replace(/[\\`*_[\]<]/g, "\\$&")
    .replace(/^(\s*)([#>+-])(?=\s)/gm, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(?=\s)/gm, "$1\\$2");
}

/** Saves text as a file, then lets go of the in-memory copy. */
export function download(name: string, text: string, type: string) {
  const href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
