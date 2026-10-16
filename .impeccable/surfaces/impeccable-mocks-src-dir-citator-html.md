---
version: 1
slug: "impeccable-mocks-src-dir-citator-html"
primary_target: ".impeccable/mocks/src/dir-citator.html"
related_targets: []
---

# Surface brief: transcript search, results and reader

Scope: the three core screens of On the Record (homepage search, search results, transcript reader). Visitor mode: Operate, with Read for the transcript reader. Mockups only for now; the site will be built in Astro + React + Tailwind.

Audience and job: Senate and legislative staff plus researchers. They do fast lookups and long reading sessions in equal measure: find who said what, cite it, follow a senator, follow a bill's debate.

Refuse: startup or marketing gloss, a dated government portal, anything casual or playful, and terminal-style density.

User feedback (2026-10-15): the user likes this direction as first mocked (dir-citator.html). A refinement pass that added per-speaker color avatars with initials, colored speaker names, a dark masthead and boxed panels was rejected as amateur and reverted. Any refinement must be subtle and stay within the original restrained look.

## Direction contract

THESIS: Every remark is a citable authority: star-paged, flagged, and one click from a perfect cite. It refuses the category default of a search-engine homepage leading to a transcript dumped as one block of text.

OWN-WORLD: The legal-research citator, rebuilt for the Senate record:
- Colors: a stone ground (#F3F4F1), white reading panes, ink text (#161B22), and highlighter yellow (#FFE36E) on search hits. Ledger green (#0B6B50) appears only on things you can act on. Status uses pennant flags: red for vetoed, amber for corrected or amended, hollow ink for passed.
- Type: Archivo for interface text, with tabular figures. Charis SIL for every spoken word.
- Structure: fixed, ruled columns.
- Speakers: named in strong type; procedural voices (Secretary, presiding officer) can be quieter.

STORY: A staffer types a phrase and sees who said it, when, on which page and on which bill. They copy a ready-made cite, then jump into the debate and the bill's current standing.

FIRST VIEWPORT (results):
- Top: a white bar with the wordmark, the search field and navigation.
- Left: a 228px facet rail on the stone ground.
- Center: results in fixed columns: date, then speaker and quote, then page, status and cite.
- Right: a 300px headnote panel for the bill.
- The primary action, Copy cite, sits on the focused remark.

FORM: The legal-research citator interface language. Grounded candidate 5 of 7 on the ordered list. Seed key: ed1d95b9.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
