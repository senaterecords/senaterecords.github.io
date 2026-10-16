// The mocks' icon set, shared by Astro components (Icon.astro) and React islands (Icon in islands/ui.tsx).
export const ICONS = {
  search: ["0 0 24 24", '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
  copy: ["0 0 24 24", '<rect x="8" y="8" width="11" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
  flag: ["0 0 24 24", '<path d="M6 21V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 4h12l-3 4.5 3 4.5H6z" fill="currentColor"/>'],
  "flag-o": ["0 0 24 24", '<path d="M6 21V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 4h12l-3 4.5 3 4.5H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'],
  down: ["0 0 24 24", '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  check: ["0 0 24 24", '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'],
  sig: ["0 0 24 24", '<path d="M7 6h10M7 10h10M7 14h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M15.5 14.5l3 3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'],
  dl: ["0 0 24 24", '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  chev: ["0 0 24 24", '<path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  chevl: ["0 0 24 24", '<path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  doc: ["0 0 24 24", '<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'],
  ext: ["0 0 24 24", '<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  person: ["0 0 34 42", '<circle cx="17" cy="15" r="8" fill="currentColor"/><path d="M2 42c0-9 6.7-15 15-15s15 6 15 15z" fill="currentColor"/>'],
  menu: ["0 0 24 24", '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
  back: ["0 0 24 24", '<path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'],
  more: ["0 0 24 24", '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>'],
  arrow: ["0 0 24 24", '<path d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'],
  filter: ["0 0 24 24", '<path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
  close: ["0 0 24 24", '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
} as const;

export type IconName = keyof typeof ICONS;
