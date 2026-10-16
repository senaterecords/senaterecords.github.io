// A small "i" that explains a term in a neat popup, in the site's panel style rather than the browser's plain tooltip.
// It opens on hover, on keyboard focus and on a tap (a tap focuses the button), and closes when the pointer or focus
// leaves.
import { useId, type ReactNode } from "react";
import { Icon } from "./ui";

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="itip">
      <button type="button" className="itip-btn" aria-label={label} aria-describedby={id}><Icon name="info" size={15} /></button>
      <span role="tooltip" id={id} className="itip-pop">{children}</span>
    </span>
  );
}
