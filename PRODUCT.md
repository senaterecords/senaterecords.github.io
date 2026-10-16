# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (static site generation) with React components only where interactivity is needed, styled with Tailwind CSS. A Python pipeline produces the data the site is built from. Search runs in the browser via Pagefind. GitHub Actions rebuilds the site hourly, and it is hosted on the Cloudflare Pages free plan. Confirmed by the user during brainstorming on 2026-10-15.

## Users

The primary users are New York State Senate and legislative employees, plus researchers. They work with legislative material regularly, so they are domain experts, but they are not necessarily technical. Everything must work through the interface, with no command line.

Their jobs:
- find what was said on the floor or in a hearing, by whom, and about which bill
- pull quotes with page references they can cite
- follow a senator's remarks across sessions
- follow a bill's debate
- read and save transcripts

## Product Purpose

Make every NY Senate floor session transcript and public hearing transcript (1993 to the present) searchable and navigable at the level of who said what.

Success looks like this:
- A user types a phrase and within seconds sees who said it, when, and the surrounding text.
- One click shows all of a senator's remarks.
- One click shows a bill's debate alongside its sponsor, status and floor vote.
- Anything can be saved as PDF, Markdown or plain text.
- The site stays current with no manual work and costs $0 a month to run.

## Positioning

The official Open Legislation site serves each transcript as one undivided block of text and does not link transcripts to bills. On the Record adds four things the source lacks:
- it splits each transcript into speaker turns
- it matches speakers to senators
- it divides the floor calendar into a separate debate for each bill
- it links each debate to the bill's record

Together these make possible speaker-level search and bill-debate views that the official site does not offer.

## Operating Context

- **Data source:** the NY Senate Open Legislation API v3 (legislation.nysenate.gov), which needs a free API key. It covers the Senate only; Assembly transcripts are not available.
- **Coverage:** floor transcripts since 1993, plus public hearings. Transcripts are sometimes corrected and reissued.
- **Citations:** transcripts carry official page numbers, and citations use them, for example "Senate transcript, Mar 12 2025, p. 5781".
- **Device (inferred, unconfirmed):** use is mainly at work on a desktop, alongside memos and other documents. Mobile is secondary.

## Capabilities and Constraints

**Phase 1 features:**
- Full-text search across transcripts, with filters for floor session or hearing, year, senator and committee.
- A transcript reader with speaker turns and official page numbers.
- Senator pages.
- Bill cards and debate views for bills discussed on the floor.
- Export to PDF (through a print layout), Markdown and plain text.

**Later phases:** full bill search, laws and calendars. The navigation reserves room for them from the start.

**Constraints:**
- The site is pre-built and static. There is no server, so phase 1 has no user accounts and no email alerts. Personal watchlists may live in browser storage.
- Data updates hourly, and the site shows when it was last updated.
- The Cloudflare free plan caps a site at 20,000 files.
- Bill details in the API likely start around 2009 (unverified). Older debates show the bill number without a full card.

**Terminology:**
- floor session (Regular Session, Extraordinary Session)
- legislative day (a pro forma day)
- public hearing
- Senate Print, or print number (e.g. S4597-A)
- calendar number
- sponsor
- floor vote (ayes and nays)
- presiding officer (Acting President)
- Secretary

**Undecided:** whether to adopt an accessibility standard, and whether and how the site states that it is unofficial. The user chose to decide both later.

## Brand Commitments

"On the Record" is the working name. It is a placeholder and may change before launch. No logo, voice or visual identity exists yet.

## Evidence on Hand

None yet. No real data has been pulled (the API key is pending), so there are no counts, users, testimonials or press. All numbers, names and quotes in mockups are placeholders and must never be presented as real.

## Product Principles

1. **Who said what, citable.** Every quote traces back to a speaker, a date and an official page.
2. **Fast to the answer.** Search is the front door, and results lead with the words actually spoken.
3. **Faithful to the record.** Parsing adds structure but never alters the text. Low-confidence parses are flagged, not hidden.
4. **Zero setup.** Nothing to install, no accounts, no terminal.
5. **Built to grow.** Bills, laws and calendars join the same structure later without a redesign.
