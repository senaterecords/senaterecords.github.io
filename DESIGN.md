---
name: On the Record
description: New York State Senate transcripts, searchable and citable to the page. The Citator look, as shipped.
colors:
  ground: "#F3F4F1"
  pane: "#FFFFFF"
  ink: "#161B22"
  ink2: "#4B535E"
  ink3: "#666D77"
  rule: "#D7DBDF"
  rule2: "#E9EBED"
  act: "#0B6B50"
  act-deep: "#08523D"
  act-wash: "#E2F0EA"
  hit: "#FFE36E"
  red: "#B42318"
  amber: "#9A6200"
typography:
  display:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  headline-serif:
    fontFamily: "Charis SIL, Georgia, serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  figures:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 650
    fontFeature: "tnum"
  wordmark:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  speaker-label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  reading:
    fontFamily: "Charis SIL, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.62
  excerpt:
    fontFamily: "Charis SIL, Georgia, serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  hairline: "2px"
  photo: "3px"
  chip: "4px"
  row: "5px"
  control: "6px"
  panel: "8px"
  sheet: "16px"
spacing:
  phone-gutter: "16px"
  reader-phone-gutter: "18px"
  row-inset: "22px"
  wrap-inset: "24px"
  page-inset: "32px"
  reader-right: "48px"
  reader-gutter: "96px"
components:
  button-primary:
    backgroundColor: "{colors.act}"
    textColor: "{colors.pane}"
    typography: "{typography.figures}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.act-deep}"
  button-outline:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.act}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "#F6FAF8"
  button-quiet:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink2}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-quiet-hover:
    backgroundColor: "#F8F9F9"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
  segmented-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pane}"
    padding: "6px 12px"
  segmented-off:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink2}"
    padding: "6px 12px"
  search-field:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "0 16px"
    height: "52px"
  bar-search:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 8px 0 12px"
    height: "38px"
  status-ink:
    textColor: "{colors.ink2}"
  status-red:
    textColor: "{colors.red}"
  status-amber:
    textColor: "{colors.amber}"
  speaker-label:
    textColor: "{colors.ink2}"
    typography: "{typography.speaker-label}"
  speaker-label-senator:
    textColor: "{colors.ink}"
    typography: "{typography.speaker-label}"
  popover:
    backgroundColor: "{colors.pane}"
    rounded: "{rounded.panel}"
    padding: "14px 16px"
  bottom-sheet:
    backgroundColor: "{colors.pane}"
    rounded: "{rounded.sheet}"
    padding: "10px 18px 26px"
---

# Design System: On the Record

## Overview

**Creative North Star: "The Citator"**

A legal research tool for a public record. Stone ground, white panes, ink text, hairline rules, and one green that means "you can act on this". The interface speaks in Archivo; every word spoken on the Senate floor is set in Charis SIL, so the reader can always tell the tool from the record. Dense, quiet, and exact: dates, pages and counts are tabular figures, and the transcript page number is always visible because citing the page is the point.

The system is flat and ruled rather than boxed. Lists are ruled rows on white panes, not cards. Depth appears only on things that float over the page (popovers, the speaker card, bottom sheets). There is no motion anywhere in the shipped CSS: no transitions, no animations.

**Key Characteristics:**
- Stone ground (`ground`) with white working panes (`pane`) separated by 1px rules.
- Ledger green (`act`) only on actionable things; status uses pennant flags, not colour blocks.
- Two voices: Archivo Variable for the interface, Charis SIL for the record.
- Tabular figures for every date, page, calendar number and count.
- Flat, ruled, motionless; refinements stay subtle.

## Colors

A near-monochrome ink-on-stone palette with one action green and two state colours used as small marks.

### Primary
- **Ledger Green** (`act`): links, buttons, bill-number links, checked filter boxes, the active suggestion bar, the focus outline. Hover deepens to **Ledger Deep** (`act-deep`). **Ledger Wash** (`act-wash`) is the focus halo around fields, the text-selection colour, and the "Show only" notice ground.

### Secondary
- **Pennant Red** (`red`): a vetoed bill's solid flag and its text; also the citation-copy failure message. Nothing else.
- **Pennant Amber** (`amber`): an amended or corrected bill's solid flag and its text. Nothing else.
- **Highlighter** (`hit`): `mark` elements on search hits only, with 1px side padding and a 2px corner.

### Neutral
- **Stone** (`ground`): page ground, side columns, the bill page's side column.
- **Pane** (`pane`): bar, page header band, main columns, reader text column, popovers, sheets, buttons, fields.
- **Ink** (`ink`): primary text, the active segmented option fill, active tab and nav underline, section-heading rules (1.5px), completed timeline steps.
- **Ink 2** (`ink2`): secondary text, nav links, procedural speaker labels, quiet buttons.
- **Ink 3** (`ink3`): meta text, counts, gutter page numbers, placeholders.
- **Rule** (`rule`): column borders, row rules, control borders. **Rule 2** (`rule2`): lighter inner rules between rows in panes.

Recurring literals that are in the CSS but have no custom property: reading ink `#1D232B` (all Charis body text: turns, quotes, about prose), side-rail and note wash `#FBFBFA` (reader right rail, notes, bill headers, phone bill bar), row highlight `#F4F7F5` (active suggestion, menu hover, current sheet row), outline-button border `#B9CFC6`, field border `#B9BFC6` (bar search, filter, select), big search field border `#8F97A1`, senator-label underline `#B4BAC1`, link underline `#A9B0B8`, photo ground `#ECEEEF`, silhouette `#C6CBD0`. The missing-remark notice uses `#FBF6EA` on `#E8D9B5` (one-off).

### Named Rules
**The Ledger Rule.** Green marks what can be clicked, pressed or followed. The single exception, carried from the approved mock, is the 7px "Updated" freshness dot in the bar and footer.

**The Pennant Rule.** Bill state is a flag icon plus text, never a filled badge: hollow ink flag (`ink2` text) for ordinary progress, solid red flag for vetoed, solid amber flag for amended or corrected.

**The One Ink Rule.** Speakers have no colour identity. Every speaker label is ink or ink 2; senators are distinguished by an underline, not a hue.

## Typography

**Interface Font:** Archivo Variable (width axis loaded; fallback system-ui, sans-serif)
**Record Font:** Charis SIL 400, 400 italic, 700 (fallback Georgia, serif)

**Character:** A slightly wide, sturdy grotesque for the tool against a sober book serif for the record. Archivo runs at intermediate variable weights (450, 550, 600, 650, 700, 750, 800).

### Hierarchy
- **Display** (700, 36px, 1.1, -0.02em): homepage heading only; 29px on phones.
- **Headline** (750, 30px, 1.15, -0.015em): senator, bills and browse page titles; 23px on phones. Page-level `page-h1` is 28px (24px on phones).
- **Headline serif** (Charis 700, 28px, 1.25): a bill's title on its page, because it is the bill's own words; 22px on phones.
- **Title** (700, 15px): section heads (`sec-h2` with a 1.5px ink rule beneath, pane section heads); rail and side headings at 700 13px.
- **Body** (400, 14px, 1.45): interface default. Controls 13 to 13.5px; nav and tabs 550 to 600 14px.
- **Meta** (12.5px, `ink3`): dates under rows, counts, the bar's "Updated", footer.
- **Reading** (Charis 400, 17px, 1.62, `#1D232B`, 68ch measure): transcript turns. About prose is 17px/1.6 at 64ch; homepage lede 18px.
- **Excerpt** (Charis 15.5px, 1.5): remark quotes in search results and on senator pages; bill-page debate excerpts 15.5px/1.55. Bill titles in lists are Charis 14.5 to 15px, 1.35.
- **Speaker label** (Archivo 700, 12.5px, line-height 1, 0.06em, uppercase): inline at the start of a turn.
- **Small labels** (700, 11.5px, 0.06em, uppercase, `ink3`): group headings inside the suggestions list only. `kbd` keys are 650 11.5px.

### Named Rules
**The Two Voices Rule.** Anything said on the floor or in a hearing, and any bill title, is Charis SIL. Everything the tool says is Archivo.

**The Tabular Rule.** Dates, page numbers, calendar numbers, vote tallies and counts use tabular figures (`font-variant-numeric: tabular-nums`, the `num` utility).

## Layout

**Bar:** 58px desktop, 52px phone; white with a 1px bottom rule; 24px side padding (16px left, 10px right on phones). Under 720px the section links fold into a details menu and the bar search becomes an icon. On reader pages the bar is sticky and shows a crumb and actions; on phones a back button and two-line title replace the wordmark.

**Widths:** content pages built on the header band and two-column grid use a 1280px max width with 32px side padding (`pg-in`, `two`, bills table, browse months, senators index, search). Simple pages in the default wrap (home, about, 404, the bills and browse indexes) use 1088px with 24px padding. Index lists cap at 640px. Phones use 16px gutters everywhere except the reader text, which uses 18px.

**Two-column pages:** a white main pane bordered left and right, plus a 340px stone side column (20px 24px padding). Rows inside panes inset 22px. Below 720px the side column stacks under the main.

**Reader:** three columns, calendar rail 236px / fluid white text column / headnote rail 288px (`#FBFBFA`); rails are sticky under the bar. Below 1100px the headnote rail drops and the calendar narrows to 220px. Below 720px it is one column with a bill bar at the top and a fixed 64px remark bar at the bottom. Turns are padded 96px left (the page gutter) and 48px right, at a 68ch measure.

**Breakpoints:** 720px (phone layout, `max-width: 719.98px`), 1100px (reader drops the right rail), 640px (speaker card and citation tools become bottom sheets; the search filters sheet appears below 720px).

**Rhythm:** no spacing scale; observed steps cluster at 6, 8, 10, 12, 14, 16, 18, 22, 24, 32, 48px. Row padding 8 to 11px desktop.

## Elevation & Depth

Flat by default; depth is reserved for things that float. Panes sit on stone and are separated by rules, not shadows.

### Shadow Vocabulary
- **Float** (`0 2px 4px rgba(22,27,34,.08), 0 16px 32px -12px rgba(22,27,34,.28)`): Search tips panel, suggestions list, speaker card, citation panel, export menu.
- **Sheet** (`0 -8px 24px rgba(22,27,34,.18)`, over a `rgba(22,27,34,.38)` dim): phone bottom sheets.
- **Press** (`0 1px 2px rgba(8,82,61,.3)`): primary button only.
- **Field lift** (`0 1px 2px rgba(22,27,34,.06)`): the large search field at rest.
- **Focus halo** (`0 0 0 3px` `act-wash`): search fields and the bills filter on focus, with the border turning ink.
- **Current row** (`0 0 0 1px` `rule`, `0 1px 2px rgba(22,27,34,.06)`): the current reading in the calendar rail, on a white ground.

### Named Rules
**The Float-Only Rule.** Only overlays cast shadows. Lists, panes and rows never do.

## Shapes

Small, firm corners that grow with the element: 2px on `mark`, 3px on photos and checkboxes, 4px on chips and keys, 5px on calendar rows and small toggles, 6px on buttons, fields, segmented controls and notes, 8px on the large search field, popovers, panels and full-width phone buttons, 16px on the top corners of bottom sheets. Borders are 1px; section heads and table heads use a 1.5px ink rule; timeline lines are 1.5px. Page breaks are a dashed rule (6px dash, 4px gap, `rule`). Member photos are portrait rectangles, never circles.

## Components

### Buttons
Restrained and green-led.
- **Shape:** gently squared (6px), 8px when full-width on phones (44px tall, 14.5px).
- **Primary:** solid green, white 650 13.5px, 36px tall, 16px padding, press shadow; hover to deep green. Search's Go button is 52px tall, 15px; on phones it becomes a 38px icon square inside the field.
- **Outline:** white, green 600 13px text, `#B9CFC6` border, 32px tall; hover border green, ground `#F6FAF8`.
- **Quiet:** white, `ink2` text, `rule` border; hover ink text, `#B9BFC6` border, `#F8F9F9`.
- **Text actions:** "Copy citation", "Context", links: green 600 to 650, underline on hover at 2px offset.
- **Focus:** a 2px green outline at 2px offset on every focusable element.

### Chips
- **Style:** white, `rule` border, 4px, 600 12.5px ink, 2px 7px. Used for search examples and syntax in Search tips; clickable chips darken the border to `#9AA1AA` on hover.

### Segmented control
- One 6px bordered strip, options 550 13.5px `ink2` separated by rules; the chosen option is filled ink with white text. Used for search scope and citation style (12px). Year pickers and the A–Z strip use separate 5px toggles with the same ink-fill current state.

### Status pennant
- Flag icon (14px) plus 600 12.5px text: hollow flag in `ink2`, solid flag in red (vetoed) or amber (amended or corrected).

### Photo
- Portrait rectangle, 3px corner, `#ECEEEF` ground, `rule2` border. Sizes 28×36, 40×52, 56×72 (48×62 in sheets and page titles). A missing photo shows a bottom-aligned person silhouette in `#C6CBD0`; never a broken image, never initials.

### Inputs / Fields
- **Search field:** 52px (44px on the search page, 50px on phones), 1.5px `#8F97A1` border, 8px corner, 450 17px text (16px on phones). Focus: ink border plus the wash halo. No motion.
- **Bar search:** 38px, 1px `#B9BFC6`, 6px, 450 15px, with a `/` key hint; hidden on phones.
- **Selects and the bills filter:** 32 to 36px, 6px corner, 550 13.5px.
- **Facet checkboxes:** 15px, 1.5px `#9AA1AA`, 3px; checked fills green.

### Navigation
- Section links 550 14px `ink2`; the current one is ink with a 2px ink underline sitting on the bar's bottom rule. Page tabs are 600 14px with the same underline and tabular counts in `ink3`; on the senator page they sit in a pinned white tab bar (1px `rule` below) that switches the list shown, and the senator's name (700 14px) joins it once the page title scrolls away (its own 13px line above the tabs on phones). Phone menu: a full-width white panel, 600 15px rows, current row marked by a 3px ink left bar.

### Search tips panel
- A 700px white float panel anchored under the "Search tips" link, with a 12px rotated-square pointer at right 28px (left 28px on phones, where the panel spans the full width). Two columns of syntax chips and plain explanations in a definition grid; a closing line under a `rule2` rule. One column on phones.

### Suggestions list
- A float panel under the search field (8px). Group headings use the small uppercase label; rows are 7px 16px with a 14.5px name (matched text 750), a 12.5px `ink3` meta line and a right-aligned count. The active row gets `#F4F7F5` and a 2px inset green bar on the left. A keyboard-hint footer shows on desktop only.

### Speaker card and bottom sheet
- Opened from the keyboard (Enter on a focused name), the card takes the focus and Esc returns it to the name; names carry a screen-reader hint that they open a card.
- Desktop: a 400px float popover (8px, 14px 16px) opened from a speaker label: photo, 700 15px name, 12.5px tabular meta, an "N remarks in this hearing" row between `rule2` rules with Prev/Next small toggles, then primary and outline buttons.
- Phone (≤640px): the same content in a bottom sheet with a 38×4px grab handle, 48×62 photo, 18px name, and full-width 44px stacked buttons.

### Citation panel
- A 440px float popover (12px 14px): 700 13px `ink2` heading, a style segmented control, the citation in Charis italic 13.5px `ink2`, then a row of buttons; failure text in red. On phones it becomes a bottom sheet with 14.5px citation text and a full-width 44px primary.

### Timeline
- Horizontal steps on desktop: 13px dots on a 1.5px `rule` line; completed steps are solid ink dots joined by an ink line, open steps are hollow (`pane` with `#8E96A0` border) with `ink3` labels. Step label 650 13px, date 12.5px `ink3`. Vertical list on phones.

### Tables and lists
- Ruled rows on white panes with fixed leading columns (bills table 96 / fluid / 170 / 150 / 84; remark rows 112 / fluid / 158 with a ruled citation column). Under 720px every table restacks into two-line ruled rows: identifier and status on the first line, title spanning beneath, meta last. They stay ruled rows, not boxed cards.
- Rows open their main link from anywhere in the row (not while text is being selected, not on a control in the row): a pointer cursor, a soft `rgba(22,27,34,.045)` tint with 6px corners reaching 10px past the text (devices that hover), and the main link underlines. Result rows tint `#FAFBFA`. Rules between list rows are `rule2`. The link stays the keyboard target.
- Year lists hide pro forma legislative days behind the summary's own words: "343 legislative days hidden · Show" (green 600 action), "· Hide" once shown; month counts follow what is shown.
- In narrow lists (the senator side panel, phones) a bill's status pennant sits under its title so the title keeps the width; the wide bills list keeps a status column on desktop.

### The reader (signature)
- **Turns:** Charis 17px/1.62 in `#1D232B`, paragraphs 12px apart.
- **Speaker labels:** inline before the first words, uppercase Archivo 700 12.5px with 0.06em tracking, then a 14px gap. Senators (and chairs and Assembly members with a card) are ink with a `#B4BAC1` underline at 3px offset; hover or the selected speaker turns the underline ink, 2px when selected. Procedural voices (Presiding Officer, Secretary) are `ink2` and not underlined; those with a card still open it on click.
- **Gutter page number:** the turn's starting page, 12px `ink3` tabular, right-aligned in the 96px gutter. On phones it moves above the turn as "p. N" at 11.5px.
- **Page breaks:** "p. N" in 750 12.5px ink tabular, right-aligned in the 96px gutter beside the first line of the new page, with nothing drawn across the text (a rule read as a break in the speech). A page that begins mid-sentence keeps the sentence one paragraph. On phones, with no gutter, "p. N" is 11.5px `ink3`: a small line above a paragraph, or inline where a page begins mid-sentence.
- **Speaker strip:** when a long remark's label has scrolled under the bar, a strip just under it names the speaker (uppercase Archivo 700 12px, then "continued" 12.5px `ink3`, a `rule2` line below). It floats over the text, so showing it never moves the transcript. The name in it opens the speaker's card, as the label does.
- **Bill headers:** at each calendar reading, a `#FBFBFA` note box (1px `rule`, 6px, 68ch) with "No. {cal} · {print no.}" in Archivo 750 13.5px and the bill title in Charis 15px.
- **Calendar rail:** each row is one link to its reading in the text: calendar number (34px, `ink3`), bill number in green 650 with a 12px status line, and a remark count; a 14px document icon at the row's end opens the bill page. Rows tint on hover; the current reading is a white row with a 1px rule ring.
- **Headnote rail:** green bill-number link 750 15px, bill title 700 17px, an 82px-label definition list at 13px, remark position, and J/K key hints.

### Markup contract (search and islands depend on it)
- A labelled turn is `section.turn#r-{i}` with `data-role`; an unlabelled turn (cover, stage directions) is `section.turn#t-{i}` with `data-role` and `data-page`.
- The label is `h3#w-{i}-{page|0}-{key|x}` with class `sp`, plus `k` when it has a speaker card and `sen` when it is a spoken, underlined voice (senator, chair, Assembly). Speaker key and page live only in this id.
- Page breaks are `.pb#p{page}` containing `<b data-pagefind-ignore>p. N</b><i></i>`, a `div` between paragraphs or a `span` inside an interrupted paragraph; the gutter number is `span.g#p{page}`. Each page id is emitted once.
- Turns come 40 to a `.chunk` using `content-visibility: auto` with an estimated `--h`. Bill headers are `.rd-seg`. Gutters, bill headers and the "p. N" text carry `data-pagefind-ignore`; the page break itself stays in the index so Pagefind records `p{page}` as an anchor and search knows the page of every word.

## Do's and Don'ts

### Do:
- **Do** keep green for actionable things only; state lives in the pennant flags.
- **Do** set every spoken word and bill title in Charis SIL, and every interface word in Archivo.
- **Do** use tabular figures for dates, pages, calendar numbers and counts.
- **Do** keep "p. N" visible: gutter number at each turn's first page, dashed page-break rule at every break.
- **Do** keep lists as ruled rows on white panes, restacking to two-line rows under 720px.
- **Do** keep refinements subtle: a weight step, a rule, an underline colour.

### Don't:
- **Don't** give speakers colours; no multicolour speaker identity.
- **Don't** add avatars: no initials, no circles, no portraits beside transcript turns. Official portraits appear only as small rectangular photos in cards, lists and page titles.
- **Don't** use a dark masthead; the bar stays white with a 1px rule.
- **Don't** restyle lists or results as boxed cards.
- **Don't** add motion to the search box (no transitions, no animated placeholder or expanding field); the shipped CSS has no motion at all.
- **Don't** use red or amber as fills or backgrounds, or the highlighter for anything but search hits.
