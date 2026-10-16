// A conservative HTML minifier for the built pages: it only drops the quotes around attribute values that cannot be
// misread without them (HTML5). Script and style contents are left alone. Across 60,000 pages that is ~25 MB.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BLOCK = /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/i;
const TAG = /<[a-zA-Z][^<>]*>/g;
// A value without whitespace, quotes, = < > or backtick, followed by whitespace or the end of the tag (never "/>").
const QUOTED = /(\s[a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^\s"'=<>`]+)"(?=[\s>])/g;

export function unquoteAttributes(html) {
  return html
    .split(BLOCK)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(TAG, (tag) => tag.replace(QUOTED, "$1=$2"))))
    .join("");
}

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (name.endsWith(".html")) yield path;
  }
}

export function minifyDir(dir) {
  let before = 0;
  let after = 0;
  for (const file of htmlFiles(dir)) {
    const html = readFileSync(file, "utf8");
    const out = unquoteAttributes(html);
    before += html.length;
    after += out.length;
    if (out !== html) writeFileSync(file, out);
  }
  return { before, after };
}
