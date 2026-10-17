# On the Record

A free website of New York State Senate floor transcripts (1993 on) and public hearings (2011 on). You can search them by who said what, cite them to the official page, and follow the bills that were debated.

- **Site:** https://senaterecords.github.io/
- **Bill pages:** https://senaterecords.github.io/bills/

It runs entirely on free GitHub services. There is no server, no database and nothing to pay for.

## How it stays up to date

Four times an hour (at 7, 22, 37 and 52 minutes past; GitHub skips scheduled runs when it is busy, so this makes sure at least one runs most hours), the **Update** workflow (`.github/workflows/update.yml`) does the following:

1. **Sync.** It asks the Senate's Open Legislation API for transcripts added or corrected since the last run, plus current senators and pending bills. Once a day (the first run of the New York day that gets through) it also re-lists this year's and last year's hearings. New data is committed to `data/raw/` straight away.
2. **Decide.** If the raw data and the code that builds the site both match what was last published, the run ends here, usually in a few minutes. Otherwise it goes on. A publish that failed earlier, or was cancelled by a newer run, is therefore tried again the next hour, and a code change pushed to `main` is published even if no new data arrives.
3. **Process.** It splits transcripts into speakers, matches senators and links bills (`pipeline/`). The **quality gate** stops the run if speaker attribution or bill links drop more than 2 points below the last published version, or if there are fewer transcripts.
4. **Build and check.** It builds the site (`site/`), then refuses to publish if either site is over 950 MB or if any internal link is broken.
5. **Publish.** The bill pages go first, as one fresh commit force-pushed to the `gh-pages` branch of the [`bills`](https://github.com/senaterecords/bills) repository. Then the main site goes out through GitHub Pages.
6. **Check live.** It fetches the homepage, search, a transcript, the bills index, a bill page and that page's stylesheet from the live address. Only then does it record what was published (`data/quality-deployed.json`, `data/deployed-raw.txt`, `data/deployed-code.txt`).

Every run also writes the time of its check to the `status` branch (one small file, replaced each time). The site's bar reads it to say "Checked 12 min ago", and hovering shows when new records last arrived. If that file can't be reached, the bar says "Updated …" with the time new records last arrived.

If any step fails, nothing more is published, and the live site keeps its last good version. GitHub emails the repository owner about failed runs.

Only one run happens at a time; a manual run waits for a scheduled one to finish. In quiet weeks, a small weekly commit (`data/last-checked.txt`) keeps GitHub from switching the schedule off, which it does after 60 days without activity.

### Update now

To update without waiting, go to **Actions → Update → Run workflow**. Tick **Rebuild** to rebuild and publish even when no new data has arrived, for example after a code change.

## When a run fails

Open the failed run under **Actions** and find the first red step.

| Failed step | What it means | What to do |
|---|---|---|
| Sync, "NY Senate API key rejected" (exit 3) | The key expired or was revoked | Get a new key at legislation.nysenate.gov and update the `NYSENATE_API_KEY` secret (see below) |
| Sync, "NY Senate API did not answer" (a yellow warning, not a failure) | The Senate's API is down or slow | Nothing. The run still publishes any change to the code, with the records already kept, and leaves "Checked … ago" alone; the next hourly run tries the API again. |
| Process, quality gate (exit 5) | A change to the pipeline made speaker attribution or bill links worse | Compare the run's `quality.json` (in the run's artifacts) with `data/quality-deployed.json`, then fix the pipeline. The site stays on the last good version until then, and the run fails each hour. |
| Build, check and split: size | One of the two sites passed 950 MB | See the fallbacks in section 10 of the design spec |
| Build, check and split: links | The check prints each broken link and the page it is on | Fix the page template or data that makes the link |
| Publish the bills site | The deploy key was removed or the `bills` repository changed | Check the `BILLS_DEPLOY_KEY` secret and the key under `bills` → Settings → Deploy keys |
| Check the live site | GitHub Pages hadn't caught up after five minutes, or a page is really missing | Open the addresses it printed. If they work now, run the workflow again. |

## The two repositories

- **`senaterecords/senaterecords.github.io`** (this one) holds the code, the raw data and the workflows. Its Pages source is "GitHub Actions".
- **`senaterecords/bills`** holds only the built bill pages, on its `gh-pages` branch, which the workflow replaces on every publish. Don't edit it by hand. Its Pages source is the `gh-pages` branch.

The bill pages carry their own copy of the site's styles, scripts, fonts and icons. If one site publishes and the other doesn't, both still look right.

## Secrets

Both secrets live in this repository under **Settings → Secrets and variables → Actions**.

- **`NYSENATE_API_KEY`**: the Open Legislation API key. To replace it, get a new key at legislation.nysenate.gov and paste it into the secret.
- **`BILLS_DEPLOY_KEY`**: the private half of an SSH key that may write to the `bills` repository. To replace it:
  1. Run `ssh-keygen -t ed25519 -N "" -C "senaterecords bills publish" -f bills_deploy`.
  2. Add `bills_deploy.pub` to `bills` → Settings → Deploy keys, with **Allow write access** ticked, and delete the old key there.
  3. Paste the contents of `bills_deploy` into the secret, then delete both files.

## Running it locally

You need Python 3.11 or newer, Node 22 and a free API key from legislation.nysenate.gov. The pipeline reads the key from the `NYSENATE_API_KEY` environment variable. Keep it in the git-ignored `.env` file at the repository root and never commit it.

```bash
# The pipeline (see pipeline/README.md for every command)
cd pipeline && python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
python -m pip install -e ".[dev]" && cd ..
python -m nyleg --data data sync          # with NYSENATE_API_KEY set
python -m nyleg --data data process       # writes data/site/

# The site
cd site && npm ci
npm run build                              # builds dist/ from ../data/site (about 8 to 11 minutes for the full archive)
npm run check                              # size and links
npm run preview                            # http://127.0.0.1:4329/
```

**Tests:**
- `pytest` in `pipeline/`
- `npx vitest run` in `site/`
- `npx playwright test` in `site/` (end-to-end, against a small committed sample of the data)

They run on every push (`.github/workflows/test.yml`).

## Where things are

- `pipeline/`: the Python data pipeline (`nyleg`).
- `site/`: the Astro website and its build, check and split scripts.
- `data/raw/`, `data/state.json`: API responses and sync progress, committed by the hourly run.
- `data/rosters/`, `data/overrides/`: hand-kept senator lists for 1993–2008 and speaker fixes.
- `data/site/`: generated by `process`; not committed.
- `docs/superpowers/specs/2026-10-15-on-the-record-design.md`: the design spec, including the decision log. `DESIGN.md` covers the visual design.
