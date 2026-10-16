// "Copy cite" and similar buttons copy their data-copy text. Loaded only by pages that have such buttons.
document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-copy]");
  if (!button) return;
  const label = button.querySelector("span") ?? button;
  const before = label.textContent;
  try { await navigator.clipboard.writeText(button.dataset.copy!); label.textContent = "Copied"; }
  catch { label.textContent = "Couldn't copy"; }
  setTimeout(() => (label.textContent = before), 1600);
});
