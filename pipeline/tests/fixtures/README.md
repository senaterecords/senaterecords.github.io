# Test fixtures

`text/` holds real NY Senate transcripts, used to test the parser against each era's layout. They are copied unchanged from the test resources of the NY Senate's own OpenLegislation project, commit `f672f9c33073ae9a133708964239748eaf909e5a`. The transcripts are public records.

| File | Source path | Why it's here |
|---|---|---|
| `floor-1993-03-10.txt` | `transcriptFiles/forPdfParser/1993-03-10T1210` | 1993–98 layout: left-aligned page numbers, deep indents |
| `floor-1998-03-10.txt` | `transcriptFiles/forPdfParser/1998-03-10T1510` | a full floor calendar with bills, votes and "lay it aside" |
| `floor-2000-01-05.txt` | `transcriptFiles/forPdfParser/2000-01-05T1210` | 1999–2004 layout: no line numbers |
| `floor-2020-01-01.txt` | `transcriptFiles/forPdfParser/2020-01-01T1100` | a modern pro forma legislative day |
| `hearing-2011-05-18.txt` | `hearingTranscripts/05-18-11 Valesky Aging Test.txt` | a public hearing with front-matter labels and witnesses |
| `hearing-2020-08-25-vendor.txt` | `hearingTranscripts/8-25-20 MTA Transcript Test.txt` | a vendor-produced hearing with "Page N" headers, running headers, footers and long witness titles |

These three come from the live Open Legislation API (`text` of `/api/3/transcripts/{dateTime}`), downloaded on 2026-10-15 and saved unchanged:

| File | Transcript | Why it's here |
|---|---|---|
| `floor-2025-01-13.txt` | 2025-01-13T15:16 Regular Session | the modern reading order: "Calendar Number 1, Senate Print 88, by Senator Gianaris" |
| `floor-2025-04-10.txt` | 2025-04-10T11:17 Regular Session | a presiding officer's line that opens 22 of 23 pages, which must not be mistaken for a header |
| `floor-2025-05-15.txt` | 2025-05-15T11:47 Regular Session | an accented speaker label (SENATOR SEPÚLVEDA) |
