# Plan 3: Automation and Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish On the Record at `senaterecords.github.io` (bills at `/bills/`) and keep it current with an hourly GitHub Actions job that syncs the NY Senate API, rebuilds, checks and publishes, at $0.

**Architecture:** One public repository, `senaterecords/senaterecords.github.io`, holds the code, the committed raw data and the workflows; its Pages site (built by GitHub Actions) is the main site. A second public repository, `senaterecords/bills`, is served at `/bills/` on the same address from a `gh-pages` branch that the hourly job force-pushes as one orphan commit through an SSH deploy key. The bills output carries its own copy of the shared assets, so bill pages never depend on the main site's current file names.

**Tech Stack:** GitHub Actions (ubuntu-latest), `actions/checkout`, `actions/setup-python`, `actions/setup-node`, `actions/upload-pages-artifact`, `actions/deploy-pages`, the existing `nyleg` pipeline (Python 3.13) and `site/` (Node 22, Astro, Pagefind), `gh` CLI for setup.

**Spec:** `docs/superpowers/specs/2026-10-15-on-the-record-design.md` (sections 4, 6.1, 6.6, 10, 11, 15).

## Global Constraints

- Cost: $0. Both repositories public (free Actions minutes, free Pages).
- Address: `https://senaterecords.github.io/`; bills at `https://senaterecords.github.io/bills/`. Site base stays `/`.
- Schedule: cron `17 * * * *` plus a `workflow_dispatch` "Update now" button (spec 10).
- Raw API responses are committed (`data/raw/`, `data/state.json`); `data/site/`, `site/dist/` and split output are never committed (spec 4).
- The API key exists only in `.env` locally and in the repository secret `NYSENATE_API_KEY`. Never print, echo or log it.
- Publishing is blocked by: a failed sync, the quality gate (attribution or bill links down more than 2 points, or fewer transcripts), a site over 950 MB (each site separately), or any broken internal link (spec 6.6, 10, 11).
- If publishing fails, the previous version stays live (spec 10, 11).
- Every outward step (creating repositories, pushing, secrets, Pages settings, deploy keys) is shown to the user and confirmed before it runs.
- No AI attribution in commits or anywhere in the repository.
- The NY Senate API is a free public service: the hourly job keeps the pipeline's default 1 request/second.

## Review Focus

1. **One of the two deploys fails** (main deployed, bills push rejected, or the reverse): bill pages must still render fully styled and every cross-site link must keep working. Task 1's self-contained bills output and its test cover the styles; the link check covers links.
2. **The API is down or the key is rejected:** the run fails visibly (GitHub emails the owner), nothing is published, and the live site keeps its last good version. Task 4's workflow must not publish after a failed sync.
3. **Two runs overlap** (a manual run during a scheduled one) or main moves during a run: runs queue instead of racing, and the data commit rebases and retries instead of failing or overwriting.
4. **Quality drops after a code change:** the gate blocks the deploy, and the baseline moves only after a successful deploy.
5. **Quiet months** (summer and autumn, few new transcripts): GitHub disables a scheduled workflow after 60 days without repository activity, so a weekly keep-alive commit keeps it alive.

## File map

- Create `site/scripts/split-sites.mjs`: split `site/dist/` into `out/main` and a self-contained `out/bills`.
- Modify `site/scripts/check-links.mjs`: check pages in parallel worker threads (same results).
- Create `site/scripts/check-live.mjs`: after a deploy, fetch key pages and assets from the live address.
- Create `scripts/publish-bills.sh`: force-push the bills output as one orphan commit to `senaterecords/bills` `gh-pages`.
- Create `scripts/commit-data.sh`: commit changed data back to `main`, rebasing and retrying.
- Create `.github/workflows/test.yml` and `.github/workflows/update.yml`.
- Create `README.md` (maintainers).
- Modify the spec (decision log, sections 10 and 15).
- Tests: `site/tests/unit/split.test.ts`, `site/tests/unit/links.test.ts` (extended), `site/tests/unit/live.test.ts`.

---

### Task 1: Split the build into the main site and a self-contained bills site

**Files:**
- Create: `site/scripts/split-sites.mjs`
- Create: `site/tests/unit/split.test.ts`
- Modify: `site/package.json` (script `"split": "node scripts/split-sites.mjs dist ../out"`)

**Interfaces:**
- Produces: `splitSites(dist: string, out: string): { main: string; bills: string }` and `rewriteAssets(text: string): string`; CLI `node scripts/split-sites.mjs <dist> <out>`.

- [ ] **Step 1: Write the failing test** (`site/tests/unit/split.test.ts`)

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rewriteAssets, splitSites } from "../../scripts/split-sites.mjs";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };

describe("splitting the build into two sites", () => {
  it("points shared assets at the bills site's own copy and leaves links to the main site alone", () => {
    expect(rewriteAssets('<link href=/_astro/a.css><use href="/icons.svg#doc"></use><a href=/transcripts/x/>')).toBe(
      '<link href=/bills/_astro/a.css><use href="/bills/icons.svg#doc"></use><a href=/transcripts/x/>');
    expect(rewriteAssets("@font-face{src:url(/_astro/f.woff2)}")).toBe("@font-face{src:url(/bills/_astro/f.woff2)}");
  });

  it("puts the bill pages, their own assets and a 404 page in the bills site, and everything else in the main site", () => {
    dir = mkdtempSync(join(tmpdir(), "otr-split-"));
    const dist = join(dir, "dist");
    put(join(dist, "index.html"), "<link href=/_astro/a.css>");
    put(join(dist, "_astro", "a.css"), "body{background:url(/_astro/f.woff2)}");
    put(join(dist, "_astro", "f.woff2"), "font");
    put(join(dist, "icons.svg"), "<svg></svg>");
    put(join(dist, "404.html"), "<link href=/_astro/a.css>");
    put(join(dist, "bills", "2025", "S1", "index.html"), '<link href=/_astro/a.css><use href="/icons.svg#doc"></use><a href=/transcripts/x/>');
    const { main, bills } = splitSites(dist, join(dir, "out"));
    expect(existsSync(join(main, "bills"))).toBe(false);
    expect(readFileSync(join(main, "_astro", "a.css"), "utf8")).toBe("body{background:url(/_astro/f.woff2)}");
    expect(readFileSync(join(bills, "2025", "S1", "index.html"), "utf8")).toBe(
      '<link href=/bills/_astro/a.css><use href="/bills/icons.svg#doc"></use><a href=/transcripts/x/>');
    expect(readFileSync(join(bills, "_astro", "a.css"), "utf8")).toBe("body{background:url(/bills/_astro/f.woff2)}");
    expect(existsSync(join(bills, "icons.svg"))).toBe(true);
    expect(readFileSync(join(bills, "404.html"), "utf8")).toBe("<link href=/bills/_astro/a.css>");
    expect(existsSync(join(bills, ".nojekyll"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd site && npx vitest run tests/unit/split.test.ts`
Expected: FAIL, "Failed to load url ../../scripts/split-sites.mjs" (or `splitSites is not a function`).

- [ ] **Step 3: Write the implementation** (`site/scripts/split-sites.mjs`)

```js
// Split the build into the two GitHub Pages sites: the main site (everything but /bills/) and the bills site, which
// is published at /bills/ from its own repository. The bills site carries its own copy of the shared assets
// (scripts, styles, fonts, icons), so its pages never depend on the main site's current file names.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// "/_astro/…" and "/icons.svg" after a quote, "=", "(" or space: attribute values (quoted or not) and CSS url().
const SHARED = /(["'(=\s])\/(_astro\/|icons\.svg)/g;

export const rewriteAssets = (text) => text.replace(SHARED, "$1/bills/$2");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

export function splitSites(dist, out) {
  const main = join(out, "main");
  const bills = join(out, "bills");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(main, { recursive: true });
  for (const name of readdirSync(dist)) if (name !== "bills") cpSync(join(dist, name), join(main, name), { recursive: true });
  cpSync(join(dist, "bills"), bills, { recursive: true });
  cpSync(join(dist, "_astro"), join(bills, "_astro"), { recursive: true });
  for (const name of ["icons.svg", "404.html"]) if (existsSync(join(dist, name))) cpSync(join(dist, name), join(bills, name));
  writeFileSync(join(bills, ".nojekyll"), ""); // a plain static site: no Jekyll processing on the gh-pages branch
  for (const file of files(bills)) {
    if (!/\.(html|css|js)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const next = rewriteAssets(text);
    if (next !== text) writeFileSync(file, next);
  }
  return { main, bills };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist = "dist", out = "../out"] = process.argv.slice(2);
  const { main, bills } = splitSites(dist, out);
  console.log(`Main site: ${main}\nBills site: ${bills}`);
}
```

Add to `site/package.json` scripts: `"split": "node scripts/split-sites.mjs dist ../out"`, and add `/out/` to `.gitignore`.

- [ ] **Step 4: Run the test to verify it passes, then the unit suite**

Run: `cd site && npx vitest run`
Expected: all pass (unit count +2).

- [ ] **Step 5: Split the real build and check it** (uses the full build from Plan 2)

Run: `node scripts/split-sites.mjs <full dist> <tmp>/out` then `grep -rl "=/_astro/\|\"/_astro/" <tmp>/out/bills | head` and `ls <tmp>/out/main | grep -c bills`
Expected: no matches in bills HTML; `0` bills folders in main; sizes about 710 MB and 300 MB.

- [ ] **Step 6: Commit**

```bash
git add site/scripts/split-sites.mjs site/tests/unit/split.test.ts site/package.json .gitignore
git commit -m "feat(site): split the build into the main site and a self-contained bills site"
```

### Task 2: Check links in parallel

**Files:**
- Modify: `site/scripts/check-links.mjs`
- Modify: `site/tests/unit/links.test.ts`

**Interfaces:**
- Consumes: `checkLinks(root, siteBase)` (Plan 2).
- Produces: `checkLinksParallel(root, siteBase, workers?: number): Promise<{ checked; pages; broken }>` with the same results as `checkLinks`; the CLI uses it.

- [ ] **Step 1: Write the failing test** (append to `site/tests/unit/links.test.ts`)

```ts
import { checkLinksParallel } from "../../scripts/check-links.mjs";

describe("the parallel link check", () => {
  it("finds exactly what the single check finds", async () => {
    dir = mkdtempSync(join(tmpdir(), "otr-links-"));
    for (let i = 0; i < 12; i++) {
      mkdirSync(join(dir, `p${i}`));
      writeFileSync(join(dir, `p${i}`, "index.html"), `<a href="/p${(i + 1) % 12}/">next</a> <a href="/missing-${i}/">gone</a>`);
    }
    const single = checkLinks(dir, "/");
    const parallel = await checkLinksParallel(dir, "/", 3);
    expect(parallel.checked).toBe(single.checked);
    expect(parallel.pages).toBe(single.pages);
    expect([...parallel.broken].sort()).toEqual([...single.broken].sort());
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/unit/links.test.ts`; Expected: FAIL (`checkLinksParallel is not a function`).

- [ ] **Step 3: Implement.** Refactor the page loop into `checkPages(root, base, pages)` (exported), keep `checkLinks(root, base)` as `checkPages(root, base, [...htmlFiles(root)])`, and add:

```js
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export async function checkLinksParallel(root, siteBase, workers = Math.max(1, availableParallelism() - 1)) {
  const pages = [...htmlFiles(root)];
  const size = Math.ceil(pages.length / workers) || 1;
  const parts = Array.from({ length: Math.ceil(pages.length / size) }, (_, i) => pages.slice(i * size, (i + 1) * size));
  const results = await Promise.all(parts.map((part) => new Promise((done, fail) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { root, siteBase, part } });
    worker.once("message", done);
    worker.once("error", fail);
  })));
  return results.reduce((all, r) => ({ checked: all.checked + r.checked, pages: all.pages + r.pages, broken: [...all.broken, ...r.broken] }),
    { checked: 0, pages: 0, broken: [] });
}

if (!isMainThread && workerData?.part) parentPort.postMessage(checkPages(workerData.root, workerData.siteBase, workerData.part));
```

The CLI block awaits `checkLinksParallel("dist", process.env.SITE_BASE ?? "/")`.

- [ ] **Step 4: Run tests** — `npx vitest run`; Expected: all pass.
- [ ] **Step 5: Measure on the full build** — `node scripts/check-links.mjs` in the live build folder; Expected: 0 broken links of about 3.29 million, in well under the 212–350 s of the single-threaded check. Record the time in the ledger.
- [ ] **Step 6: Commit** — `git commit -m "perf(site): check links in parallel worker threads"`

### Task 3: Check the live site after a deploy

**Files:**
- Create: `site/scripts/check-live.mjs`
- Create: `site/tests/unit/live.test.ts`

**Interfaces:**
- Produces: `checkLive(base: string, { tries?: number; wait?: number }): Promise<string[]>` (problems; empty when healthy); CLI `node scripts/check-live.mjs https://senaterecords.github.io/` exits 1 on problems.

The check fetches: the homepage (must contain "On the Record"); `search/`; `pagefind/pagefind.js`; the first `/transcripts/…/` link on the homepage; `bills/`; the first `/bills/<session>/<bill>/` page linked from the bills index of the current session, and the first stylesheet that page links (which must be under `/bills/_astro/`). It retries the whole check up to `tries` times (default 10), `wait` ms apart (default 30 000), because a fresh Pages deploy can take a minute to appear.

- [ ] **Step 1: Write the failing test** — a tiny `node:http` server serving a fake two-site layout (homepage with a transcript link, `search/`, `pagefind/pagefind.js`, `bills/` linking `bills/2025/`, which links `bills/2025/S1/`, whose stylesheet is `/bills/_astro/a.css`); assert `checkLive(base, { tries: 1, wait: 0 })` returns `[]`; then make `/bills/_astro/a.css` 404 and assert the problem list names it.
- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with `fetch`, a regex for the first matching `href`, and the retry loop.
- [ ] **Step 4: Run tests** — Expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(site): check the live site after a deploy"`

### Task 4: The workflows

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `.github/workflows/update.yml`
- Create: `scripts/publish-bills.sh`
- Create: `scripts/commit-data.sh`

- [ ] **Step 1: `scripts/publish-bills.sh`**

```bash
#!/usr/bin/env bash
# Publish the bills site: one orphan commit force-pushed to the bills repository's gh-pages branch, so its history
# never grows. Needs BILLS_DEPLOY_KEY, an SSH deploy key with write access to the bills repository.
set -euo pipefail
dir="$1"
repo="${BILLS_REPO:-git@github.com:senaterecords/bills.git}"
key="$(mktemp)"
trap 'rm -f "$key"' EXIT
printf '%s\n' "$BILLS_DEPLOY_KEY" > "$key"
chmod 600 "$key"
cd "$dir"
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "Publish the bills site"
GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git push -q -f "$repo" gh-pages
```

- [ ] **Step 2: `scripts/commit-data.sh`**

```bash
#!/usr/bin/env bash
# Commit changed data (raw API responses, sync state, the deployed quality baseline) back to main. Rebases and
# retries when main moved during the run. Usage: commit-data.sh "message"
set -euo pipefail
git add -A data
if git diff --cached --quiet; then echo "No data changes"; exit 0; fi
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "$1"
for attempt in 1 2 3; do
  git push -q origin HEAD:main && exit 0
  git pull -q --rebase origin main
done
echo "Could not push data after 3 attempts" >&2
exit 1
```

- [ ] **Step 3: `.github/workflows/test.yml`** — on push to `main` (paths-ignore `data/**`) and pull requests: job `pipeline` (setup-python 3.13, `pip install -e "pipeline[dev]"`, `pytest` in `pipeline/`); job `site` (setup-node 22 with npm cache, `npm ci`, `npx vitest run`, `npx playwright install --with-deps chromium`, `npx playwright test`, then `SITE_BASE=/ontherecord/ npx playwright test tests/e2e/base.spec.ts`).

- [ ] **Step 4: `.github/workflows/update.yml`**

```yaml
name: Update
on:
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch:
    inputs:
      rebuild:
        description: "Rebuild and publish even if nothing changed"
        type: boolean
        default: false
concurrency:
  group: update
  cancel-in-progress: false
permissions:
  contents: write
  pages: write
  id-token: write
jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 150
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
          cache: pip
          cache-dependency-path: pipeline/pyproject.toml
      - run: pip install -e "pipeline[dev]"
      - name: Sync with the NY Senate API
        id: sync
        env:
          NYSENATE_API_KEY: ${{ secrets.NYSENATE_API_KEY }}
        run: |
          # Hearings are re-listed once a day, at the 7 a.m. run (New York time).
          if [ "$(TZ=America/New_York date +%H)" = "07" ]; then extra="--hearings"; else extra=""; fi
          python -m nyleg --data data sync $extra
      - name: Save the new raw data
        if: steps.sync.outputs.changed == 'true'
        run: bash scripts/commit-data.sh "data: sync $(date -u +%Y-%m-%dT%H:%MZ)"
      - name: Decide whether to publish
        id: go
        run: echo "publish=${{ steps.sync.outputs.changed == 'true' || inputs.rebuild == true }}" >> "$GITHUB_OUTPUT"
      - name: Process (with the quality gate)
        if: steps.go.outputs.publish == 'true'
        run: python -m nyleg --data data process --out data/site --gate-against data/quality-deployed.json
      - uses: actions/setup-node@v4
        if: steps.go.outputs.publish == 'true'
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: site/package-lock.json
      - name: Build, check and split
        if: steps.go.outputs.publish == 'true'
        working-directory: site
        run: |
          npm ci
          npx vitest run
          npm run build
          npm run check
          npm run split
      - uses: actions/upload-pages-artifact@v3
        if: steps.go.outputs.publish == 'true'
        with:
          path: out/main
      - name: Publish the bills site
        if: steps.go.outputs.publish == 'true'
        env:
          BILLS_DEPLOY_KEY: ${{ secrets.BILLS_DEPLOY_KEY }}
        run: bash scripts/publish-bills.sh out/bills
      - name: Publish the main site
        id: deploy
        if: steps.go.outputs.publish == 'true'
        uses: actions/deploy-pages@v4
      - name: Check the live site
        if: steps.go.outputs.publish == 'true'
        run: node site/scripts/check-live.mjs https://senaterecords.github.io/
      - name: Move the quality baseline
        if: steps.go.outputs.publish == 'true'
        run: |
          cp data/site/quality.json data/quality-deployed.json
          bash scripts/commit-data.sh "data: quality baseline after deploy"
      - name: Keep the schedule alive
        if: steps.go.outputs.publish != 'true'
        run: |
          # GitHub turns a schedule off after 60 days without activity; touch the sync state once a week.
          last=$(git log -1 --format=%ct)
          if [ $(( $(date +%s) - last )) -gt 604800 ]; then
            date -u +%Y-%m-%dT%H:%MZ > data/last-checked.txt
            bash scripts/commit-data.sh "data: weekly keep-alive"
          fi
```

The bills site is published before the main site: its pages carry their own assets, so it can go first without breaking anything, and a failed main deploy leaves bills already current with its links to main pages still valid.

- [ ] **Step 5: Validate locally** — `python -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` and `bash -n scripts/*.sh`; Expected: no errors.
- [ ] **Step 6: Commit** — `git commit -m "ci: hourly update and publish, and tests on every push"`

### Task 5: Set up GitHub (outward steps, each confirmed with the user)

- [ ] **Step 1: Workflow permission for `gh`** — `gh auth refresh -h github.com -s workflow` (the user enters a device code).
- [ ] **Step 2: Commit the raw data** — `git add data/raw data/state.json` then `git commit -m "data: the full archive as of 2026-10-16"`. Check: `git count-objects -vH` (expect a pack around 250 MB).
- [ ] **Step 3: Create the repositories** — `gh repo create senaterecords/senaterecords.github.io --public --description "On the Record: NY Senate transcripts, searchable and citable"` and `gh repo create senaterecords/bills --public --description "Bill pages for senaterecords.github.io"`.
- [ ] **Step 4: Push** — `git remote add origin https://github.com/senaterecords/senaterecords.github.io.git` then `git push -u origin main`. Before pushing: `git log --format=%B | grep -ci co-authored` must print 0.
- [ ] **Step 5: The API key secret** — the key read from `.env` and piped straight into `gh secret set NYSENATE_API_KEY -R senaterecords/senaterecords.github.io` (never echoed).
- [ ] **Step 6: The bills deploy key** — `ssh-keygen -t ed25519 -N "" -C "senaterecords bills publish" -f <scratch>/bills_deploy`; `gh repo deploy-key add <scratch>/bills_deploy.pub -R senaterecords/bills --allow-write --title "hourly publish"`; `gh secret set BILLS_DEPLOY_KEY -R senaterecords/senaterecords.github.io < <scratch>/bills_deploy`; delete both key files.
- [ ] **Step 7: Pages for the main site** — `gh api -X POST repos/senaterecords/senaterecords.github.io/pages -f build_type=workflow`.

### Task 6: First publish and verification

- [ ] **Step 1: Run it** — `gh workflow run update.yml -R senaterecords/senaterecords.github.io -f rebuild=true`, then `gh run watch`. Expected: sync, process (no baseline yet, so the gate passes), build, checks, split, bills push and main deploy succeed. Record the build and check times from GitHub's machines.
- [ ] **Step 2: Pages for the bills site** (the branch exists after step 1) — `gh api -X POST repos/senaterecords/bills/pages -f "source[branch]=gh-pages" -f "source[path]=/"`. Wait for its first Pages build (`gh api repos/senaterecords/bills/pages/builds/latest`).
- [ ] **Step 3: Verify live** — `node site/scripts/check-live.mjs https://senaterecords.github.io/`; Expected: no problems. Open the homepage, a transcript, a search, and a bill page in a browser.
- [ ] **Step 4: The baseline commit landed** — `git pull` shows `data/quality-deployed.json`.
- [ ] **Step 5: The next scheduled run** — `gh run list -w update.yml` after :17 shows a run that ends "nothing changed" in under 5 minutes, without publishing.

### Task 7: Documentation

- [ ] **Step 1: `README.md`** — what the site is, the two addresses, how the hourly update works (sync → process → build → checks → publish), "Update now" (Actions tab → Update → Run workflow, optionally "Rebuild"), the two secrets and how to rotate them, running everything locally, and what to do when a run fails (API key rejected, quality gate, size, links).
- [ ] **Step 2: Spec** — section 10 (the two repositories, branch publishing for bills, the deploy key), section 15 (setup done), decision-log rows for: raw data committed (≈250 MB packed), bills published from a branch through a deploy key, self-contained bills assets, parallel link check, keep-alive file.
- [ ] **Step 3: Commit** — `git commit -m "docs: README for maintainers and the hosting decisions"`; push.
