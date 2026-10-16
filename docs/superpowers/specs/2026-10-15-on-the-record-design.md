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
- **Mentions:** after cleaning, extract bill mentions from floor transcripts and hearings and normalise them to `{session, printNo}` (e.g. `S4597A`).
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
| `bills/{session}.json` | every bill mentioned that session: card fields, the debate segments that reference it (with `debateEnd`), and `mentionedIn` (every transcript that mentions it) |
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
- **Shortcut suggestions:** typing a shortcut opens a suggestion list. `speaker:` lists senators (photo, district, years served, remarks), then Assembly members who speak in hearings. Any part of the name matches (first, middle, last, either half of a double-barrelled name), ignoring case, accents and apostrophes, with the matched letters in bold. A shared surname lists every holder with their years, so the user picks instead of the search guessing; a `speaker:` left ambiguous on Enter asks "Which Smith?". `year:` lists years with transcript counts, `bill:` lists bills from a bill index split by print-number prefix (a small new pipeline output), `type:` lists floor sessions and hearings, and a partial shortcut ("sp") suggests the shortcut itself. Arrow keys, Enter and Esc work. Nicknames outside the official name need an alias list if they come up.
- **The query layer (our code in the browser):**
  - parses `"exact phrase"`, `AND` (also the default between words), `OR`, `NOT` or `-term`, `NEAR` (within a few words, checked in the remark text), `speaker:`, `bill:`, `year:` (one year or a range such as `2015-2019`), `type:` (`floor` or `hearing`) and `committee:`; the Search tips panel lists them in two groups, "Words" and "Narrow it down". On the homepage, three example searches sit under the box (click to fill it in; hover shows what each finds) beside a "Search tips" link that opens a panel listing every option with an example and a plain description, ending with a mixed example. No motion
  - turns field prefixes into Pagefind filters
  - runs one Pagefind search per OR branch and merges the results
  - removes remarks that contain any `-term`
  - supports several exact phrases in one search (`"congestion pricing" "toll revenue"`: remarks containing both; with `OR`, either) by searching for all their words, then checking each remark's text for every phrase; Plan 2 tests this on the real archive
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
  - Check that GitHub Pages honours HTTP Range requests (a well-known sql.js-httpvfs demo is hosted there).
  - Run 30 representative queries (rare term, common term, phrase, speaker filter, OR/NOT) on the full real corpus.
- **Adoption rule:** adopt it as "Advanced search", or as the main engine, if p95 latency is under 3 s and the download per query is under 5 MB on a typical broadband connection. Otherwise drop it. These thresholds are proposed and can be changed.

## 10. Hosting, schedule and size budget

- **Hosting:** GitHub Pages, chosen by the user on 2026-10-15 over Cloudflare Pages. Live counts showed Cloudflare's 20,000-file cap would be exceeded unless legislative days were grouped and left out of search.
  - **Limits:** no file-count cap; the published site may be up to **1 GB**; bandwidth has a **soft limit of 100 GB/month**.
  - **Publishing:** the hourly workflow publishes with GitHub's own Pages action. If publishing fails, the previous version stays live.
  - **Address:** `owner.github.io/repo`, or a clean `name.github.io` by creating a free GitHub organization and naming the site repository `name.github.io`. A custom domain can be added later.
- **Schedule:**
  - GitHub Actions cron `17 * * * *` (an odd minute, to avoid top-of-the-hour delays)
  - a `workflow_dispatch` "Update now" button
  - the repo is public, which makes run time free and unlimited
- **Keep-alive:** a weekly commit of `data/state.json` (last checked) prevents GitHub from disabling the schedule after 60 days with no activity.
- **Corpus, counted from the live API on 2026-10-15:**

| Record | Count | Years |
|---|---|---|
| Floor session days | 2,297 | 1993–2026 |
| Pro forma legislative days | 5,505 | mostly 1993–2023 (almost none listed after 2023) |
| Public hearings | 261 | 2011–2026 (none in the API before 2011) |

- **Size budget (estimated; measure with the first full build):** every transcript gets its own searchable page, legislative days included. Transcript text is about 200 MB; with page markup and the Pagefind index the site comes to roughly 400–500 MB, about half the 1 GB cap. Growth is roughly 85 transcripts and hearings a year, about 5–10 MB.
- **Guardrails:**
  - A warning when the built site passes 800 MB.
  - The build refuses to publish above 950 MB.
- **Fallbacks:**
  - Group pro forma legislative days by month and keep them out of the index.
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
  - Playwright tests for search (including `speaker:` filtering), opening a remark link, Copy with cite text, J/K navigation and Markdown export
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

- a GitHub account; the repo will be public. Optionally, a free GitHub organization for a clean `name.github.io` address
- a NY Senate Open Legislation API key (free sign-up at legislation.nysenate.gov). For local runs it lives in a git-ignored `.env`
- one GitHub repository secret: `NYSENATE_API_KEY`
- GitHub Pages turned on for the repository, with "GitHub Actions" as its source

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
| A plain About page (2026-10-16) | what the site does, that the data comes from the Senate's Open Legislation API, hourly updates, citing by official page, and the archive's size; no list of gaps or quality percentages, which professional sites don't publish |
| Homepage search without motion (2026-10-16) | flipping examples inside the box read as typed text; three clickable examples under the box and a Search tips panel (with a pointer to its link) were clearer. Shortcut suggestions (`speaker:`, `year:`, `bill:`) match any part of a name and resolve shared surnames by choice |
| Mobile designed before building (2026-10-16) | all screens at 390 px (`mocks/src/mobile.html`): a menu button, back arrows, the senator card and citation tools as bottom sheets (phones can't hover), the reader's calendar and bill details as a bar on top with next and previous remark at the bottom, a vertical bill timeline, cards in place of tables, and filters behind one button |
| Static transcript pages with `content-visibility`, measured before considering React windowing | keeps browser find, copy, print, exact page links and indexing; Plan 2 measures the largest transcript first |
