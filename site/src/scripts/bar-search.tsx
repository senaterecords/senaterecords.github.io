// The header's search box: every page carries the plain form (it searches on Enter without any script), and this one
// shared, cached script swaps in the full box with suggestions. An Astro island would inline Astro's loader into each
// of 65,000 pages. The new box is drawn off-screen first and swapped in whole, so nothing flickers, and anything
// already typed (and the focus) carries over.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import SearchBox from "../components/SearchBox";

const plain = document.querySelector<HTMLFormElement>("form[data-bar-search]");
if (plain) {
  const field = plain.querySelector("input");
  const typed = field?.value ?? "";
  const focused = document.activeElement === field;
  const host = document.createElement("div");
  host.className = "bar-search-host";
  const root = createRoot(host);
  flushSync(() => root.render(<SearchBox variant="bar" initial={typed} />));
  plain.replaceWith(host);
  if (focused) {
    const box = host.querySelector("input");
    box?.focus();
    box?.setSelectionRange(typed.length, typed.length);
  }
}
