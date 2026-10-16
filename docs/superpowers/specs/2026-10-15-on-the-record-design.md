# On the Record: design

**Date:** 2026-10-15
**Status:** Draft for review
**Related:**
- Product record: [PRODUCT.md](../../../PRODUCT.md)
- Visual direction mocks: [.impeccable/mocks/src/dir-citator.html](../../../.impeccable/mocks/src/dir-citator.html) (homepage, search results, reader) and [.impeccable/mocks/src/dir-citator-pages.html](../../../.impeccable/mocks/src/dir-citator-pages.html) (senator, bills list, bill, browse, about). All eight are shown in [citator-all.html](../../../.impeccable/mocks/src/citator-all.html).
- Direction contract: [.impeccable/surfaces/impeccable-mocks-src-dir-citator-html.md](../../../.impeccable/surfaces/impeccable-mocks-src-dir-citator-html.md)

## 1. Summary

On the Record (a working name) is a free public website that makes New York State Senate floor transcripts (1993 onward) and public hearing transcripts searchable at the level of **who said what**. Every remark is attributed to a speaker, can be cited to the official page, and is linked to the bill being debated.

The site is pre-built, with no server. A Python job runs hourly on GitHub Actions. It pulls new transcripts from the NY Senate Open Legislation API, parses them into speaker turns, links senators and bills, and builds an Astro site with in-browser search (Pagefind). The result is deployed to Cloudflare Pages. Running costs are $0.

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
  - Any transcript can be saved as PDF, Markdown or text.
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
GitHub Actions (hourly, at :17)
  1. sync     ask the API what changed since the last sync; download raw JSON into data/raw/
  2. process  clean → split speakers → match senators → segment bills → fetch bill details → site data
  3. build    Astro renders pages from the site data; Pagefind indexes the built pages
  4. deploy   wrangler uploads dist/ to Cloudflare Pages
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
data/overrides/           committed: manual fixes (speakers.yaml)
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
- **Bills are mentioned in recognisable patterns,** such as "Calendar Number 12, by Senator X, Senate Print 4597-A" or "Assembly Print Number 64A". These mentions often wrap across lines. **The API itself doesn't link transcripts to bills.**
- **Corrected transcripts are reissued,** and the updates endpoints report them.

## 6. Data pipeline

### 6.1 Sync
- **Backfill:** a one-time download, year by year with `limit=1000&full=true&sessionOnly=false`, plus hearings and the members list for each session. It resumes from `data/state.json` and must stay under GitHub's 6-hour job limit, so it spreads across as many runs as needed.
- **Incremental:** each hourly run calls the floor transcript updates endpoint since the last sync and re-downloads anything changed. Public hearings are refreshed by re-listing the current year once a day, because the shape of the hearing updates endpoint's items isn't verified. When an already-stored record's text changes, the date is written to `data/corrections.json`.
- **Raw storage:**
  - `data/raw/transcripts/{year}/{dateTime}__{sessionType-slug}.json`
  - `data/raw/hearings/{year}/{hearing-key}.json`, where the key is the id when it is under 1000 and the filename otherwise
  - `data/raw/members/{session}.json`
  - `data/raw/bills/{session}/{printNo}.json`

### 6.2 Clean
- **Layout detection:** detect each file's layout from its content (not its date), then strip page numbers (including vendor "Page N" headers), line numbers, spacer lines and form feeds. Running headers and vendor footers are also stripped: these are text repeated in the first or last two lines of at least 30% of pages.
- **Line joining:** rejoin wrapped lines into paragraphs.
- **Page map:** build a map from character offsets to official page numbers, so every turn knows the page or pages it starts and ends on.

### 6.3 Speaker turns
- **Splitting:** split the text on speaker labels. A label can stand alone on its line; hearing labels can wrap across lines.
- **Roles:** each turn gets a role: `senator`, `presiding` (for example Acting President), `secretary`, `guest` or `witness`.
- **Turn fields:** `{ index, label, role, senatorId?, text, pageStart, pageEnd, bills[] }`. The cleaned text is never reworded.
- **Fallback:** when a transcript can't be split reliably, it is published as cleaned text without turns and flagged in the quality report. "Reliably" means at least 80% of its characters fall inside recognised speaker turns; the threshold can be tuned.

### 6.4 Senator matching
- **Session year:** the odd year on or before the transcript date.
- **Matching:** `SENATOR X` is matched to that session's members by short name. Where two senators share a surname, the transcript uses the full label (e.g. "ADA SMITH"). `ACTING PRESIDENT X` maps to senator X in the presiding role. `THE PRESIDENT` (the Lieutenant Governor) and `THE SECRETARY` are not senators.
- **Stable identity:** each senator needs an id that stays the same across sessions, taken from the members endpoint. Which field provides it needs confirming with a key (section 13).
- **Fixes:** labels that can't be matched go into the quality report and can be fixed in `data/overrides/speakers.yaml` without changing code.

### 6.5 Bills and debates
- **Mentions:** after cleaning, extract bill mentions and normalise them to `{session, printNo}` (e.g. `S4597A`).
- **Calendar segments:** in floor transcripts, a segment starts with each `THE SECRETARY: Calendar Number N, by Senator X, Senate Print Y` and ends at the next calendar item or at the end of the day.
- **Debated or not:** a segment is **debated** if it contains at least one turn by a senator who is not presiding. Otherwise it is marked "no debate".
- **Bill details:** sponsor, title, status, milestones and floor votes are fetched once per bill and cached. The pipeline will use the bulk bill listing (`/bills/{session}` with `full=true`) if it exists, and otherwise one request per bill with a resumable per-run budget. Bill data is believed to start around 2009, which is to be confirmed (section 13). Earlier bills show their print number without a detail card.

### 6.6 Quality report and gate
- **The report covers:**
  - the share of text attributed to speakers
  - unmatched labels
  - unlinked bill mentions
  - transcripts that fell back to plain text
  - counts per year
- **Where it goes:** it is written each run as a build artifact, and a summary is published on the About page.
- **The gate:** deployment is blocked if attribution or bill linking drops by more than 2 percentage points from the last deployed build. The threshold can be tuned.

## 7. Site data contract (`data/site/`)

| File | Contents |
|---|---|
| `meta.json` | last updated time, counts, quality summary |
| `transcripts/{slug}.json` | metadata (type, date, session type, location, pages, committees) plus `turns[]`, `segments[]` (calendar no., bill, debated, outcome, votes, turn range), `plainText` (fallback flag) and `corrected` (date or null) |
| `senators.json` | every senator: id, slug, name, party/district per session, sessions served |
| `senators/{slug}.json` | appearances (transcript, turn count, first page), bills debated (sponsored or spoke), totals |
| `bills/{session}.json` | every bill mentioned that session: card fields and the debate segments that reference it |
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
  - Official page breaks show inline (`*5781` with a dashed rule). The page where a turn starts appears in the gutter.
- **Constraints recorded from user feedback:**
  - no multicolor speaker identity system
  - no dark masthead
  - no boxed-card restyle
  - refinements stay subtle
- **Closing steps:** the front-end build ends with an Impeccable finish review against the mock and the direction contract. A DESIGN.md is then recorded from the built site.

### 8.2 Pages

| Route | Content |
|---|---|
| `/` | search, latest transcripts, most-debated bills this session |
| `/search?q=…` | results in fixed columns (date · speaker and quote · page, status, cite); facets for record type, senator, bill, session/year, committee; sort by relevance, newest or oldest; export results |
| `/transcripts/{slug}/` | the reader: calendar rail (floor) or speaker list (hearings); the text with remark anchors `#r-{index}` and page anchors `#p{page}`; the bill headnote; find in transcript; export; J/K to move between remarks |
| `/senators/` and `/senators/{slug}/` | A–Z index; senator page with sessions, appearances, bills debated, and search limited to their remarks |
| `/bills/` and `/bills/{session}/` | the Bills list: every bill read on the floor in a session (session picker, defaulting to the current one). It has a search box (number, title, sponsor), an All / Debated / No debate filter, and sorting by most debated, newest or number. Columns: bill · title and sponsor · floor debate (remarks, senators) · status · last floor date. |
| `/bills/{session}/?id={printNo}` | the bill page: header (number, status, title, sponsor, committee, Assembly companion) and a milestone line from Introduced to Governor. **The floor debate** is the main block: date line, a plain outcome ("Debated and passed, 41–20"), an excerpt and Read the debate. **Earlier on the floor** lists other appearances in plain words (for example "Brought up, then held for another day at the sponsor's request. No vote."). A side panel shows the floor vote and who spoke. It is one page per session that loads `bills/{session}.json`, which keeps the file count down. |
| `/browse/{year}/` | transcripts by year |
| `/about/` | data source, last updated, quality summary, known gaps |

**Copy with cite** produces:
- floor: `N.Y. Senate Tr., June 10, 2025, at 5780 (remarks of Sen. Ortega)`, or `at 5780–81` when the quote spans two pages
- hearings: `N.Y. Senate Pub. Hr'g Tr., {title}, Mar. 18, 2025, at 112 (remarks of Sen. Okafor)`

The format is to be confirmed with users. **Export** is generated in the browser when clicked. Markdown and text are built from the page content; PDF uses a print stylesheet and the browser's "Save as PDF". No export files are stored, which protects the file budget.

## 9. Search

### 9.1 Launch: Pagefind plus a query layer
- **Indexing:**
  - Each transcript page is one Pagefind page.
  - Every turn is wrapped as a heading with an id (styled as the inline speaker label), so Pagefind returns **sub-results per remark** with scoped excerpts and direct links.
- **Filters on each page:** `type`, `year`, `session`, `senator` (several values: everyone who spoke), `bill` (several values), `committee`.
- **Sorting:** by `date`.
- **Instant suggestions:** as you type, small JSON lists (`senators.json` and a bill index) offer "Senator Marisol Ortega" or "S4597-A" directly.
- **The query layer (our code in the browser):**
  - parses `"exact phrase"`, `OR`, `-term`, `speaker:`, `bill:`, `year:` and `type:`
  - turns field prefixes into Pagefind filters
  - runs one Pagefind search per OR branch and merges the results
  - removes remarks that contain any `-term`
  - **keeps only the named speaker's own remarks** when `speaker:` is used, by checking each sub-result's speaker heading
  - supports "near" by checking remark text
  - suggests "Did you mean…" from the `words/` vocabulary when a search returns nothing
- **Known limits:**
  - no automatic typo correction (only the suggestion)
  - filters work at the transcript level before the query layer narrows the results, so totals are shown per transcript first
  - aggregate questions ("who talked most about X") are answered by counts the pipeline calculates ahead of time, not by search

### 9.2 Early experiment: SQLite in the browser
- **The idea:** build a SQLite database with an FTS5 full-text index and one row per remark (`transcript`, `turn`, `speaker`, `date`, `bills`, `text`). Host it as static files, split into chunks under 25 MB. The browser queries it over HTTP range requests (for example with `sql.js-httpvfs` or an HTTP VFS for the official SQLite WASM build).
- **What it would add:** true remark-level filters, OR/NOT/NEAR, ranking, and counts.
- **The test:**
  - Check that the host honours HTTP Range requests.
  - Run 30 representative queries (rare term, common term, phrase, speaker filter, OR/NOT) on the full real corpus.
- **Adoption rule:** adopt it as "Advanced search", or as the main engine, if p95 latency is under 3 s and the download per query is under 5 MB on a typical broadband connection. Otherwise drop it. These thresholds are proposed and can be changed.

## 10. Hosting, schedule and file budget

- **Hosting:** Cloudflare Pages free plan. It has unlimited bandwidth and requests, but caps a site at **20,000 files** and 25 MiB per file. Uploads happen from GitHub Actions through `wrangler pages deploy`, and Cloudflare keeps the previous version if an upload fails.
- **Schedule:**
  - GitHub Actions cron `17 * * * *` (an odd minute, to avoid top-of-the-hour delays)
  - a `workflow_dispatch` "Update now" button
  - the repo is public, which makes run time free and unlimited
- **Keep-alive:** a weekly commit of `data/state.json` (last checked) prevents GitHub from disabling the schedule after 60 days with no activity.
- **File budget, estimated until real counts are in:**

| Item | Files |
|---|---|
| Floor transcripts | about 4,000–5,500 |
| Hearings | about 1,000–2,000 |
| Senator pages | about 300 |
| Pagefind index | about 6,000–8,000 |
| Site data and assets | a few hundred |
| Vocabulary prefixes | under 1,000 |
| **Total** | **about 12,000–17,000** |

- **Guardrails:**
  - A warning at 18,000 files.
  - The build refuses to deploy above 19,500.
- **Fallbacks:**
  - Group pro forma legislative days by month and exclude them from the index.
  - Start the archive from a later year.
  - Move to GitHub Pages, which has no file cap but a 1 GB size cap.

## 11. Error handling

| Situation | Behaviour |
|---|---|
| API down, slow or returning 5xx | retry with backoff, then end the run without deploying; the live site stays on the last good version and shows "Updated N hours ago"; GitHub emails the owner on failed runs |
| API key rejected (401) | the run fails with the message "NY Senate API key rejected"; fix it by updating the `NYSENATE_API_KEY` secret |
| A transcript can't be split into speakers | publish it as cleaned plain text with the note "Speaker details aren't available for this transcript"; list it in the quality report |
| Quality drops after a parser change | tests and the quality gate block the deploy |
| A transcript is corrected | re-sync it, show the "Corrected transcript" flag, keep the old raw version in git history; a remark link that no longer exists lands at the top of the transcript with a notice |
| File count reaches 18,000 or 19,500 | warn, then refuse to deploy |
| Upload fails | Cloudflare keeps serving the previous version |
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
  - Playwright tests for search (including `speaker:` filtering), opening a remark link, Copy with cite text, J/K navigation and Markdown export
- **Quality gate:** described in section 6.6.
- **Design:** the Impeccable finish review against the mock, then DESIGN.md (section 8.1).

## 13. To verify once the API key arrives

1. Real counts per year for transcripts, hearings and legislative days. These confirm the file budget.
2. The first session year with bill details in the API.
3. The fields in the members endpoint. The source code (OpenLegislation `MemberView`/`FullMemberView`) shows `memberId` (stable across sessions), `districtCode` and `sessionShortNameMap`, and **no party field**. The site therefore shows district only unless party comes from another source. Confirm this with a live key.
4. Whether a bulk bill listing with `full=true` exists.
5. Pagefind's exact-phrase behaviour on real transcripts.
6. Whether Cloudflare Pages honours HTTP Range requests (needed for the 9.2 experiment).

## 14. Undecided (owner: user)

- the final site name ("On the Record" is the working name)
- whether and how to state that the site is unofficial and independent of the NY Senate
- whether to adopt a formal accessibility target, such as WCAG 2.2 AA
- the page-break label: keep the citator style `*5781`, or use the plainer "Page 5781"
- the exact citation format

## 15. Setup needed from the user

- a GitHub account; the repo will be public
- a Cloudflare account with a Pages project, plus an API token that can deploy to Pages
- a NY Senate Open Legislation API key (free sign-up at legislation.nysenate.gov)
- these GitHub repository secrets: `NYSENATE_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

## 16. Decision log

| Decision | Why |
|---|---|
| A pre-built static site, with no app server | free hosting that never sleeps; visitors never touch the API; nothing to babysit |
| Cloudflare Pages over Vercel | unlimited bandwidth and requests, commercial use allowed, and no 100 MB pre-built upload limit |
| GitHub Actions as the job runner | free and unlimited for public repos; built-in schedule and manual run button |
| Raw API data committed to the repo | reprocessing without re-downloading; history of corrected transcripts |
| Astro (static generation) + React islands + Tailwind | React and Tailwind for design flexibility; plain HTML output for speed and for Pagefind |
| Pagefind plus a query layer, with a SQLite-in-browser experiment | proven and free at launch; a measured path to more powerful search without a server |
| Exports generated in the browser | protects the 20,000-file budget |
| Phased scope | transcripts first; bills, laws and calendars later inside the same design |
| The Citator visual direction | chosen by the user from full-size mocks; refinements kept subtle |
