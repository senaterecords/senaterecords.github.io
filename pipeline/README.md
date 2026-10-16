# nyleg: the On the Record data pipeline

This pipeline downloads NY Senate floor and public-hearing transcripts from the Open Legislation API. It splits each transcript into speaker turns, matches speakers to senators, links the bills debated on the floor, and writes the data files the website is built from (`data/site/`).

## Setup

```bash
cd pipeline
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
python -m pip install -e ".[dev]"
python -m pytest
```

## Commands

Run these from the repository root, so that `data/` is found. A free API key from legislation.nysenate.gov goes in the `NYSENATE_API_KEY` environment variable.

| Command | What it does |
|---|---|
| `python -m nyleg smoke` | Prints the shape of every API response the pipeline depends on |
| `python -m nyleg sync --backfill 2025` | Downloads whole years. It can be resumed, so re-run it after an interruption. |
| `python -m nyleg sync --rescan-bills` | Looks for bill mentions in every stored transcript and fetches the bill details |
| `python -m nyleg sync` | The hourly run: transcripts added or corrected since the last run, current senators, and pending bills. Add `--hearings` to re-list this year's hearings. |
| `python -m nyleg process` | Rebuilds `data/site/` and writes `data/site/quality.json` |
| `python -m nyleg process --gate-against data/quality.json` | The same, but exits 5 if quality dropped more than 2 points |

`sync` prints `changed=true` or `changed=false` and also writes it to `$GITHUB_OUTPUT` when that variable is set.

**Exit codes:**
- 0: OK
- 3: API key missing or rejected
- 4: API unavailable
- 5: quality gate failed

## Where things live

- `data/raw/`: API responses exactly as received. These are committed.
- `data/state.json`: sync progress. Committed.
- `data/overrides/speakers.yaml`: manual speaker fixes. Committed.
- `data/site/`: generated output. Not committed.
