// The Export button and its menu, the same on a transcript, search results and a senator's page. Each choice makes its
// file in the browser when picked; nothing is stored.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, replayEarlyClicks } from "./ui";

export interface ExportChoice { label: string; hint?: string; pick: () => void; }

export function ExportButton({ label, choices, className = "", disabled = false, children }: { label: string; choices: ExportChoice[]; className?: string; disabled?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // A click on the button before this script started (slow connections) opens the menu now.
  useEffect(() => replayEarlyClicks(box.current), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className={`xm ${className}`} ref={box}>
      <button type="button" className="btn xm-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {children ?? <><Icon name="dl" size={15} />{label}<Icon name="down" size={13} className="xm-down" /></>}
      </button>
      {open && (
        <div className="xm-menu" role="menu" aria-label={label}>
          {choices.map((c) => (
            <button key={c.label} type="button" role="menuitem" onClick={() => { setOpen(false); c.pick(); }}>
              {c.label}{c.hint && <small>{c.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
