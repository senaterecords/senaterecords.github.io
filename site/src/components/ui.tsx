// Small pieces shared by the React islands.
import { useEffect, useState, type ComponentType } from "react";
import { ICONS, type IconName } from "../lib/icons";

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const [viewBox, body] = ICONS[name];
  const [, , w, h] = viewBox.split(" ").map(Number);
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={Math.round((size * h) / w)} viewBox={viewBox}
      aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: body }} />
  );
}

declare global { interface Window { __otrEarlyClicks?: Element[] } }

/** Clicks made inside this island before it started (queued by Base.astro), replayed now that it can answer them. */
export function replayEarlyClicks(root: Element | null) {
  const queue = window.__otrEarlyClicks;
  if (!root || !queue?.length) return;
  const mine = queue.filter((el) => root.contains(el));
  window.__otrEarlyClicks = queue.filter((el) => !root.contains(el));
  for (const el of mine) (el as HTMLElement).click();
}

/** Wraps an island that reads the page (embedded data, the DOM) so the build renders nothing for it. */
export function clientOnly(Component: ComponentType) {
  return function ClientOnly() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    return mounted ? <Component /> : null;
  };
}
