// Files made in the browser for the reader to save (Word documents, spreadsheets, plain text). Nothing is stored.

/** Saves a file, then lets go of the in-memory copy. Text is saved as UTF-8. */
export function download(name: string, data: string | Uint8Array, type: string) {
  const blob = typeof data === "string" ? new Blob([data], { type: `${type};charset=utf-8` }) : new Blob([data as BlobPart], { type });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
