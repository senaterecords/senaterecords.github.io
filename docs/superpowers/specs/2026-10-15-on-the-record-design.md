# On the Record: design

**Date:** 2026-10-15
**Status:** Draft for review
**Related:**
- Product record: [PRODUCT.md](../../../PRODUCT.md)
- Visual direction mocks: [.impeccable/mocks/src/dir-citator.html](../../../.impeccable/mocks/src/dir-citator.html) (homepage, search results, reader) and [.impeccable/mocks/src/dir-citator-pages.html](../../../.impeccable/mocks/src/dir-citator-pages.html) (senator, bills list, bill, browse, about). All eight are shown in [citator-all.html](../../../.impeccable/mocks/src/citator-all.html).
- Direction contract: [.impeccable/surfaces/impeccable-mocks-src-dir-citator-html.md](../../../.impeccable/surfaces/impeccable-mocks-src-dir-citator-html.md)

## 1. Summary

On the Record (a working name) is a free public website that makes New York State Senate floor transcripts (1993 onward) and public hearing transcripts searchable at the level of **who said what**. Every remark is attributed to a speaker, can be cited to the official page, and is linked to the bill being debated.

The site is pre-built, with no server. A Python job runs hourly on GitHub Actions. It pulls new transcripts from the NY Senate Open Legislation API, parses them into speaker turns, links senators and bills, and builds an Astro site with in-browser search (Pagefind). The result is deployed to GitHub Pages. Running costs are $0.

## 2. Users and goals

- **Primary users:** NY Senate and legislative staff, and researchers. They are experts in the material but not necessarily technical, so everything must work through the interface, with no command line. They do quick lookups and long reading sessions in roughly equal measure.
- **Jobs:**
  - find what was said, by whom and about which bill
  - copy quotes with a citable page
  - follow a senator
  - follow a bill's debate
  - read and save transcripts
- **Success:**
  - A phrase search shows who said it, when and the surrounding text within seconds.
  - One click opens a senator's remarks, and one click opens a bill's debate with its sponsor, status and vote.
  - Any transcript can be saved as a Word document, PDF or plain text; search results and a senator's record as a Word document or a spreadsheet.
  - The data stays current with no manual work.
  - The site costs $0 a month.

## 3. Scope

**Phase 1 (this spec):**
- floor transcripts and public hearing transcripts
- full-text search
- the transcript reader
- senator pages
- bill pages for bills that appear in transcripts
- browse pages
- export
- an About-the-data page

**Later phases (separate specs):**
- full bill search across all bills
- consolidated laws
- floor calendars and agendas

The navigation reserves space for these (the mock shows "Laws" as a later item).

**Non-goals for phase 1:**
- user accounts
- email alerts
- server-side search
- Assembly transcripts (the API doesn't provide them)
- a desktop app

## 4. Architecture

```
GitHub Actions (four times an hour, at :07, :22, :37 and :52)
  1. sync     ask the API what changed since the last sync; download raw JSON into data/raw/
  2. process  clean → split speakers → match senators → segment bills → fetch bill details → site data
  3. build    Astro renders pages from the site data; Pagefind indexes the built pages
  4. deploy   GitHub's Pages action publishes dist/ to GitHub Pages
  Steps 2–4 run only when step 1 found changes (or on a manual run).
```

**Repository layout:**
```
pipeline/                 Python package (nyleg) + tests
  nyleg/api.py            API client: key, paging, retries, polite throttle
  nyleg/sync.py           incremental and backfill sync into data/raw/
  nyleg/clean.py          era-aware text cleanup, page map
  nyleg/speakers.py       speaker-turn splitter
  nyleg/senators.py       speaker label → senator matching
  nyleg/bills.py          bill mention extraction, calendar segmentation, bill fetch
  nyleg/sitedata.py       writes the site data contract (section 7)
  nyleg/quality.py        quality report and regression gate
  tests/fixtures/         real sample transcripts from each era, with expected outputs
site/                     Astro + React islands + Tailwind
data/raw/                 committed: exactly what the API returned
data/state.json           committed: last sync timestamps, backfill progress
data/overrides/           committed: reviewed fixes (speakers.yaml, bills.yaml)
data/rosters/             committed: reviewed lists the API lacks (senate-1993-2008.yaml, officers.yaml)
data/corrections.json     committed: date each stored transcript's text last changed (drives "Corrected transcript")
data/site/                generated in CI, not committed
.github/workflows/update.yml
```

**Key decisions:**
- **The repository stores the raw data.** Raw API responses are committed exactly as received, so a parser fix can reprocess everything without downloading it again, and git history keeps old versions of corrected transcripts. Processed data is regenerated on every build.
- **Pages never call the NY API at runtime.** The API key exists only in GitHub encrypted secrets.
- **The pipeline and the site are separated by a data contract (section 7).** Either side can change without breaking the other, as long as the contract holds.

## 5. Data source

These facts about the API were verified against the official docs and the OpenLegislation source code (dev branch, 2026-10-06).

- **Base URL and key:** the base is `https://legislation.nysenate.gov/api/3/`. The key is passed only as `?key=`; without it the API returns HTTP 401 with `errorCode 701`. No rate limits are documented, and the client throttles itself to about 1 request per second.
- **Floor transcripts:**
  - `/transcripts`, `/transcripts/{year}`, `/transcripts/{dateTime}`, `/transcripts/{dateTime}/{sessionType}`
  - Updates: `/transcripts/updates/{from}/{to}`
  - Parameters: `limit` (max 1000), `offset`, `full=true`
  - **`sessionOnly=false` is required.** The default hides pro forma "legislative days".
  - Fields: `dateTime`, `sessionType` (title case, e.g. "Regular Session"), `location`, `dayType`, `text`.
  - There is no date-range listing; listings cover either all transcripts or one year.
- **Public hearings:**
  - `/hearings`, `/hearings/{year}`, `/hearings/{id or filename}`
  - Updates: `/hearings/updates/{from}/{to}`
  - Fields: `id`, `filename`, `title`, `date`, `address`, `committees[]`, `startTime`, `endTime`, `text`.
  - **Quirk:** hearing ids of 1000 or more can't be fetched by id, so the pipeline fetches by filename.
  - **Quirk:** the `total` in hearing listings is wrong, so the pipeline pages until a page comes back empty.
- **Text format:**
  - Speaker labels are uppercase and end with a colon (`SENATOR SMITH:`, `ACTING PRESIDENT JONES:`, `THE SECRETARY:`).
  - Each page starts with a right-aligned page number, and the numbers continue across sessions.
  - Line numbers 1–25 appear with blank spacer lines, and pages are separated by form feeds.
  - The layout differs between 1993–98, 1999–2004 and modern files.
  - Hearings add vendor footers, "Page N" headers and labels that wrap across lines.
- **Bills are mentioned in recognisable patterns.** Readings before about 2009 name the sponsor first ("Calendar Number 12, by Senator X, Senate Print 4597-A"). Modern readings name the bill first ("Calendar Number 1, Senate Print 88, by Senator Gianaris"). Assembly bills appear as "Assembly Bill Number N" or "Assembly Print N, by Assemblymember X"; budget bills have no sponsor; and occasionally the chamber is missing ("Print 2310B"). These mentions often wrap across lines. **The API itself doesn't link transcripts to bills.**
- **Corrected transcripts are reissued,** and the updates endpoints report them.

## 6. Data pipeline

### 6.1 Sync
- **Backfill:** a one-time download, year by year with `limit=1000&full=true&sessionOnly=false`, plus hearings and the members list for each session. It resumes from `data/state.json` and must stay under GitHub's 6-hour job limit, so it spreads across as many runs as needed.
- **Incremental:** each hourly run calls the floor transcript updates endpoint since the last sync and re-downloads anything changed. A transcript that is listed as updated but can't be fetched is recorded in `data/state.json` and doesn't stop the run.
- **Hearings:** refreshed by re-listing this year's and last year's hearings once a day, because some are posted weeks after they happen and the hearing updates endpoint's item shape isn't verified.
- **Corrections:** when an already-stored record's text changes, the date is written to `data/corrections.json`.
- **Members:** both chambers' lists are kept for each session. Senators are matched to speakers; the Assembly list keeps joint-hearing chairs from being guessed and powers Assembly member cards.
- **Photos:** each member's API photo (55×71, about 2 KB) is downloaded once, so the site never hotlinks the Senate's server. Older file names contain spaces and apostrophes; folders and `..` are refused; `no_image.jpg` is the API's placeholder and is treated as no photo.
- **Raw storage:**
  - `data/raw/transcripts/{year}/{dateTime}__{sessionType-slug}.json`
  - `data/raw/hearings/{year}/{hearing-key}.json`, where the key is the id when it is under 1000 and the filename otherwise
  - `data/raw/members/{session}.json` and `data/raw/members-assembly/{session}.json`
  - `data/raw/bills/{session}/{printNo}.json`
  - `data/raw/photos/{imgName}`

### 6.2 Clean
- **Layout detection:** detect each file's layout from its content (not its date), then strip page numbers (including vendor "Page N" headers), line numbers, spacer lines and form feeds.
- **Running headers and vendor footers:** stripped when the same text appears in the first or last two lines of at least 30% of pages (and at least 3) **and almost never anywhere else**. A line that starts like a speaker label is never stripped, even when a presiding officer opens every page.
- **Line joining:** rejoin wrapped lines into paragraphs. A line indented well past the body indent starts a paragraph; the body indent is that of lines starting in lower case, or, in the six transcripts typed in capitals, the smallest indent a fifth of lines share.
- **Page map:** build a map from character offsets to official page numbers, so every turn knows the page or pages it starts and ends on.

### 6.3 Speaker turns
- **Splitting:** split the text on speaker labels. A label can stand alone on its line; hearing labels can wrap across lines. Labels may contain accented capitals (SENATOR SEPÚLVEDA) and name particles (SENATOR DeFRANCISCO, McDONALD); matching folds accents.
- **Roles:** each turn gets a role: `senator`, `presiding` (for example Acting President), `secretary`, `guest` or `witness`.
- **Turn fields:** `{ index, label, role, senatorId?, text, pageStart, pageEnd, bills[] }`. The cleaned text is never reworded.
- **Fallback:** when a transcript can't be split reliably, it is published as cleaned text without turns and flagged in the quality report. "Reliably" means at least 80% of its characters fall inside recognised speaker turns; the threshold can be tuned.

### 6.4 Senator matching
- **Session year:** the odd year on or before the transcript date.
- **Matching:** `SENATOR X` is matched to that session's members by short name, then surname, then first and last name (middle initials ignored; particles such as O' and De kept). Where two senators share a surname, the transcript uses the full label (e.g. "ADA SMITH"). `ACTING PRESIDENT X` maps to senator X in the presiding role. It never guesses: an ambiguous name stays unlinked.
- **Before 2009:** the API lists senators from 2009 only. `data/rosters/senate-1993-2008.yaml` adds the 117 senators of 1993–2007 from the Senate tables of the 190th–197th Legislature pages, cross-checked against every 1993–2008 speaker label. 55 who served on are linked to their API record, so one page covers a whole career. Exact join and leave dates (special elections, deaths, resignations) settle surnames shared within a session, such as Leonard and Toby Ann Stavisky in 1999. Their ids are permanent.
- **Joint hearings:** a chair links to a senator only when no Assembly member of that session shares the name, and to an Assembly member only when no senator does. `ASSEMBLYMAN X` links to the Assembly member.
- **Officers:** `THE PRESIDENT` is the Lieutenant Governor in office that day (official terms in `data/rosters/officers.yaml`; nobody during vacancies). `THE SECRETARY` is the Secretary of the Senate named on that transcript's own cover page, matched by surname so cover typos still resolve. The card says who held the office, not who read: a deputy often reads.
- **Stable identity:** `memberId` from the members endpoint, which stays the same across sessions (verified 2026-10-15).
- **Fixes:** labels that can't be matched go into the quality report and can be fixed in `data/overrides/speakers.yaml` without changing code. Stenographer typos with exactly one close senator in the session were added after review.

### 6.5 Bills and debates
- **Mentions:** after cleaning, extract bill mentions from floor transcripts and hearings and normalise them to `{session, printNo}` (e.g. `S4597A`). Speakers and witnesses also write print numbers compactly ("my bill, S9051B", "S1507-C", "S5040/A7046"); these count when they have three digits or more and stand alone, so "Class A1", "NY-A100" or an Airbus A320 stay plain text. `MENTION_RULES` in `nyleg/bills.py` is raised with each new form, and the next sync reads every stored record again for the bills it now finds.
- **Special sessions:** extraordinary sessions number their bills from 1, and the API files them as `S5000N` / `A4000N`. A small number read in an extraordinary session links that bill only when it was published within 45 days before the session; otherwise it stays unlinked, never linked to the regular bill of the same number. Several special sessions in one term reuse numbers and the API keeps one bill per number.
- **Misread numbers:** `data/overrides/bills.yaml` holds reviewed fixes by date and printed number (for example "Senate Print 90004D" for S9004D), each checked against the API and the words read on the floor.
- **Calendar segments:** in floor transcripts, a segment starts with each Secretary reading that begins `Calendar Number N,`, in either order (section 5), and ends at the next reading or at the end of the day.
- **Debated or not:** a segment is **debated** when non-presiding senators or chairs speak at least 40 words before the outcome ("passed", "lost" or "laid aside"). "Lay it aside" alone is not a debate. The debate window ends at the outcome, so a motion to adjourn after the vote isn't counted.
- **Bill details:** sponsor, title, status, milestones and floor votes, fetched one bill at a time with `view=no_fulltext`, using a resumable per-run budget. The bulk listing with `full=true` does include votes, but also each bill's full text (about 34 KB per bill), so it isn't used. Current-session bills are re-fetched weekly, so status, votes and the Governor's action stay current. Bill data starts in **2009** (verified); earlier bills show their print number without a detail card.

### 6.6 Quality report and gate
- **The report covers:**
  - the share of text attributed to speakers
  - unmatched labels
  - unlinked bill mentions
  - transcripts that fell back to plain text
  - counts per year
- **Where it goes:** it is written each run as a build artifact for the maintainers and the gate. It is not shown to visitors: the About page says plainly where the data comes from and shows the archive's size.
- **The gate:** deployment is blocked if attribution or bill linking drops by more than 2 percentage points from the last deployed build, or if the number of floor transcripts or hearings falls. Plain-text fallbacks count as unattributed. The threshold can be tuned.

## 7. Site data contract (`data/site/`)

| File | Contents |
|---|---|
| `meta.json` | last updated time, counts, quality summary |
| `transcripts/{slug}.json` | metadata (type, date, session type, location, pages, committees) plus `turns[]` (an `assembly` slug appears only on turns matched to an Assembly member), `segments[]` (calendar no., bill or null for an unresolvable special-session reading, debated, outcome, votes, turn range), `plainText` (fallback flag), `corrected` (date or null), `officers` (`president`: Lieutenant Governor name, title and term years, or null; `secretary`: the Secretary of the Senate named on the cover, or null) and `unresolvedBillMentions` |
| `senators.json` | every senator: id, slug, name, `photo` (path or null), `service` (separate stretches in years, `to` null while serving, `beforeRecords` when already serving in 1993), district per session (the API has no party), remarks, presiding turns and transcripts |
| `senators/{slug}.json` | the same identity fields, appearances (transcript, remarks, presiding turns, first page), bills debated or sponsored, totals |
| `assembly.json` | Assembly members who speak (joint hearings): id, name, district per session, `photo`. They have cards, not pages |
| `photos/{slug}.jpg`, `photos/assembly/{slug}.jpg` | member photos copied from the raw store |
| `bills/{session}.json` | every bill mentioned that session: card fields, the debate segments that reference it (with `debateEnd`), and `mentionedIn` (every transcript that mentions it: the page and remark where it is first named, and the sentence that names it) |
| `words/{prefix}.json` | vocabulary with frequencies for "did you mean" suggestions, split by two-letter prefix |

Slugs are:
- floor: `2025-06-10-regular-session`, or `2025-06-10-extraordinary-session-ii`
- hearings: `{date}-{title-slug}`, with the hearing key appended on a collision

## 8. Site

### 8.1 Visual design
- **Direction:** "The Citator", as mocked in `dir-citator.html` and approved by the user on 2026-10-15. It has a legal-research feel with restrained color.
- **Colors:**
  - stone ground `#F3F4F1`
  - white reading panes
  - ink `#161B22`, secondary text `#4B535E` / `#666D77`, rules `#D7DBDF`
  - highlighter `#FFE36E` on search hits
  - ledger green `#0B6B50`, **only on actionable things** (copy cite, search, export, filters)
  - pennant flags: red `#B42318` for vetoed, amber `#9A6200` for corrected or amended, hollow ink for passed
- **Type:** Archivo for the interface, with tabular figures for dates, pages and counts. Charis SIL for every spoken word.
- **Reader details:**
  - Speaker labels sit **inline** before the speech: uppercase Archivo 12.5px, then a **14px gap**. Senators are underlined as links; procedural voices are not.
  - Official page numbers sit in the gutter beside the first line of each new page, with nothing drawn across the text, so a speaker's turn never looks broken (changed 2026-10-16 after testing the live build; the first design drew a dashed rule). A page that begins mid-sentence keeps the sentence one paragraph. On phones the number is a small "p. N" above a paragraph or inline.
  - In a long remark, once the speaker's label has scrolled away, a strip under the bar keeps naming the speaker ("… continued"); it floats over the text, so nothing moves (2026-10-16).
  - Speaker names open a card (hover on desktop, tap on phones, where it is a bottom sheet). Card kinds: senator (photo, district and service, career totals, remarks here with previous and next, open senator page, show only this speaker), senator presiding (times presiding), senator before 2009 (no photo), Assembly member in a joint hearing (official page link, no page here), the Lieutenant Governor for THE PRESIDENT (name and term), and THE SECRETARY (the role, and the Secretary of the Senate named on the cover).
- **Mobile:** designed before building in `mocks/src/mobile.html` (390 px): a menu button, back arrows, bottom sheets for the speaker card and the citation tools, a bill bar on top of the reader and a previous and next remark bar at the bottom, a vertical bill timeline, cards in place of tables, and search filters behind one button.
- **Constraints recorded from user feedback:**
  - no multicolor speaker identity system
  - no dark masthead
  - no boxed-card restyle
  - refinements stay subtle
- **Closing steps:** the front-end build ends with an Impeccable finish review against the mock and the direction contract. A DESIGN.md is then recorded from the built site.

### 8.2 Pages

| Route | Content |
|---|---|
| `/` | a plain lead, record filters above the search box, three clickable example searches and a Search tips panel below it, shortcut suggestions while typing, latest transcripts, most-debated bills this session |
| `/search?q=…` | results in fixed columns (date · speaker and quote · page, status, cite); facets for record type, senator, bill, session/year, committee; sort by relevance, newest or oldest; export results |
| `/transcripts/{slug}/` | the reader: calendar rail (floor) or speaker list (hearings); the text with remark anchors `#r-{index}` and page anchors `#p{page}`; the bill headnote; find in transcript; export; J/K to move between remarks |
| `/senators/` and `/senators/{slug}/` | A–Z index; senator page with sessions, appearances, bills debated, and search limited to their remarks. The Remarks / Transcripts / Bills tabs switch the list shown and stay pinned with the senator's name while scrolling (2026-10-16) |
| `/bills/` and `/bills/{session}/` | the Bills list: every bill read on the floor in a session (session picker, defaulting to the current one). It has a search box (number, title, sponsor), an All / Debated / No debate filter, and sorting by most debated, newest or number. Columns: bill · title and sponsor · floor debate (remarks, senators) · status · last floor date. |
| `/bills/{session}/{printNo}/` | one page for **every** bill (decided 2026-10-16): header (number, status, title, sponsor, co-sponsors, committee, Assembly companion) and a milestone line from Introduced to Governor. **The floor debate** is the main block: date line, a plain outcome ("Debated and passed, 41–20"), an excerpt and Read the debate. **Earlier on the floor** lists other appearances in plain words (for example "Brought up, then held for another day at the sponsor's request. No vote."). **Discussed in public hearings** lists hearings that mention it, each linking to its page. A side panel shows the floor vote (with how each senator voted) and who spoke. Bills only mentioned in passing list where they were mentioned. Bills before 2009 show their number with "Full details not available for bills before 2009". |
| `/browse/{year}/` | transcripts by year |
| `/about/` | what the site does, the data source (the Senate's Open Legislation API), that it updates itself (no promised interval; the bar shows the last check), citing by official page, and the archive's size with the last update time. No quality numbers or gaps list (decided 2026-10-16) |

**Copy with cite** produces, by default (legal style):
- floor: `N.Y. Senate Tr., June 10, 2025, at 5780 (remarks of Sen. Ortega)`, or `at 5780–81` when the quote spans two pages
- hearings: `N.Y. Senate Pub. Hr'g Tr., {title}, Mar. 18, 2025, at 112 (remarks of Sen. Okafor)`

A **Plain** choice in the same menu gives `NY Senate floor transcript, June 10, 2025, p. 5780 (Sen. Marisol Ortega)`, or for hearings `NY Senate public hearing, {title}, March 18, 2025, p. 112 (Sen. Adaeze Okafor)` (decided 2026-10-16). **Export** is generated in the browser when clicked. Word documents (.docx), spreadsheets (.csv, which Excel opens) and plain text are built from the page content, with no library; PDF uses a print stylesheet and the browser's "Save as PDF". No export files are stored, which protects the file budget.

## 9. Search

### 9.1 Launch: Pagefind plus a query layer
- **Indexing:**
  - Each transcript page is one Pagefind page.
  - Every turn is wrapped as a heading with an id (styled as the inline speaker label), so Pagefind returns **sub-results per remark** with scoped excerpts and direct links.
- **Filters on each page:** `type`, `year`, `session`, `senator` (several values: everyone who spoke), `bill` (several values), `committee`.
- **Sorting:** by `date`.
- **Instant suggestions:** as you type, small JSON lists (`senators.json` and a bill index) offer "Senator Marisol Ortega" or "S4597-A" directly.
- **Shortcut suggestions:** typing a shortcut opens a suggestion list. `speaker:` lists senators (photo, district, years served, remarks), then Assembly members who speak in hearings. Any part of the name matches (first, middle, last, either half of a double-barrelled name), ignoring case, accents and apostrophes, with the matched letters in bold. A shared surname lists every holder with their years, so the user picks instead of the search guessing; a `speaker:` left ambiguous on Enter asks "Which Smith?". `year:` lists years with transcript counts, `bill:` lists bills from a bill index split by print-number prefix (a small new pipeline output), `type:` lists floor sessions and hearings, and a partial shortcut ("sp") suggests the shortcut itself. Arrow keys, Enter and Esc work. Nicknames outside the official name need an alias list if they come up.
- **The query layer (our code in the browser):**
  - parses `"exact phrase"`, `AND` (also the default between words), `OR`, `NOT` or `-term`, `NEAR` (within 10 words; `NEAR/n` within n; checked in the remark text), `speaker:`, `bill:`, `year:` (one year or a range such as `2015-2019`), `type:` (`floor` or `hearing`) and `committee:`. On the homepage, three example searches sit under the box (click to fill it in; hover shows what each finds) beside a "Search tips" link. The Search tips panel (2026-10-17) teaches by one search taken apart, each part captioned and the whole read back as a sentence, then the rules in three columns (Words, Combine, Narrow it down), then five research tasks with the search that does each, and two rules at its foot. No motion
  - **how a word matches** (2026-10-17, the convention of Westlaw, Lexis and congress.gov): a word matches its forms, by the classic English Snowball stemmer Pagefind's index uses (`tax` finds taxes, taxed, taxing, not taxpayer or taxi); `tax*` or `tax!` any word that starts with tax; a quoted word only itself. Highlights follow the same rules. Before, every word matched any word starting with its letters (`sad` found Sadie and saddle)
  - `committee:` takes part of a name when no committee is named exactly so and only one fits (`committee:Housing` is Housing, Construction and Community Development)
  - **where the words must be:** in one remark by default, or anywhere in a transcript (remarks holding any of the terms, from transcripts that hold all of them), a choice beside Sort on a computer and at the top of the Filters sheet on a phone (2026-10-17). It is offered only when it can change what the search finds, that is when two or more words or phrases must come together (a NEAR pair counts); for a single word or phrase, or words joined only by OR, it isn't shown, and a link asking for a whole transcript reads as one remark
  - turns field prefixes into Pagefind filters
  - runs one Pagefind search per OR branch and merges the results. They are read in one order: by relevance, interleaved by Pagefind's score (a transcript found twice counts once, at its best); by date, from a small list of each transcript's date that the build writes (`/data/search-dates.json`, by Pagefind id), since Pagefind's results carry a score but no date. Before 2026-10-17 each branch's results came one after the other, so an OR showed every transcript of its first branch before any of the second
  - removes remarks that contain any `-term` (or all the terms of a `-( … )` group)
  - supports several exact phrases in one search (`"congestion pricing" "toll revenue"`: remarks containing both; with `OR`, either) by running one exact Pagefind search per phrase (plus one for the other words), keeping the transcripts every search found, then checking each remark's text for every phrase. Tested on the real archive (2026-10-16): every checked remark held every phrase. Searching all the words at once (the first design) ranked transcripts with the words far apart and took up to 44 s; Pagefind runs an exact search only when the whole term is one phrase
  - reads each matching page's text straight from its Pagefind fragment (native gzip), not through Pagefind's `data()`, which builds excerpts the site never shows (measured: 6.6 s against 0.2 s for 20 long transcripts); pages are read a few at a time and their remarks appear in ranking order as they arrive, 25 at a time
  - `bill:S4597` is that number in any session; `bill:S4597/2025` (either year) is that session's bill, which picking a bill suggestion inserts
  - while results load, result-shaped placeholder rows shimmer (still when the reader prefers reduced motion) and a status line says what is happening
  - **keeps only the named speaker's own remarks** when `speaker:` is used, by checking each sub-result's speaker heading (presiding turns left out). `speaker:` covers senators and Assembly members; `senator:` is the same among senators only (2026-10-16)
  - several values of one shortcut mean any of them (`speaker:Krueger speaker:Lanza`, `year:2019 year:2021`, two `committee:`); different shortcuts must all hold. A lowercase "and" means AND (2026-10-16)
  - supports `NEAR` (within 10 words) and `NEAR/n` (within n words), either side a word or a phrase, by checking remark text (2026-10-16)
  - matches within one remark by default; when no single remark has every term but transcripts do, it says so and offers the remarks of those transcripts ("Show matches across a whole transcript") (2026-10-16)
  - a search with only filters looks up one hidden word every indexed transcript holds, because Pagefind with no word loads its whole index (measured 73 MB for `speaker:luis-r-sepulveda`); such searches read newest first (2026-10-16)
  - facets: a group in use is counted without its own choice so other values stay listed to add; top 10 (8 years, newest first) with "All N …"; the heading says "so far" until every matching transcript is read (2026-10-16)
  - **brackets** group terms at any depth, with the usual precedence (brackets, NOT, NEAR, AND, OR): `(tolls OR fares) bridge`, `budget NOT (tax OR school)`, `(tolls OR fares) NEAR/3 bridge`. The query is worked out into OR branches of ANDs, each searched as before; past 16 branches the page says the search has too many combinations rather than running them. An unclosed bracket closes at the end (2026-10-16)
  - shortcuts outside brackets narrow the whole query wherever they stand (`tolls OR fares year:2019` is either word, in 2019), as the filter list adds them; inside brackets they belong to their group (`(tolls speaker:Krueger) OR (fares speaker:Liu)`); `speaker:(Krueger OR Liu)` is any of them (2026-10-16)
  - NOT or a minus works on shortcuts and groups: `-speaker:Krueger` leaves her remarks out, `-year:2019`, `-type:hearing`, `-committee:…` and `-bill:…` leave those transcripts out (through Pagefind's `none` filter), and `NOT (bridge speaker:Krueger)` only her remarks that say bridge. Each remark is also checked against its branch's shortcuts using the transcript's filter values in its fragment. Before this, a NOT or minus on a shortcut was dropped and the shortcut kept, finding only that speaker (2026-10-16)
  - with OR, the filter counts cover every branch: two or three searches are added up less their overlap (one more search per overlap), so a transcript found twice counts once. That holds only where each search runs in one go; a phrase is searched on its own and Pagefind's counts are then its first part's, so with phrases (or more than three searches) the counts are added up, capped at the transcripts found. A speaker the whole search leaves out is not offered as a filter (2026-10-16)
  - suggests "Did you mean…" from the `words/` vocabulary when a search returns nothing
- **Known limits:**
  - no automatic typo correction (only the suggestion)
  - filters work at the transcript level before the query layer narrows the results, so totals are shown per transcript first
  - aggregate questions ("who talked most about X") are answered by counts the pipeline calculates ahead of time, not by search

### 9.2 Early experiment: SQLite in the browser
- **The idea:** build a SQLite database with an FTS5 full-text index and one row per remark (`transcript`, `turn`, `speaker`, `date`, `bills`, `text`). Host it as static files, split into chunks under 25 MB. The browser queries it over HTTP range requests (for example with `sql.js-httpvfs` or an HTTP VFS for the official SQLite WASM build).
- **What it would add:** true remark-level filters, OR/NOT/NEAR, ranking, and counts.
- **The test:**
  - Check that GitHub Pages honours HTTP Range requests (a well-known sql.js-httpvfs demo is hosted there).
  - Run 30 representative queries (rare term, common term, phrase, speaker filter, OR/NOT) on the full real corpus.
- **Adoption rule:** adopt it as "Advanced search", or as the main engine, if p95 latency is under 3 s and the download per query is under 5 MB on a typical broadband connection. Otherwise drop it. These thresholds are proposed and can be changed.

## 10. Hosting, schedule and size budget

- **Hosting:** GitHub Pages, chosen by the user on 2026-10-15 over Cloudflare Pages. Live counts showed Cloudflare's 20,000-file cap would be exceeded unless legislative days were grouped and left out of search.
  - **Limits:** no file-count cap; the published site may be up to **1 GB**; bandwidth has a **soft limit of 100 GB/month**.
  - **Publishing:** the hourly workflow publishes the main site with GitHub's own Pages action, from the repository `senaterecords/senaterecords.github.io` (code, raw data, workflows). The bill pages are force-pushed as one orphan commit to the `gh-pages` branch of `senaterecords/bills`, through an SSH deploy key with write access (secret `BILLS_DEPLOY_KEY`), so that repository's history never grows. Bills go first; they carry their own copy of the shared styles, scripts, fonts and icons, so either site can publish without the other and still look right. After both, a live check fetches key pages from the public address before the run records what it published. If publishing fails, the previous version stays live, and the next hourly run tries again (it publishes whenever the raw data differs from what was last published).
  - **Address:** `owner.github.io/repo`, or a clean `name.github.io` by creating a free GitHub organization and naming the site repository `name.github.io`. A custom domain can be added later.
- **Schedule:**
  - GitHub Actions cron `7,22,37,52 * * * *` (off the quarter hours, where GitHub is busiest). GitHub starts scheduled runs late or drops them under load: on launch day it started 3 of 9 hourly runs, so the site now asks four times an hour. A run with nothing new takes a minute or two; hearings are re-listed once a day, by the first run of the New York day that gets through, so a dropped run is made up by the next one
  - a `workflow_dispatch` "Update now" button
  - the repo is public, which makes run time free and unlimited
- **Keep-alive:** in a week with nothing published, a commit of `data/last-checked.txt` prevents GitHub from disabling the schedule after 60 days with no activity.
- **Corpus, counted from the live API on 2026-10-15:**

| Record | Count | Years |
|---|---|---|
| Floor session days | 2,297 | 1993–2026 |
| Pro forma legislative days | 5,505 | mostly 1993–2023 (almost none listed after 2023) |
| Public hearings | 261 | 2011–2026 (none in the API before 2011) |

- **Two GitHub Pages sites (decided 2026-10-16):** the main site at the root of the free organization `senaterecords` (`senaterecords.github.io`), and the bill pages as their own site, a second repository named `bills` served at `/bills/` on the same address, so every address stays as it is. Each site has its own 1 GB limit and bandwidth allowance.
- **Size, measured on the final full build (2026-10-16):** 59,635 pages from the full archive in about 470 s on a 16-thread desktop when nothing else runs; the link check takes about 3.5 minutes more.
  - **Main site: 709.6 MB.** Transcripts 495.1 MB (8,063 pages), Pagefind 164.6 MB (2,558 pages indexed: floor sessions and hearings), senators 39.5 MB, data 6.2 MB, browse 2.1 MB, scripts and styles 1.3 MB, photos 0.8 MB.
  - **Bills site: 296.7 MB** (51,289 pages).
  - **0 broken links** of 3,291,954 internal links.
  - **How it got here:** the first build was 1,460.5 MB in one site. Cuts that change nothing a reader sees (linked stylesheets without scoped attributes, an icon sprite, one shared reader script, leaner turn markup, packed reader data, shorter attributes) brought it to 935.5 MB; splitting off the bills then made room to restore what had been cut for size (reader tools on pro forma days, voter links on bill pages) and to link bill numbers in the text (about 105,000 links).
  - **Headroom:** about 240 MB on the main site and 650 MB on the bills site below the 950 MB stop. Growth is roughly 85 transcripts and hearings a year, plus their bills, around 20 MB a year across both.
- **On GitHub's machines (first publish, 2026-10-16):** a run that publishes takes about 10 minutes: process 3 min 12 s, build with the size and link checks and the split 4 min 16 s, uploading and publishing both sites under a minute each. An hour with nothing new ends in a couple of minutes.
- **Speed, measured on the largest transcript** (2003-06-19, 1.25 MB of HTML): first contentful paint 608–1,136 ms on a cold browser and 56 ms warm; 0 ms of long tasks while scrolling 20 screens. React windowing is not needed.
- **Guardrails:**
  - A warning when the built site passes 800 MB.
  - The build refuses to publish above 950 MB.
- **Fallbacks:**
  - Pro forma legislative days are out of the search index. Grouping them by month would save about 25 MB more if ever needed.
  - The bill pages already live in their own site; pre-2009 bills (21,289 pages, about 100 MB) could move to a third if that site ever fills.
  - Put Cloudflare's free proxy in front of GitHub Pages if bandwidth becomes a problem.

## 11. Error handling

| Situation | Behaviour |
|---|---|
| API down, slow or returning 5xx | retry with backoff, then end the run without deploying; the live site stays on the last good version and shows "Updated N hours ago"; GitHub emails the owner on failed runs |
| API key rejected (401) | the run fails with the message "NY Senate API key rejected"; fix it by updating the `NYSENATE_API_KEY` secret |
| A transcript can't be split into speakers | publish it as cleaned plain text with the note "Speaker details aren't available for this transcript"; list it in the quality report |
| Quality drops after a parser change | tests and the quality gate block the deploy |
| A transcript is corrected | re-sync it, show the "Corrected transcript" flag, keep the old raw version in git history; a remark link that no longer exists lands at the top of the transcript with a notice |
| Built site passes 800 MB or 950 MB | warn, then refuse to publish |
| Publishing fails | GitHub Pages keeps serving the previous version |
| A transcript listed as updated can't be fetched (404) | record it in `data/state.json` and carry on with the rest |
| Search assets fail to load in the browser | show "Search couldn't load. Check your connection and try again." |
| A bill is older than the API's bill coverage | show its print number with "Full details not available for bills before {year}" |

## 12. Testing

- **Pipeline:**
  - unit tests per module
  - golden-file tests for clean, speakers, senators and bills, using real sample transcripts from 1993–98, 1999–2004, modern floor sessions and hearings (some are in the OpenLegislation repo's test resources)
  - they run on every push and before every deploy
- **Site:**
  - an Astro build check
  - a broken-link check over `dist/`
  - Playwright tests for search (including `speaker:` filtering), opening a remark link, Copy with cite text, J/K navigation and the exports
- **Quality gate:** described in section 6.6.
- **Design:** the Impeccable finish review against the mock, then DESIGN.md (section 8.1).

## 13. Verified against the live API (2026-10-15)

1. **Counts per year:** see section 10. In total there are 7,802 floor transcripts (2,297 session days and 5,505 legislative days) and 261 hearings. List calls with `summary=true` return `dayType` without the text.
2. **First session with bill details:** 2009 (28,495 bills listed). 2007 and earlier list none.
3. **Members:** `memberId`, `chamber`, `person`, `sessionShortNameMap` and `districtCode` are present; there is **no party field**. Names keep their accents ("Luis R. Sepúlveda", shortName `SEPULVEDA`).
4. **Bulk bill listing:** `/bills/{session}?full=true` includes votes, but also each bill's full text (about 34 KB per bill), so the pipeline fetches bills one at a time with `view=no_fulltext`.
5. **Paging:** offsets start at 1 (`offsetStart=1`).
6. **Still open:** Pagefind's exact-phrase behaviour on real transcripts (Plan 2), and whether GitHub Pages honours HTTP Range requests (Plan 4).
7. **Full archive (2026-10-16):** downloaded with `--parallel 16` in 12 minutes: 7,802 transcripts, 261 hearings, 30,004 bills, both chambers' members and 313 photos, about 2 GB on disk. No rate limit was hit.
8. **Members before 2009:** `/members/{session}/senate` returns 0 members for 1993–2007; senators come from `data/rosters/` for those sessions. `/members/{session}/assembly` works from 2009 (153–156 members).
9. **Special sessions:** the API files extraordinary-session bills as `S5000N` / `A4000N` (June 23, 2009: "Extraordinary Session Senate Print Number 25" is S50025). The November 2009 and 2010 special sessions' Senate bills are not in the API.
10. **Cover pages:** every floor transcript's cover names the presiding officer and the Secretary ("LT. GOVERNOR BETSY McCAUGHEY ROSS, President · STEPHEN F. SLOAN, Secretary"). `THE PRESIDENT` never appears while the Lieutenant Governor's office is vacant (one stenographer slip, June 18, 2008).
11. **Photos:** `https://legislation.nysenate.gov/static/img/business_assets/members/mini/{imgName}`, 55×71 pixels; no larger size exists. `no_image.jpg` is a placeholder.
12. **Transcript sizes:** median 2,655 characters, 99th percentile 650,000, largest 1.24 million (Environmental Conservation budget hearings). The reader must stay fast at that size (Plan 2 measures it).

## 14. Undecided (owner: user)

- the final site name, before launch. The build uses "On the Record" (decided 2026-10-16); changing it is one setting.

## 15. Setup needed from the user

All of this was done on 2026-10-16; the site went live that day at https://senaterecords.github.io/. One more organization setting was needed: deploy keys are disabled by default in new organizations and had to be enabled (Organization settings → Deploy keys).

- a GitHub account; the repo will be public. Optionally, a free GitHub organization for a clean `name.github.io` address
- a NY Senate Open Legislation API key (free sign-up at legislation.nysenate.gov). For local runs it lives in a git-ignored `.env`
- two repositories in the organization `senaterecords`: `senaterecords.github.io` (code, data, workflows) and `bills` (the bill pages)
- two repository secrets on `senaterecords.github.io`: `NYSENATE_API_KEY`, and `BILLS_DEPLOY_KEY` (the private half of a write deploy key on `bills`)
- GitHub Pages turned on for both: "GitHub Actions" as the source for `senaterecords.github.io`, the `gh-pages` branch for `bills`
- the `workflow` permission for the `gh` command line, to push the workflow files

## 16. Decision log

| Decision | Why |
|---|---|
| A pre-built static site, with no app server | free hosting that never sleeps; visitors never touch the API; nothing to babysit |
| GitHub Pages over Cloudflare Pages (and Vercel) | no file-count cap, so every transcript gets its own searchable page; 1 GB fits about 400–500 MB with room to grow; one less account. Cloudflare's 20,000-file cap would have forced grouping legislative days; Vercel's 100 MB pre-built upload limit and non-commercial terms ruled it out |
| GitHub Actions as the job runner | free and unlimited for public repos; built-in schedule and manual run button |
| Raw API data committed to the repo | reprocessing without re-downloading; history of corrected transcripts |
| Astro (static generation) + React islands + Tailwind | React and Tailwind for design flexibility; plain HTML output for speed and for Pagefind |
| Pagefind plus a query layer, with a SQLite-in-browser experiment | proven and free at launch; a measured path to more powerful search without a server |
| Exports generated in the browser | keeps the site small (no stored copy of every transcript in two more formats) |
| "Checked 12 min ago" in the bar (2026-10-16) | the build time jumped with every code change and drifted in quiet weeks; visitors want to know the site is current. Each hourly run writes its check time to a status branch (force-pushed, one commit), read from raw.githubusercontent.com, not the GitHub API, whose 60 requests an hour per network a whole office could use up; remembered 10 minutes per visitor. Hover shows when new records last arrived (sync records it; rebuilds for code don't move it) |
| speaker: finds anyone the transcripts name (2026-10-16) | people the Senate's data knows match by person; anyone else (hearing witnesses, guests) matches by the name printed on their remarks, with a note saying so. senator: stays senators only. No witness cards: the data has nothing on them beyond what each hearing prints |
| Citations name who the record shows spoke (2026-10-16) | the presiding Lieutenant Governor is named ("remarks of Lt. Gov. Delgado"), since "THE PRESIDENT" is always the Lieutenant Governor; the Secretary stays "the Secretary", since a deputy often reads and the transcript doesn't say who. A quote across several speakers puts each turn on its own line led by its speaker, and the parentheses name them all ("Sen. A and Sen. B"; past three, "and others") |
| Word and spreadsheet exports, not Markdown (2026-10-16) | the people this is for open Word documents and Excel files; few know what to do with a .md file. A .docx is a small zip of XML written in the browser, checked by opening it in Word |
| Phased scope | transcripts first; bills, laws and calendars later inside the same design |
| The Citator visual direction | chosen by the user from full-size mocks; refinements kept subtle |
| Our own 1993–2008 senator list, checked against the transcripts | the API starts in 2009; without it more than half of all floor remarks (356,000) link to nobody |
| Speaker cards for every kind of speaker, saying only what the record supports | senators (with photo, service and remarks here), Assembly members (card only), the Lieutenant Governor (by term) and the Secretary (from the cover page); approved from the mocks |
| No email on senator cards | only a third of senators have one in the API, often on the retired `senate.state.ny.us` domain; the official page link is reliable |
| Special-session bills linked only when published for the session | a wrong link is worse than none: the regular bill of the same number was being linked |
| No "unofficial" notice (2026-10-16) | the user's decision; the About page still names the source and its known gaps |
| No formal accessibility target (2026-10-16) | the user's decision; the site keeps ordinary good practice (real text, headings, labelled buttons) without auditing against WCAG |
| A page for every bill (2026-10-16) | read on the floor (about 23,000), discussed in a hearing or mentioned in passing (about 6,800): every bill link on the site opens our page. Lean pages (card plus links into transcripts, no copied text), about 120 MB in all; Plan 2 measures one session first |
| Page breaks shown as "p. 5781" (2026-10-16) | plain and compact, matching search results; star paging (`*5781`) is lawyer's shorthand |
| Citations in legal style, plain one click away (2026-10-16) | "N.Y. Senate Tr., June 10, 2025, at 5780 (remarks of Sen. Ortega)" by default; "NY Senate floor transcript, June 10, 2025, p. 5780 (Sen. Marisol Ortega)" from the same menu |
| A plain About page (2026-10-16) | what the site does, that the data comes from the Senate's Open Legislation API, that it updates itself (no promised interval; the bar shows the last check), citing by official page, and the archive's size; no list of gaps or quality percentages, which professional sites don't publish |
| Homepage search without motion (2026-10-16) | flipping examples inside the box read as typed text; three clickable examples under the box and a Search tips panel (with a pointer to its link) were clearer. Shortcut suggestions (`speaker:`, `year:`, `bill:`) match any part of a name and resolve shared surnames by choice |
| Mobile designed before building (2026-10-16) | all screens at 390 px (`mocks/src/mobile.html`): a menu button, back arrows, the senator card and citation tools as bottom sheets (phones can't hover), the reader's calendar and bill details as a bar on top with next and previous remark at the bottom, a vertical bill timeline, cards in place of tables, and filters behind one button |
| Static transcript pages with `content-visibility`, measured before considering React windowing | keeps browser find, copy, print, exact page links and indexing; measured on 2026-10-16 (largest transcript: first paint 608–1,136 ms cold, no long tasks while scrolling), so windowing was not built |
| Size cuts to fit GitHub Pages (2026-10-16) | the first full build was 1,460 MB, over the 1 GB limit. Cuts that change nothing a reader sees came first; then three small visible ones: voters on bill pages as plain names, pro forma days out of search, and pages that never needed the reader's tools without them. The result is 935.5 MB, including the bill headers added by the finish review |
| Turn markup carries each speaker key once (2026-10-16) | `<section class="turn" id="r-{i}" data-role>` with `<h3 id="w-{i}-{page}-{key}">`. The key, page and remark links (`#r-N`) work as before, with about 75 MB less markup |
| Search reads fragments itself and searches each phrase exactly (2026-10-16) | measured on the real build: Pagefind's `data()` took about 340 ms per long transcript building excerpts the site never shows, and one all-words search for several phrases ranked transcripts with the words far apart (up to 44 s, most real matches missed on the first screen). Reading fragments with native gzip and running one exact search per phrase brings `budget speaker:Krueger` from 7.9 s to under a second on the same machine. Pagefind runs on the page (not its worker) so a failed index download says search couldn't load |
| Raw data committed in full (2026-10-16) | 38,393 files, 1.8 GB on disk and about 241 MB packed in git, well within GitHub's limits (largest file 7 MB); reprocessing never needs a re-download, and corrected transcripts keep their history |
| Bills published from a branch through a deploy key (2026-10-16) | a second Pages site needs its own repository; force-pushing one orphan commit keeps that repository from growing with every publish, and a deploy key limited to that one repository is the narrowest credential that can push to it |
| Bill pages carry their own copy of the shared assets (2026-10-16) | the main site's script and style file names change with every build; bill pages pointing at their own copy can never lose their styles if one of the two publishes fails |
| Publish when the raw data or the code differs from what was last published (2026-10-16) | the new raw data is committed before the build, so "did this run download anything" would leave a transcript unpublished after a failed build until more data arrived; and GitHub keeps one waiting run per queue, so a scheduled run can cancel a waiting publish of new code. Comparing both with what was last published retries every hour instead |
| Link check in parallel worker threads (2026-10-16) | the single-threaded check took 3.5 minutes of every publish; the pages are shared out among the machine's cores with the same results |
| Changes from testing the live build (2026-10-16) | whole list rows open their link (not while selecting text) with a soft hover tint and lighter rules; page numbers in the gutter only, no rule across the text; a strip names the speaker of a long remark and opens their card; senator page tabs switch the list and stay pinned with the name; bill statuses in narrow lists sit under the title; bill timeline labels wrap with clear space; search shows shimmering placeholder rows and says what it is doing; a result opens on its passage, washed yellow for a moment, with a way back to the results; calendar rows jump to their reading (the bill page is a separate control); year lists hide pro forma legislative days until asked; speaker cards opened from the keyboard take the focus |
| A lighter homepage (2026-10-16) | approved from a before-and-after mock of the live page: one sentence under the heading ("since 1993" keeps the span of years); the records choice as a quiet grey track; the "Try" examples as plain words with dots (two on a phone, one under 360px, with Search tips on their line, so none runs off the screen); no page ranges in Latest transcripts; bill status as words in the meta line, without flags; "Checked …" once, in the bar on a computer and in the footer where the bar has no room |
| Brackets, and NOT on shortcuts (2026-10-16) | researchers type `(x OR y) AND z` from library and legal databases, and brackets had been read as plain words, silently giving other results; a NOT or minus on a shortcut was dropped, so `tolls -speaker:Krueger` found only Krueger. The query is now worked out into OR branches of ANDs (at most 16), shortcuts outside brackets still narrow the whole query as the filter list adds them, and the filter counts cover every branch |
| An API outage doesn't hold back a code change (2026-10-16) | on 2026-10-16 the Senate's API timed out for a run that carried a reader fix, and the whole run stopped, so the fix waited for the API. Now a sync the API doesn't answer (exit 4) is a warning: the run puts back anything half fetched and publishes with the records already kept; "Checked … ago" stays as it was, since nothing was checked |
| Four scheduled runs an hour (2026-10-17) | GitHub drops scheduled runs when it is busy: on launch day it started 3 of 9 hourly runs, and "Checked … ago" went three hours without a check. Four tries an hour, off the quarter hours, make a check most hours; hearings are re-listed by the first run of each New York day that gets through (the date is kept in state.json), not in a fixed morning window that dropped runs could miss |
| Words match their forms; Search tips teaches by example (2026-10-17) | every word had matched any word starting with its letters, so `sad` brought Sadie and saddle and `tax` taxis; research tools match a word's forms and offer `*` (or `!`) for the rest. The tips had become a list of rows; they now take one search apart, give the rules in three columns and end with tasks that mix them. A choice of one remark or a whole transcript is always at hand, since researchers move between the two (Westlaw's /p and &) |
| A bill search keeps to the bill (2026-10-17) | `bill:A10176` had matched every remark of a transcript that mentions the bill, so the results opened on the cover page. A bill search now keeps to the bill's reading and debate and the remarks that name it; amended versions (A10176A) count as the bill. Print numbers written compactly ("S9051B") are now read as mentions and linked; 773 such mentions were in the records, one of them an aircraft (Airbus A320) |
| Links to a remark land on its words (2026-10-17) | a bill page's "Mentioned on the floor" gave the page where the remark began and opened at the top of it: Senator Gonzalez's remark of May 12, 2026 starts on page 4324 and names S9051 on page 4328, so the reader found nothing there. Mentions now give the page the bill is named on and open on that remark with the sentence washed yellow; Read the debate washes the reading, and a senator's recent remarks wash the words their page showed, as search results do |
