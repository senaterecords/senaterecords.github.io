# On the Record: Data Pipeline Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python package `nyleg`. It downloads NY Senate floor and public-hearing transcripts from the Open Legislation API into `data/raw/`, splits them into speaker turns, matches senators, links debated bills, and writes the site data contract into `data/site/`.

**Architecture:** The package is made of small single-purpose modules, each tested on its own:
- `api`: the HTTP client
- `store`: raw files on disk
- `clean`: page and line cleanup
- `speakers`: splitting text into turns
- `senators`: matching speaker labels to senators
- `bills`: bill mentions and calendar segments
- `sync`: downloading
- `quality`: the quality report and deploy gate
- `sitedata`: the output contract
- `__main__`: the command line

Parsing works offline on stored raw data. Only `sync` touches the network.

**Tech stack:** Python 3.11+ (CI uses 3.12), httpx, PyYAML and pytest. Test fixtures are real transcripts from the NY Senate's OpenLegislation repo.

**Spec:** `docs/superpowers/specs/2026-10-15-on-the-record-design.md`. This plan covers spec sections 5, 6 and 7, the pipeline rows of section 11, and the pipeline part of section 12. Plans 2–4 cover the site, automation and hosting, and the search experiment.

Every function and test below has already been run against the real sample transcripts in a scratch copy: 84 tests passed. Type the code as given. If a test fails, the difference is in what was typed.

## Global Constraints

- **API:**
  - Base URL `https://legislation.nysenate.gov/api/3`. The key goes only in the `key` query parameter, read from the `NYSENATE_API_KEY` environment variable.
  - Throttle to about 1 request per second. Retry 5xx, 429 and network errors with backoff of 2, 4, 8 and 16 seconds.
  - List endpoints allow `limit` up to 1000. **Offsets start at 1**: paging advances by the number of items received and stops at the first short page. This is needed because the `total` in hearing listings is wrong.
  - An HTTP 200 response with `"success": false` is an error.
- **Endpoints:**
  - Floor transcript listings must pass `sessionOnly=false`. Otherwise pro forma legislative days are hidden.
  - Hearings are keyed by `filename`, because ids of 1000 or more can't be fetched by id.
  - Bills are fetched with `view=no_fulltext`, and only for sessions from `BILL_DATA_START = 2009` onward.
- **Storage:**
  - Raw records (the API's `result` objects) are saved unchanged under `data/raw/` as sorted, LF-only JSON. They are committed.
  - `data/site/` is generated output and is never committed.
  - `data/corrections.json` records the date each stored transcript's text last changed. It is committed, and it drives the "Corrected transcript" flag.
  - Public hearings are refreshed by re-listing the current year (`sync --hearings`, run daily by Plan 3). The hearing updates endpoint's item shape hasn't been verified.
- **Text:** never change transcript words. Only whitespace is normalised: line joins and collapsed runs of spaces.
- **Plain-text fallback:** a transcript falls back to plain text when speaker coverage is below 0.8. The leading front matter, up to 3,000 characters, isn't counted against coverage.
- **"Debated":** at least 40 words spoken by non-presiding senators or chairs before the calendar item's outcome.
- **Quality gate:** fail if attribution or bill-link rate drops more than 2 percentage points from the previous `quality.json`.
- **Command exit codes:** 0 OK, 3 API key missing or rejected, 4 API unavailable, 5 quality gate failed. `sync` writes `changed=true|false` to `$GITHUB_OUTPUT`.
- **Data contract file names (spec section 7):**
  - `meta.json`
  - `transcripts/{slug}.json`
  - `senators.json`
  - `senators/{slug}.json`
  - `bills/{session}.json`
  - `words/{prefix}.json`
  - `quality.json`

## Review Focus

These are the inputs most likely to break the pipeline for a real user. Each one is pinned by a test in the task that owns the code:

1. **The API returns HTTP 200 with `"success": false`** (for example a bad parameter). This must raise `ApiError`, not quietly look like "no new transcripts". Covered by `test_success_false_is_an_error_even_with_http_200` (Task 1).
2. **A pro forma legislative day, where only the Secretary and the presiding officer speak.** It must produce a normal transcript with coverage 1.0 and no segments, and must not be flagged as plain text. Covered by `test_2020_legislative_day_with_only_procedural_voices` (Task 4) and the `legislative_day` assertions in `test_build_all_writes_the_whole_contract` (Task 9).
3. **Two senators share a surname in the same session.** "SENATOR ADA SMITH" must resolve to the right person. A bare "SENATOR SMITH" must stay unmatched and be reported, never guessed. Covered by `test_full_name_labels_pick_the_right_smith` and `test_bare_shared_surname_is_never_guessed` (Task 5).
4. **A bill mention split by a line wrap and a page break** ("Senate Print / [page 1520] / 882-A"). It must still be found exactly once, with the correct pages. Covered by `test_bill_mention_split_by_a_line_wrap_and_a_page_break_is_still_found` (Task 6).
5. **An interrupted backfill.** Re-running it must resume at the first unfinished year without re-downloading finished ones. Re-syncing identical data must report no changes. Covered by `test_backfill_resumes_after_an_interruption` and `test_resyncing_identical_data_reports_no_changes` (Task 7).

---

### Task 1: Project setup and the API client

**Files:**
- Create: `pipeline/pyproject.toml`
- Create: `pipeline/nyleg/__init__.py`
- Create: `pipeline/nyleg/api.py`
- Test: `pipeline/tests/test_api.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `nyleg.api.Client(key: str, *, base_url=BASE_URL, transport: httpx.BaseTransport | None = None, min_interval=1.0, max_retries=4, sleep=time.sleep, clock=time.monotonic)`
  - `Client.get(path: str, **params) -> dict`, which returns the whole JSON body
  - `Client.iter_items(path: str, *, page_size=1000, **params) -> Iterator[dict]`
  - Exceptions `ApiError`, `AuthError(ApiError)` and `NotFound(ApiError)`
  - Constant `MAX_LIMIT = 1000`

- [ ] **Step 1: Create the project file and an empty package**

`pipeline/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "nyleg"
version = "0.1.0"
description = "Data pipeline for On the Record: NY Senate transcripts, split by speaker and linked to bills"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27,<1",
    "PyYAML>=6.0",
    "tzdata; sys_platform == 'win32'",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.setuptools.packages.find]
include = ["nyleg*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`pipeline/nyleg/__init__.py`:

```python
"""On the Record data pipeline."""
```

Then set up the environment (on Windows, activate with `.venv\Scripts\activate`):

```bash
cd pipeline
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

- [ ] **Step 2: Write the failing tests**

`pipeline/tests/test_api.py`:

```python
import httpx
import pytest

from nyleg.api import ApiError, AuthError, Client, NotFound


def make_client(handler, **kwargs):
    sleeps: list[float] = []
    client = Client("test-key", transport=httpx.MockTransport(handler), min_interval=0, sleep=sleeps.append, **kwargs)
    return client, sleeps


def ok(payload):
    return httpx.Response(200, json={"success": True, **payload})


def test_get_sends_key_and_formats_params():
    seen = {}

    def handler(request):
        seen["url"] = request.url
        return ok({"result": {"items": []}})

    client, _ = make_client(handler)
    client.get("/transcripts/2025", full=True, sessionOnly=False)
    assert seen["url"].path == "/api/3/transcripts/2025"
    assert seen["url"].params["key"] == "test-key"
    assert seen["url"].params["full"] == "true"
    assert seen["url"].params["sessionOnly"] == "false"


def test_missing_key_raises_auth_error():
    with pytest.raises(AuthError, match="NYSENATE_API_KEY"):
        Client("")


def test_401_raises_auth_error():
    client, _ = make_client(lambda r: httpx.Response(401, json={"success": False, "errorCode": 701}))
    with pytest.raises(AuthError, match="rejected"):
        client.get("/transcripts")


def test_404_raises_not_found():
    client, _ = make_client(lambda r: httpx.Response(404, json={"success": False, "message": "Bill not found"}))
    with pytest.raises(NotFound):
        client.get("/bills/2025/S99999")


def test_success_false_is_an_error_even_with_http_200():
    client, _ = make_client(lambda r: httpx.Response(200, json={"success": False, "message": "Invalid parameter"}))
    with pytest.raises(ApiError, match="Invalid parameter"):
        client.get("/transcripts")


def test_retries_server_errors_with_backoff():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(503)
        return ok({"result": {"items": [1]}})

    client, sleeps = make_client(handler)
    assert client.get("/transcripts")["result"]["items"] == [1]
    assert sleeps == [2.0, 4.0]


def test_gives_up_after_max_retries():
    client, sleeps = make_client(lambda r: httpx.Response(500), max_retries=2)
    with pytest.raises(ApiError, match="Gave up"):
        client.get("/transcripts")
    assert sleeps == [2.0, 4.0]


def test_network_errors_are_retried():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("boom")
        return ok({"result": {}})

    client, sleeps = make_client(handler)
    client.get("/transcripts")
    assert sleeps == [2.0]


def test_iter_items_pages_with_one_based_offsets():
    offsets = []
    pages = {1: [1, 2], 3: [3, 4], 5: [5]}

    def handler(request):
        offset = int(request.url.params["offset"])
        offsets.append(offset)
        return ok({"result": {"items": pages[offset]}})

    client, _ = make_client(handler)
    assert list(client.iter_items("/hearings", page_size=2)) == [1, 2, 3, 4, 5]
    assert offsets == [1, 3, 5]


def test_throttle_spaces_out_requests():
    now = [100.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(round(seconds, 3))
        now[0] += seconds

    client = Client(
        "k",
        transport=httpx.MockTransport(lambda r: ok({"result": {}})),
        min_interval=1.0,
        sleep=sleep,
        clock=lambda: now[0],
    )
    client.get("/a")
    client.get("/b")
    assert sleeps == [1.0]
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_api.py -v` (from `pipeline/`)
Expected: collection error `ModuleNotFoundError: No module named 'nyleg.api'`.

- [ ] **Step 4: Write the client**

`pipeline/nyleg/api.py`:

```python
"""Client for the NY Senate Open Legislation API (v3)."""
from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

BASE_URL = "https://legislation.nysenate.gov/api/3"
MAX_LIMIT = 1000


class ApiError(Exception):
    """The API could not be reached or returned an unusable response."""


class AuthError(ApiError):
    """The API key is missing or was rejected."""


class NotFound(ApiError):
    """The API has no record at this path (HTTP 404)."""


def _fmt(value: Any) -> Any:
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


class Client:
    """Throttled, retrying API client. The key is sent only as the `key` query parameter."""

    def __init__(
        self,
        key: str,
        *,
        base_url: str = BASE_URL,
        transport: httpx.BaseTransport | None = None,
        min_interval: float = 1.0,
        max_retries: int = 4,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not key:
            raise AuthError("NY Senate API key is missing: set NYSENATE_API_KEY")
        self._key = key
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=60.0)
        self._min_interval = min_interval
        self._max_retries = max_retries
        self._sleep = sleep
        self._clock = clock
        self._last: float | None = None

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        query = {k: _fmt(v) for k, v in params.items() if v is not None}
        query["key"] = self._key
        delay = 2.0
        for attempt in range(self._max_retries + 1):
            self._throttle()
            try:
                resp = self._http.get(path, params=query)
            except httpx.TransportError as exc:
                problem = f"network error: {exc}"
            else:
                if resp.status_code == 401:
                    raise AuthError("NY Senate API key rejected")
                if resp.status_code == 404:
                    raise NotFound(f"Not found: {path}")
                if resp.status_code < 500 and resp.status_code != 429:
                    return self._parse(resp, path)
                problem = f"HTTP {resp.status_code}"
            if attempt == self._max_retries:
                raise ApiError(f"Gave up on {path} after {attempt + 1} attempts ({problem})")
            self._sleep(delay)
            delay *= 2
        raise AssertionError("unreachable")

    def iter_items(self, path: str, *, page_size: int = MAX_LIMIT, **params: Any) -> Iterator[dict[str, Any]]:
        """Yield every item of a list endpoint. Offsets start at 1; stop at the first short page."""
        offset = 1
        while True:
            body = self.get(path, limit=page_size, offset=offset, **params)
            items = (body.get("result") or {}).get("items") or []
            yield from items
            if len(items) < page_size:
                return
            offset += len(items)

    def _throttle(self) -> None:
        if self._last is not None:
            wait = self._min_interval - (self._clock() - self._last)
            if wait > 0:
                self._sleep(wait)
        self._last = self._clock()

    @staticmethod
    def _parse(resp: httpx.Response, path: str) -> dict[str, Any]:
        try:
            body = resp.json()
        except ValueError as exc:
            raise ApiError(f"Response from {path} was not JSON (HTTP {resp.status_code})") from exc
        if resp.status_code >= 400 or not isinstance(body, dict) or body.get("success") is False:
            message = body.get("message") if isinstance(body, dict) else None
            raise ApiError(f"API error from {path}: {message or f'HTTP {resp.status_code}'}")
        return body
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_api.py -v`
Expected: 10 passed.

- [ ] **Step 6: Commit**

```bash
git add pipeline/pyproject.toml pipeline/nyleg/__init__.py pipeline/nyleg/api.py pipeline/tests/test_api.py
git commit -m "feat(pipeline): add throttled, retrying Open Legislation API client"
```

---

### Task 2: The raw store

**Files:**
- Create: `pipeline/nyleg/store.py`
- Test: `pipeline/tests/test_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `slugify(value: str) -> str`
  - `write_json(path: Path, data) -> bool`, which returns True only when the file was created or changed
  - `read_json(path: Path, default=None)`
  - The dataclass `Store(root: Path)`, with:
    - properties `raw` and `state_path`
    - `transcript_path(date_time: str, session_type: str) -> Path`
    - `hearing_path(year: int, key: str) -> Path`
    - `members_path(session: int) -> Path`
    - `bill_path(session: int, base_print_no: str) -> Path`
    - `load_state() -> dict` and `save_state(state: dict)`
    - property `corrections_path`, which is `data/corrections.json`
    - `raw_key(path) -> str`, the path relative to `raw/` written with forward slashes
    - `iter_raw(kind: str) -> Iterator[Path]`, where kind is `"transcripts"` or `"hearings"`, sorted

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_store.py`:

```python
from nyleg.store import Store, read_json, slugify, write_json


def test_slugify():
    assert slugify("Extraordinary Session II") == "extraordinary-session-ii"
    assert slugify("10-29-13 NYsenate_Flanagan_Education_FINAL.txt") == "10-29-13-nysenate-flanagan-education-final-txt"


def test_transcript_path_has_no_colons(tmp_path):
    store = Store(tmp_path)
    path = store.transcript_path("2014-09-03T09:00", "Regular Session")
    assert path == tmp_path / "raw" / "transcripts" / "2014" / "2014-09-03T0900__regular-session.json"


def test_hearing_bill_and_member_paths(tmp_path):
    store = Store(tmp_path)
    assert store.hearing_path(2013, "10-29-13 NYsenate_Flanagan.txt").name == "10-29-13-nysenate-flanagan-txt.json"
    assert store.bill_path(2025, "S4597") == tmp_path / "raw" / "bills" / "2025" / "S4597.json"
    assert store.members_path(2025) == tmp_path / "raw" / "members" / "2025.json"


def test_write_json_reports_whether_anything_changed(tmp_path):
    path = tmp_path / "a" / "b.json"
    assert write_json(path, {"x": 1}) is True
    assert write_json(path, {"x": 1}) is False
    assert write_json(path, {"x": 2}) is True
    assert read_json(path) == {"x": 2}
    assert b"\r\n" not in path.read_bytes()


def test_state_round_trip_and_missing_state(tmp_path):
    store = Store(tmp_path)
    assert store.load_state() == {}
    store.save_state({"transcripts_synced_at": "2025-06-10T18:00:00"})
    assert store.load_state() == {"transcripts_synced_at": "2025-06-10T18:00:00"}


def test_iter_raw_is_sorted_and_tolerates_missing_folders(tmp_path):
    store = Store(tmp_path)
    assert list(store.iter_raw("transcripts")) == []
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), {})
    write_json(store.transcript_path("1993-03-10T12:10", "Regular Session"), {})
    names = [p.name for p in store.iter_raw("transcripts")]
    assert names == ["1993-03-10T1210__regular-session.json", "2025-06-10T1100__regular-session.json"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_store.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.store'`.

- [ ] **Step 3: Write the store**

`pipeline/nyleg/store.py`:

```python
"""Where raw API responses and sync state live on disk (the repo's data/ folder)."""
from __future__ import annotations

import json
import os
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_NON_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    return _NON_SLUG.sub("-", value.lower()).strip("-")


def write_json(path: Path, data: Any) -> bool:
    """Write stable, diff-friendly JSON. Returns True only if the file was created or changed."""
    text = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return True


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass
class Store:
    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    @property
    def corrections_path(self) -> Path:
        """{raw path relative to raw/: date the stored text last changed} for re-issued transcripts."""
        return self.root / "corrections.json"

    def raw_key(self, path: Path) -> str:
        return path.relative_to(self.raw).as_posix()

    def transcript_path(self, date_time: str, session_type: str) -> Path:
        name = f"{date_time.replace(':', '')}__{slugify(session_type)}.json"
        return self.raw / "transcripts" / date_time[:4] / name

    def hearing_path(self, year: int, key: str) -> Path:
        return self.raw / "hearings" / str(year) / f"{slugify(key)}.json"

    def members_path(self, session: int) -> Path:
        return self.raw / "members" / f"{session}.json"

    def bill_path(self, session: int, base_print_no: str) -> Path:
        return self.raw / "bills" / str(session) / f"{base_print_no}.json"

    def load_state(self) -> dict[str, Any]:
        return read_json(self.state_path, {}) or {}

    def save_state(self, state: dict[str, Any]) -> None:
        write_json(self.state_path, state)

    def iter_raw(self, kind: str) -> Iterator[Path]:
        folder = self.raw / kind
        if not folder.exists():
            return iter(())
        return iter(sorted(folder.rglob("*.json")))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_store.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/store.py pipeline/tests/test_store.py
git commit -m "feat(pipeline): add raw store with stable JSON and sync state"
```

---

### Task 3: Cleaning transcript text into paragraphs with page numbers

**Files:**
- Create: `pipeline/tests/fixtures/text/` with 6 sample transcripts, downloaded in Step 1
- Create: `pipeline/tests/fixtures/README.md`
- Create: `pipeline/tests/conftest.py`
- Create: `pipeline/nyleg/clean.py`
- Test: `pipeline/tests/test_clean.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - dataclass `Line(text: str, indent: int, page: int | None)`
  - dataclass `PageBreak(offset: int, page: int)`
  - dataclass `Paragraph(text: str, page_start: int | None, breaks: list[PageBreak])`, with a `page_end` property
  - `extract_lines(raw: str) -> list[Line]`
  - `body_indent(lines) -> int`
  - `paragraphs(lines) -> list[Paragraph]`
  - the pytest fixture `fixture_text(name) -> str`

**How the cleaner reads the three layouts:**
- **Page numbers.** A digits-only line is a page number if any of these holds:
  - it is indented 30 or more spaces (the right-aligned modern style)
  - it follows a whitespace-only line at least 30 characters long (the 1990s style)
  - its value is over 28

  Any other digits-only line is a bare line number and is dropped.
- **Line numbers.** These are stripped only when at least half of the content lines start with one (1–28). That keeps digits like "2020 budget…" in files that have no line numbers.
- **Vendor page headers.** A right-aligned "Page 15" header is also a page number.
- **Running headers and footers.** Text that repeats in the first or last two lines of at least 30% of pages (and at least 3 pages) is dropped. Examples are a hearing title printed at the top of every page, or a "Geneva Worldwide, Inc." footer.
- **Paragraphs.** A new paragraph starts when a line is indented at least 4 more than the body indent. The body indent is the most common indent among lines that start with a lowercase letter, because continuation lines usually do.

- [ ] **Step 1: Download the fixtures (pinned to the commit the tests were written against)**

```bash
mkdir -p pipeline/tests/fixtures/text
B=https://raw.githubusercontent.com/nysenate/OpenLegislation/f672f9c33073ae9a133708964239748eaf909e5a/src/test/resources
curl -sSfL -o pipeline/tests/fixtures/text/floor-1993-03-10.txt "$B/transcriptFiles/forPdfParser/1993-03-10T1210"
curl -sSfL -o pipeline/tests/fixtures/text/floor-1998-03-10.txt "$B/transcriptFiles/forPdfParser/1998-03-10T1510"
curl -sSfL -o pipeline/tests/fixtures/text/floor-2000-01-05.txt "$B/transcriptFiles/forPdfParser/2000-01-05T1210"
curl -sSfL -o pipeline/tests/fixtures/text/floor-2020-01-01.txt "$B/transcriptFiles/forPdfParser/2020-01-01T1100"
curl -sSfL -o pipeline/tests/fixtures/text/hearing-2011-05-18.txt "$B/hearingTranscripts/05-18-11%20Valesky%20Aging%20Test.txt"
curl -sSfL -o pipeline/tests/fixtures/text/hearing-2020-08-25-vendor.txt "$B/hearingTranscripts/8-25-20%20MTA%20Transcript%20Test.txt"
wc -c pipeline/tests/fixtures/text/*
```

Expected sizes: 15284, 93464, 29399, 2163, 112783 and 446179 bytes. Add a `.gitattributes` line so git never rewrites their line endings:

```bash
printf 'pipeline/tests/fixtures/text/* -text\n' >> .gitattributes
```

`pipeline/tests/fixtures/README.md`:

```markdown
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
```

`pipeline/tests/conftest.py`:

```python
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_text():
    def load(name: str) -> str:
        return (FIXTURES / "text" / name).read_text(encoding="utf-8", errors="replace")

    return load
```

- [ ] **Step 2: Write the failing tests**

`pipeline/tests/test_clean.py`:

```python
import pytest

from nyleg.clean import extract_lines, paragraphs


def test_strips_line_numbers_and_reads_right_aligned_page_numbers():
    raw = (
        "                                                               7583\n\n"
        " 1                P R O C E E D I N G S\n\n"
        " 2                ACTING PRESIDENT BRESLIN:   The\n\n"
        " 3   Senate will come to order.\n"
    )
    lines = extract_lines(raw)
    assert [line.text for line in lines] == [
        "P R O C E E D I N G S",
        "ACTING PRESIDENT BRESLIN:   The",
        "Senate will come to order.",
    ]
    assert {line.page for line in lines} == {7583}


def test_unnumbered_format_keeps_leading_digits_in_the_text():
    raw = (
        "                                                           3\n\n"
        "                             THE PRESIDENT:    The Secretary\n\n"
        "                 2020 budget talks will continue.\n"
    )
    lines = extract_lines(raw)
    assert lines[1].text == "2020 budget talks will continue."
    assert lines[0].page == 3


def test_left_aligned_page_numbers_from_the_1990s():
    raw = (
        "                                                             \n"
        "1081\n\n"
        "         1                      ACTING PRESIDENT MEGA:  Senate\n\n"
        "         2       will come to order.\n"
    )
    lines = extract_lines(raw)
    assert [line.page for line in lines] == [1081, 1081]
    assert lines[0].indent > lines[1].indent


def test_crlf_and_form_feeds_are_handled():
    raw = "\f                                                     12\r\n 1          THE SECRETARY:  Ayes 48.\r\n"
    lines = extract_lines(raw)
    assert [(line.text, line.page) for line in lines] == [("THE SECRETARY:  Ayes 48.", 12)]


def test_paragraphs_join_wrapped_lines_and_record_page_breaks():
    raw = (
        "                                                               5780\n\n"
        " 24              SENATOR ORTEGA:   This bill does\n\n"
        " 25   one thing.\n\n"
        "                                                               5781\n\n"
        " 1   It says the program has to answer.\n\n"
        " 2               SENATOR KEARNEY:   Will the sponsor\n\n"
        " 3   yield?\n"
    )
    paras = paragraphs(extract_lines(raw))
    assert [p.text for p in paras] == [
        "SENATOR ORTEGA: This bill does one thing. It says the program has to answer.",
        "SENATOR KEARNEY: Will the sponsor yield?",
    ]
    assert paras[0].page_start == 5780
    assert [(b.offset, b.page) for b in paras[0].breaks] == [(len("SENATOR ORTEGA: This bill does one thing. "), 5781)]
    assert paras[1].page_start == 5781
    assert paras[1].breaks == []


def test_vendor_page_headers_running_headers_and_footers_are_removed():
    page = (
        "\f                                                    Page {n}\n"
        "1    Joint Hearing on the MTA, 8-25-20\n\n"
        "2                 SENATOR COMRIE:   Line {n} of testimony\n\n"
        "3       continues here.\n\n\n"
        "                           Geneva Worldwide, Inc.\n"
        "           256 West 38 t h Street, 10 t h Floor, New York, NY 10018\n"
    )
    lines = extract_lines("".join(page.format(n=n) for n in (2, 3, 4)))
    assert not any("Geneva" in l.text or "West 38" in l.text or "Joint Hearing" in l.text for l in lines)
    assert [l.page for l in lines] == [2, 2, 3, 3, 4, 4]


def test_empty_text_gives_no_paragraphs():
    assert paragraphs(extract_lines("")) == []


@pytest.mark.parametrize(
    "name,first_page",
    [
        ("floor-1993-03-10.txt", 1080),
        ("floor-2000-01-05.txt", 1),
        ("floor-2020-01-01.txt", 7582),
        ("hearing-2011-05-18.txt", None),
        ("hearing-2020-08-25-vendor.txt", None),
    ],
)
def test_real_transcripts_from_each_era(fixture_text, name, first_page):
    paras = paragraphs(extract_lines(fixture_text(name)))
    assert len(paras) > 10
    assert paras[0].page_start == first_page
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_clean.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.clean'`.

- [ ] **Step 4: Write the cleaner**

`pipeline/nyleg/clean.py`:

```python
"""Turn raw transcript text into paragraphs that know their official page numbers."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

_DIGITS = re.compile(r"^\d{1,5}$")
_PAGE_WORD = re.compile(r"^Page (\d{1,5})$")
_LINE_NO = re.compile(r"^\s{0,10}(\d{1,2})(?=\s|$)")
_WS = re.compile(r"\s+")
MAX_LINE_NO = 28
PAGE_INDENT = 30
PARA_STEP = 4
EDGE_LINES = 2           # lines at the top and bottom of a page that may be running headers/footers
BOILERPLATE_SHARE = 0.3  # ...and are dropped when repeated on this share of pages (at least 3)


@dataclass
class Line:
    text: str      # content, without the line number or leading spaces
    indent: int    # spaces before the content, after removing the line number
    page: int | None


@dataclass
class PageBreak:
    offset: int    # character offset in the paragraph (or turn) text where the new page starts
    page: int


@dataclass
class Paragraph:
    text: str
    page_start: int | None
    breaks: list[PageBreak] = field(default_factory=list)

    @property
    def page_end(self) -> int | None:
        return self.breaks[-1].page if self.breaks else self.page_start


def _is_numbered(rows: list[str]) -> bool:
    content = [r for r in rows if r.strip() and not _DIGITS.match(r.strip())]
    if not content:
        return False
    hits = 0
    for r in content:
        m = _LINE_NO.match(r)
        if m and int(m.group(1)) <= MAX_LINE_NO:
            hits += 1
    return hits / len(content) >= 0.5


def _drop_boilerplate(lines: list[Line]) -> list[Line]:
    """Remove running headers and vendor footers: text repeated at the edges of many pages."""
    pages: dict[int | None, list[Line]] = defaultdict(list)
    for line in lines:
        pages[line.page].append(line)
    edges: Counter = Counter()
    for page_lines in pages.values():
        edge = {_WS.sub(" ", l.text) for l in page_lines[:EDGE_LINES] + page_lines[-EDGE_LINES:]}
        edges.update(edge)
    floor = max(3, BOILERPLATE_SHARE * len(pages))
    boilerplate = {text for text, count in edges.items() if count >= floor}
    return [l for l in lines if _WS.sub(" ", l.text) not in boilerplate]


def extract_lines(raw: str) -> list[Line]:
    rows = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n").expandtabs(8).split("\n")
    numbered = _is_numbered(rows)
    lines: list[Line] = []
    page: int | None = None
    prev_wide_blank = False
    for row in rows:
        stripped = row.strip()
        if not stripped:
            prev_wide_blank = len(row) >= PAGE_INDENT
            continue
        lead = len(row) - len(row.lstrip(" "))
        worded = _PAGE_WORD.match(stripped)
        if worded and lead >= PAGE_INDENT:
            page = int(worded.group(1))
            prev_wide_blank = False
            continue
        if _DIGITS.match(stripped):
            value = int(stripped)
            if lead >= PAGE_INDENT or prev_wide_blank or value > MAX_LINE_NO:
                page = value
            prev_wide_blank = False
            continue  # a page number, or a bare line number on an empty line
        prev_wide_blank = False
        body = row.rstrip()
        if numbered:
            m = _LINE_NO.match(body)
            if m and int(m.group(1)) <= MAX_LINE_NO:
                body = body[m.end():]
        content = body.lstrip(" ")
        if content:
            lines.append(Line(text=content, indent=len(body) - len(content), page=page))
    return _drop_boilerplate(lines)


def body_indent(lines: list[Line]) -> int:
    """The indent of ordinary continuation lines, which usually start in lower case."""
    lower = Counter(l.indent for l in lines if l.text[:1].islower())
    pool = lower if lower else Counter(l.indent for l in lines)
    return pool.most_common(1)[0][0]


def paragraphs(lines: list[Line]) -> list[Paragraph]:
    """Join wrapped lines. A line indented PARA_STEP past the body indent starts a new paragraph."""
    if not lines:
        return []
    threshold = body_indent(lines) + PARA_STEP
    out: list[Paragraph] = []
    cur: Paragraph | None = None
    for line in lines:
        text = _WS.sub(" ", line.text).strip()
        if cur is None or line.indent >= threshold:
            cur = Paragraph(text=text, page_start=line.page)
            out.append(cur)
            continue
        offset = len(cur.text) + 1
        if line.page is not None and line.page != cur.page_end:
            cur.breaks.append(PageBreak(offset=offset, page=line.page))
        cur.text = f"{cur.text} {text}"
    return out
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_clean.py -v`
Expected: 12 passed.

- [ ] **Step 6: Commit**

```bash
git add .gitattributes pipeline/tests/fixtures pipeline/tests/conftest.py pipeline/nyleg/clean.py pipeline/tests/test_clean.py
git commit -m "feat(pipeline): clean transcript text into paged paragraphs for all three layouts"
```

---

### Task 4: Splitting paragraphs into speaker turns

**Files:**
- Create: `pipeline/nyleg/speakers.py`
- Test: `pipeline/tests/test_speakers.py`

**Interfaces:**
- Consumes: `Paragraph` and `PageBreak` from `nyleg.clean`.
- Produces:
  - Role constants `ROLE_RECORD = "record"`, `ROLE_SECRETARY`, `ROLE_PRESIDENT`, `ROLE_PRESIDING`, `ROLE_SENATOR`, `ROLE_ASSEMBLY`, `ROLE_CHAIR` and `ROLE_GUEST`. Each one's value is its lowercase name.
  - dataclass `Turn(index: int, label: str | None, role: str, name: str | None, text: str, page_start: int | None, breaks: list[PageBreak])`, with a `page_end` property. Paragraphs inside a turn are joined with `"\n\n"`.
  - `parse_label(text) -> tuple[str, str] | None`
  - `classify(label) -> tuple[role, name | None]`. The name stops at the first comma, so "SENATOR TIM KENNEDY, CHAIR, …" gives "TIM KENNEDY".
  - `split_turns(paras) -> list[Turn]`
  - `coverage(turns) -> float`

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_speakers.py`:

```python
import pytest

from nyleg.clean import PageBreak, Paragraph, extract_lines, paragraphs
from nyleg.speakers import classify, coverage, parse_label, split_turns


def test_parse_label():
    assert parse_label("ACTING PRESIDENT BRESLIN: The Senate will come to order.") == (
        "ACTING PRESIDENT BRESLIN",
        "The Senate will come to order.",
    )
    assert parse_label("SENATOR ADA SMITH: Thank you.") == ("SENATOR ADA SMITH", "Thank you.")
    assert parse_label("OCFS COMMISSIONER POOLE: Thank you.") == ("OCFS COMMISSIONER POOLE", "Thank you.")
    assert parse_label("MR. PATRICK J. FOYE, CHAIRMAN & CEO, METROPOLITAN TRANSPORTATION AUTHORITY: Thank you.") == (
        "MR. PATRICK J. FOYE, CHAIRMAN & CEO, METROPOLITAN TRANSPORTATION AUTHORITY",
        "Thank you.",
    )
    assert parse_label("PRESIDING:") is None
    assert parse_label("Senator Smith: lower case is not a label") is None
    assert parse_label("(Whereupon, the Senate joined in the Pledge.)") is None


@pytest.mark.parametrize(
    "label,expected",
    [
        ("THE SECRETARY", ("secretary", None)),
        ("THE PRESIDENT", ("president", None)),
        ("ACTING PRESIDENT KUHL", ("presiding", "KUHL")),
        ("SENATOR ADA SMITH", ("senator", "ADA SMITH")),
        ("ASSEMBLYMAN FARRELL", ("assembly", "FARRELL")),
        ("CHAIRWOMAN KRUEGER", ("chair", "KRUEGER")),
        ("MS. MILLER", ("guest", "MS. MILLER")),
        ("SENATOR TIM KENNEDY, CHAIR, SENATE STANDING COMMITTEE ON TRANSPORTATION", ("senator", "TIM KENNEDY")),
        ("ASSEMBLY MEMBER PAULIN", ("assembly", "PAULIN")),
    ],
)
def test_classify(label, expected):
    assert classify(label) == expected


def test_split_turns_attaches_unlabelled_paragraphs_and_carries_page_breaks():
    paras = [
        Paragraph("NEW YORK STATE SENATE", 7582),
        Paragraph("ACTING PRESIDENT BRESLIN: The Senate will come to order.", 7583),
        Paragraph("The Secretary will begin by reading the Journal.", 7583),
        Paragraph("THE SECRETARY: In session, Tuesday.", 7583, [PageBreak(len("THE SECRETARY: In session, "), 7584)]),
        Paragraph("Second paragraph on the new page.", 7585),
    ]
    turns = split_turns(paras)
    assert [t.role for t in turns] == ["record", "presiding", "secretary"]
    assert turns[1].text == "The Senate will come to order.\n\nThe Secretary will begin by reading the Journal."
    assert turns[2].text == "In session, Tuesday.\n\nSecond paragraph on the new page."
    assert [(b.offset, b.page) for b in turns[2].breaks] == [
        (len("In session, "), 7584),
        (len("In session, Tuesday.") + 2, 7585),
    ]
    assert (turns[2].page_start, turns[2].page_end) == (7583, 7585)


def test_coverage_ignores_short_front_matter():
    turns = split_turns([Paragraph("COVER PAGE " * 100, 1), Paragraph("THE SECRETARY: Ayes 48.", 2)])
    assert coverage(turns) == 1.0


def test_coverage_is_zero_when_no_speakers_are_found():
    assert coverage(split_turns([Paragraph("Some text without any labels at all.", 1)])) == 0.0


def turns_for(fixture_text, name):
    return split_turns(paragraphs(extract_lines(fixture_text(name))))


def test_2020_legislative_day_with_only_procedural_voices(fixture_text):
    turns = turns_for(fixture_text, "floor-2020-01-01.txt")
    assert [t.label for t in turns] == [None, "ACTING PRESIDENT BRESLIN", "THE SECRETARY", "ACTING PRESIDENT BRESLIN"]
    assert turns[1].page_start == 7583
    assert turns[1].text.startswith("The Senate will come to order.")
    assert turns[2].text.startswith("In session, Tuesday, December 31, 2019")
    assert coverage(turns) == 1.0


def test_1993_session(fixture_text):
    turns = turns_for(fixture_text, "floor-1993-03-10.txt")
    assert (turns[1].label, turns[1].page_start) == ("ACTING PRESIDENT MEGA", 1081)
    assert turns[1].text.startswith("Senate will come to order.")
    assert (turns[3].label, turns[3].role) == ("REVEREND SELWYN WILKINSON", "guest")


def test_2000_session(fixture_text):
    turns = turns_for(fixture_text, "floor-2000-01-05.txt")
    assert (turns[1].label, turns[1].role, turns[1].page_start) == ("THE PRESIDENT", "president", 2)
    assert any(t.label == "ASSEMBLYMAN FARRELL" and t.role == "assembly" for t in turns)


def test_hearing_skips_front_matter_labels(fixture_text):
    turns = turns_for(fixture_text, "hearing-2011-05-18.txt")
    assert (turns[1].label, turns[1].role, turns[1].page_start) == ("SENATOR VALESKY", "senator", 4)
    assert turns[1].text.startswith("I want to welcome everyone")
    assert (turns[2].label, turns[2].page_start) == ("MS. MILLER", 6)
    assert not any(t.label == "PRESIDING" for t in turns)


def test_vendor_hearing_with_running_headers_footers_and_long_titles(fixture_text):
    turns = turns_for(fixture_text, "hearing-2020-08-25-vendor.txt")
    assert (turns[1].role, turns[1].name, turns[1].page_start) == ("senator", "TIM KENNEDY", 8)
    assert turns[2].label.startswith("MR. PATRICK J. FOYE, CHAIRMAN & CEO")
    assert (turns[3].label, turns[3].page_start, turns[3].text) == ("SENATOR COMRIE", 14, "Yes.")
    assert not any("Geneva Worldwide" in t.text or "Joint Hearing Impact" in t.text for t in turns)
    assert coverage(turns) > 0.95
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_speakers.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.speakers'`.

- [ ] **Step 3: Write the splitter**

`pipeline/nyleg/speakers.py`:

```python
"""Split cleaned paragraphs into speaker turns."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .clean import PageBreak, Paragraph

ROLE_RECORD = "record"
ROLE_SECRETARY = "secretary"
ROLE_PRESIDENT = "president"
ROLE_PRESIDING = "presiding"
ROLE_SENATOR = "senator"
ROLE_ASSEMBLY = "assembly"
ROLE_CHAIR = "chair"
ROLE_GUEST = "guest"

FRONT_MATTER_ALLOWANCE = 3000

_LABEL = re.compile(r"^(?P<label>[A-Z][A-Z0-9.,&'’\- ]{1,90}?)\s*:\s*(?P<rest>.*)$", re.S)
_STOP = {
    "PRESIDING", "PRESENT", "ALSO PRESENT", "ALSO IN ATTENDANCE", "APPEARANCES", "INDEX",
    "SPEAKERS", "LIST OF SPEAKERS", "WITNESSES", "SENATE MEMBERS PRESENT",
    "ROUNDTABLE PARTICIPANTS", "NOTE",
}
_ASSEMBLY = ("ASSEMBLYMAN ", "ASSEMBLYWOMAN ", "ASSEMBLYMEMBER ", "ASSEMBLY MEMBER ")
_CHAIR = ("CHAIRMAN ", "CHAIRWOMAN ", "CHAIRPERSON ", "CHAIR ")


@dataclass
class Turn:
    index: int
    label: str | None
    role: str
    name: str | None
    text: str
    page_start: int | None
    breaks: list[PageBreak] = field(default_factory=list)

    @property
    def page_end(self) -> int | None:
        return self.breaks[-1].page if self.breaks else self.page_start


def parse_label(text: str) -> tuple[str, str] | None:
    m = _LABEL.match(text)
    if not m:
        return None
    label = " ".join(m.group("label").split()).rstrip(".,")
    words = label.split()
    if len(words) > 10 or label in _STOP:
        return None
    if not any(len(w.strip(".,'")) >= 2 for w in words):
        return None
    return label, m.group("rest").strip()


def _name(rest: str) -> str:
    # "TIM KENNEDY, CHAIR, SENATE STANDING COMMITTEE ON TRANSPORTATION" -> "TIM KENNEDY"
    return rest.split(",")[0].strip()


def classify(label: str) -> tuple[str, str | None]:
    if label == "THE SECRETARY":
        return ROLE_SECRETARY, None
    if label == "THE PRESIDENT":
        return ROLE_PRESIDENT, None
    if label.startswith("ACTING PRESIDENT "):
        return ROLE_PRESIDING, _name(label[len("ACTING PRESIDENT "):])
    if label.startswith("SENATOR "):
        return ROLE_SENATOR, _name(label[len("SENATOR "):])
    for prefix in _ASSEMBLY:
        if label.startswith(prefix):
            return ROLE_ASSEMBLY, _name(label[len(prefix):])
    for prefix in _CHAIR:
        if label.startswith(prefix):
            return ROLE_CHAIR, _name(label[len(prefix):])
    return ROLE_GUEST, label


def split_turns(paras: list[Paragraph]) -> list[Turn]:
    turns: list[Turn] = []
    for para in paras:
        parsed = parse_label(para.text)
        if parsed is not None:
            label, rest = parsed
            role, name = classify(label)
            shift = len(para.text) - len(rest)
            breaks = [PageBreak(b.offset - shift, b.page) for b in para.breaks if b.offset - shift > 0]
            page = para.page_start
            early = [b for b in para.breaks if b.offset - shift <= 0]
            if early:
                page = early[-1].page
            turns.append(Turn(len(turns), label, role, name, rest, page, breaks))
            continue
        if not turns:
            turns.append(Turn(0, None, ROLE_RECORD, None, para.text, para.page_start, list(para.breaks)))
            continue
        cur = turns[-1]
        base = len(cur.text) + 2
        if para.page_start is not None and para.page_start != cur.page_end:
            cur.breaks.append(PageBreak(base, para.page_start))
        cur.breaks.extend(PageBreak(base + b.offset, b.page) for b in para.breaks)
        cur.text = f"{cur.text}\n\n{para.text}"
    return turns


def coverage(turns: list[Turn]) -> float:
    total = sum(len(t.text) for t in turns)
    record = sum(len(t.text) for t in turns if t.role == ROLE_RECORD)
    labeled = total - record
    denominator = total - min(record, FRONT_MATTER_ALLOWANCE)
    if denominator <= 0:
        return 1.0 if labeled else 0.0
    return min(1.0, labeled / denominator)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_speakers.py -v`
Expected: 18 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/speakers.py pipeline/tests/test_speakers.py
git commit -m "feat(pipeline): split transcripts into labelled speaker turns with roles"
```

---

### Task 5: Matching speaker labels to senators

**Files:**
- Create: `pipeline/nyleg/senators.py`
- Create: `data/overrides/speakers.yaml`
- Test: `pipeline/tests/test_senators.py`

**Interfaces:**
- Consumes: `slugify` from `nyleg.store`.
- Produces:
  - `session_year(day: date) -> int`
  - `norm(value) -> str`
  - dataclass `Senator(member_id, slug, full_name, first_name, last_name, districts: dict[int, int | None], short_names: dict[int, str])`
  - `Roster(senators: dict[int, Senator])`, with:
    - `Roster.from_members(by_session: dict[int, list[dict]])`, where each item is a `FullMemberView` from `/members/{session}/senate?full=true`, carrying `memberId`, `chamber`, `fullName`, `shortName`, `person{fullName, firstName, lastName}` and `sessionShortNameMap{"2025": [{shortName, districtCode}]}`
    - `Roster.in_session(session)`
    - `Roster.match(name, session) -> int | None`
  - `load_overrides(path) -> dict[tuple[int, str], int | None]`

The API's member records have **no party field**, only the district. The site plan has to show district only, or add party from another source.

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_senators.py`:

```python
from datetime import date

from nyleg.senators import Roster, load_overrides, session_year


def member(member_id, full, first, last, short, district, session):
    return {
        "memberId": member_id,
        "chamber": "SENATE",
        "fullName": full,
        "shortName": short,
        "districtCode": district,
        "person": {"fullName": full, "firstName": first, "lastName": last},
        "sessionShortNameMap": {
            str(session): [{"shortName": short, "districtCode": district, "sessionYear": session, "memberId": member_id}]
        },
    }


def roster():
    return Roster.from_members({
        2009: [
            member(1, "Ada Smith", "Ada", "Smith", "SMITH A", 10, 2009),
            member(2, "Malcolm Smith", "Malcolm", "Smith", "SMITH M", 14, 2009),
            member(3, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 26, 2009),
            {"memberId": 99, "chamber": "ASSEMBLY", "fullName": "Somebody Else", "shortName": "ELSE"},
        ],
        2011: [member(3, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 26, 2011)],
    })


def test_session_year():
    assert session_year(date(2025, 6, 10)) == 2025
    assert session_year(date(2026, 3, 1)) == 2025


def test_simple_surname_matches():
    assert roster().match("KRUEGER", 2009) == 3


def test_full_name_labels_pick_the_right_smith():
    r = roster()
    assert r.match("ADA SMITH", 2009) == 1
    assert r.match("MALCOLM SMITH", 2009) == 2


def test_bare_shared_surname_is_never_guessed():
    assert roster().match("SMITH", 2009) is None


def test_unknown_names_and_sessions_do_not_match():
    r = roster()
    assert r.match("NOBODY", 2009) is None
    assert r.match("SMITH", 2011) is None
    assert r.match("", 2009) is None


def test_assembly_members_are_ignored_and_sessions_accumulate():
    r = roster()
    assert 99 not in r.senators
    krueger = r.senators[3]
    assert krueger.slug == "liz-krueger"
    assert krueger.districts == {2009: 26, 2011: 26}


def test_slugs_stay_unique_when_names_collide():
    r = Roster.from_members({2009: [
        member(5, "John Smith", "John", "Smith", "SMITH J", 1, 2009),
        member(6, "John Smith", "John", "Smith", "SMITH JR", 2, 2009),
    ]})
    assert sorted(s.slug for s in r.senators.values()) == ["john-smith", "john-smith-6"]


def test_overrides(tmp_path):
    path = tmp_path / "speakers.yaml"
    path.write_text("- session: 2009\n  label: senator smith\n  member_id: 2\n- session: 2009\n  label: SENATOR X\n  member_id: null\n")
    assert load_overrides(path) == {(2009, "SENATOR SMITH"): 2, (2009, "SENATOR X"): None}
    assert load_overrides(tmp_path / "missing.yaml") == {}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_senators.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.senators'`.

- [ ] **Step 3: Write the matcher and the overrides file**

`pipeline/nyleg/senators.py`:

```python
"""Match transcript speaker labels to senators using the API's member lists."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from .store import slugify

_NON_LETTERS = re.compile(r"[^A-Z ]+")


def session_year(day: date) -> int:
    """Legislative sessions are two years long and named after the odd year."""
    return day.year if day.year % 2 == 1 else day.year - 1


def norm(value: str | None) -> str:
    return " ".join(_NON_LETTERS.sub(" ", (value or "").upper()).split())


@dataclass
class Senator:
    member_id: int
    slug: str
    full_name: str
    first_name: str
    last_name: str
    districts: dict[int, int | None] = field(default_factory=dict)
    short_names: dict[int, str] = field(default_factory=dict)


class Roster:
    def __init__(self, senators: dict[int, Senator]) -> None:
        self.senators = senators

    @classmethod
    def from_members(cls, by_session: dict[int, list[dict[str, Any]]]) -> "Roster":
        """Build from `/members/{session}/senate?full=true` items, keyed by session year."""
        senators: dict[int, Senator] = {}
        taken: set[str] = set()
        for session in sorted(by_session):
            for item in by_session[session]:
                if (item.get("chamber") or "").upper() != "SENATE":
                    continue
                member_id = int(item["memberId"])
                person = item.get("person") or {}
                senator = senators.get(member_id)
                if senator is None:
                    full = person.get("fullName") or item.get("fullName") or item.get("shortName") or str(member_id)
                    slug = slugify(full)
                    if slug in taken:
                        slug = f"{slug}-{member_id}"
                    taken.add(slug)
                    senator = Senator(member_id, slug, full, person.get("firstName") or "", person.get("lastName") or "")
                    senators[member_id] = senator
                entries = (item.get("sessionShortNameMap") or {}).get(str(session)) or [
                    {"shortName": item.get("shortName"), "districtCode": item.get("districtCode")}
                ]
                senator.short_names[session] = entries[0].get("shortName") or item.get("shortName") or ""
                senator.districts[session] = entries[0].get("districtCode")
        return cls(senators)

    def in_session(self, session: int) -> list[Senator]:
        return [s for s in self.senators.values() if session in s.short_names]

    def match(self, name: str, session: int) -> int | None:
        """Return the member id for a label name like "KRUEGER" or "ADA SMITH". Never guesses."""
        key = norm(name)
        if not key:
            return None
        pool = self.in_session(session)
        for same in (
            lambda s: norm(s.short_names.get(session)) == key,
            lambda s: norm(s.last_name) == key,
        ):
            found = [s for s in pool if same(s)]
            if len(found) == 1:
                return found[0].member_id
            if len(found) > 1:
                return None
        words = key.split()
        if len(words) > 1:
            first, last = words[0], " ".join(words[1:])
            found = [s for s in pool if norm(s.last_name) == last and norm(s.first_name).startswith(first)]
            if len(found) == 1:
                return found[0].member_id
        return None


def load_overrides(path: Path) -> dict[tuple[int, str], int | None]:
    """Manual fixes: a list of {session, label, member_id} (member_id null means "not a senator")."""
    if not path.exists():
        return {}
    rows = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return {
        (int(row["session"]), str(row["label"]).upper()): (
            int(row["member_id"]) if row.get("member_id") is not None else None
        )
        for row in rows
    }
```

`data/overrides/speakers.yaml`:

```yaml
# Manual fixes for speaker labels the matcher gets wrong or can't decide.
# Each entry maps a label in a given session to a senator's member id
# (from data/raw/members/{session}.json). Use member_id: null for a label
# that is not a senator. Example:
#
# - session: 2009
#   label: SENATOR SMITH
#   member_id: 2
[]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_senators.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/senators.py pipeline/tests/test_senators.py data/overrides/speakers.yaml
git commit -m "feat(pipeline): match speaker labels to senators without guessing"
```

---

### Task 6: Bill mentions, calendar segments and bill cards

**Files:**
- Create: `pipeline/nyleg/bills.py`
- Test: `pipeline/tests/test_bills.py`

**Interfaces:**
- Consumes: `Turn`, `classify` and the role constants from `nyleg.speakers`. The tests also use `extract_lines` and `paragraphs` from `nyleg.clean`.
- Produces:
  - constants `BILL_DATA_START = 2009` and `DEBATE_WORDS = 40`
  - `print_no(chamber, num, amd) -> "S4597A"`
  - `base_print_no("S4597A") -> "S4597"`
  - `find_bills(text) -> list[str]`, unique and in order of appearance
  - dataclass `Segment(cal_no, print_no, sponsor, start_turn, end_turn, debated, outcome, ayes, nays)`, where `end_turn` is exclusive and `outcome` is one of `"passed"`, `"lost"`, `"laid_aside"` or `None`
  - `segment_calendar(turns) -> list[Segment]`
  - `bill_card(raw: dict) -> dict`, with the keys `printNo`, `basePrintNo`, `session`, `title`, `sponsor{memberId, name, shortName}|None`, `status{type, text, date}`, `milestones[]`, `signed`, `vetoed`, `floorVotes[{date, version, counts{AYE: n, …}}]` and `sameAs[]`

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_bills.py`:

```python
from nyleg.bills import base_print_no, bill_card, find_bills, segment_calendar
from nyleg.clean import extract_lines, paragraphs
from nyleg.speakers import Turn, classify, split_turns


def test_find_bills_handles_the_common_spellings():
    text = (
        "Senate Print 4597-A, an act. Assembly Print Number 64A and Senate Bill Number 1986. "
        "Again Senate Print 4597-A. Senate Print 887, an act."
    )
    assert find_bills(text) == ["S4597A", "A64A", "S1986", "S887"]


def test_base_print_no():
    assert base_print_no("S4597A") == "S4597"
    assert base_print_no("A64") == "A64"


def turn(i, label, text):
    role, name = classify(label)
    return Turn(i, label, role, name, text, 100)


def test_segments_know_the_outcome_and_whether_there_was_a_debate():
    turns = [
        turn(0, "THE SECRETARY", "Calendar Number 88, by Senator Volker, Senate Print 887, an act to amend the Criminal Procedure Law."),
        turn(1, "SENATOR GOLD", "Lay it aside."),
        turn(2, "ACTING PRESIDENT KUHL", "Lay the bill aside."),
        turn(3, "THE SECRETARY", "Calendar Number 144, by Senator Libous, Senate Print 1914-A, an act to amend the Penal Law."),
        turn(4, "SENATOR LEICHTER", "Explanation. " + "word " * 60),
        turn(5, "THE SECRETARY", "Ayes 41. Nays 20."),
        turn(6, "ACTING PRESIDENT KUHL", "The bill is passed."),
    ]
    first, second = segment_calendar(turns)
    assert (first.cal_no, first.print_no, first.sponsor, first.outcome, first.debated) == (88, "S887", "Volker", "laid_aside", False)
    assert (second.print_no, second.outcome, second.debated, second.ayes, second.nays) == ("S1914A", "passed", True, 41, 20)
    assert (first.start_turn, first.end_turn, second.start_turn, second.end_turn) == (0, 3, 3, 7)


def test_speech_after_the_result_is_not_a_debate():
    turns = [
        turn(0, "THE SECRETARY", "Calendar Number 5, by Senator Hannon, Senate Print 10, an act."),
        turn(1, "THE SECRETARY", "Ayes 60."),
        turn(2, "ACTING PRESIDENT KUHL", "The bill is passed."),
        turn(3, "SENATOR BRUNO", "Motion to adjourn " + "word " * 60),
    ]
    (segment,) = segment_calendar(turns)
    assert (segment.debated, segment.outcome, segment.ayes, segment.nays) == (False, "passed", 60, None)


def test_bill_mention_split_by_a_line_wrap_and_a_page_break_is_still_found():
    raw = (
        "                                                               1519\n\n"
        " 24              THE SECRETARY:   Calendar Number\n\n"
        " 25   140, by Senator Spano, Senate Print\n\n"
        "                                                               1520\n\n"
        " 1   882-A, an act to amend the Penal Law.\n"
    )
    turns = split_turns(paragraphs(extract_lines(raw)))
    assert find_bills(turns[0].text) == ["S882A"]
    (segment,) = segment_calendar(turns)
    assert (segment.cal_no, segment.print_no, segment.sponsor) == (140, "S882A", "Spano")
    assert turns[0].page_start == 1519 and turns[0].page_end == 1520


def test_real_1998_calendar(fixture_text):
    turns = split_turns(paragraphs(extract_lines(fixture_text("floor-1998-03-10.txt"))))
    segments = segment_calendar(turns)
    assert [(s.cal_no, s.print_no, s.outcome, s.debated) for s in segments[:3]] == [
        (88, "S887", "laid_aside", False),
        (140, "S882A", "passed", False),
        (144, "S1914A", "passed", True),
    ]
    assert segments[1].ayes == 48


RAW_BILL = {
    "basePrintNo": "S4597",
    "session": 2025,
    "printNo": "S4597A",
    "activeVersion": "A",
    "title": "Relates to the central business district tolling program",
    "sponsor": {"member": {"memberId": 1, "shortName": "ORTEGA", "fullName": "Marisol Ortega"}, "budget": False},
    "signed": False,
    "vetoed": False,
    "status": {"statusType": "PASSED_SENATE", "statusDesc": "Passed Senate", "actionDate": "2025-06-10", "billCalNo": 412},
    "milestones": {"items": [
        {"statusType": "INTRODUCED", "statusDesc": "Introduced", "actionDate": "2025-01-08"},
        {"statusType": "PASSED_SENATE", "statusDesc": "Passed Senate", "actionDate": "2025-06-10"},
    ]},
    "votes": {"items": [
        {"version": "A", "voteType": "FLOOR", "voteDate": "2025-06-10",
         "memberVotes": {"items": {"AYE": {"items": [{"memberId": 1}, {"memberId": 2}]}, "NAY": {"items": [{"memberId": 3}]}}}},
        {"version": "", "voteType": "COMMITTEE", "voteDate": "2025-02-04",
         "memberVotes": {"items": {"AYE": {"items": [{"memberId": 1}]}}}},
    ]},
    "amendments": {"items": {"A": {"sameAs": {"items": [{"basePrintNo": "A8812", "session": 2025, "printNo": "A8812"}]}}}},
}


def test_bill_card_extracts_what_the_site_shows():
    card = bill_card(RAW_BILL)
    assert card["printNo"] == "S4597A"
    assert card["sponsor"] == {"memberId": 1, "name": "Marisol Ortega", "shortName": "ORTEGA"}
    assert card["status"] == {"type": "PASSED_SENATE", "text": "Passed Senate", "date": "2025-06-10"}
    assert [m["text"] for m in card["milestones"]] == ["Introduced", "Passed Senate"]
    assert card["floorVotes"] == [{"date": "2025-06-10", "version": "A", "counts": {"AYE": 2, "NAY": 1}}]
    assert card["sameAs"] == ["A8812"]


def test_bill_card_tolerates_missing_sections():
    card = bill_card({"basePrintNo": "S1", "session": 2009, "printNo": "S1"})
    assert card["sponsor"] is None
    assert card["floorVotes"] == [] and card["milestones"] == [] and card["sameAs"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_bills.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.bills'`.

- [ ] **Step 3: Write the bills module**

`pipeline/nyleg/bills.py`:

```python
"""Find bill mentions, split floor calendars into per-bill segments, and summarise bill records."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .speakers import ROLE_CHAIR, ROLE_PRESIDENT, ROLE_PRESIDING, ROLE_SECRETARY, ROLE_SENATOR, Turn

BILL_DATA_START = 2009  # first session with bill details in the API (to confirm with a live key)
DEBATE_WORDS = 40

_BILL = re.compile(
    r"\b(?P<chamber>Senate|Assembly) (?:Print|Bill) (?:Number |No\. ?)?(?P<num>\d{1,5})(?:-?(?P<amd>[A-Z])\b)?"
)
_CAL = re.compile(
    r"^Calendar Number (?P<cal>\d+), by Senators? (?P<sponsor>[^,]+), "
    r"(?P<chamber>Senate|Assembly) Print (?:Number )?(?P<num>\d{1,5})(?:-?(?P<amd>[A-Z])\b)?"
)
_AYES = re.compile(r"\bAyes,? (?P<ayes>\d+)\.?(?: Nays,? (?P<nays>\d+))?")
_PASSED = re.compile(r"\bbill is passed\b", re.I)
_LOST = re.compile(r"\bbill is lost\b|\bbill is defeated\b", re.I)
_ASIDE = re.compile(r"\blay (?:it|the bill) aside\b|\blaid aside\b", re.I)
_BASE = re.compile(r"^([SA]\d+)[A-Z]?$")


def print_no(chamber: str, num: str, amd: str | None) -> str:
    return f"{'S' if chamber == 'Senate' else 'A'}{int(num)}{amd or ''}"


def base_print_no(value: str) -> str:
    m = _BASE.match(value)
    return m.group(1) if m else value


def find_bills(text: str) -> list[str]:
    found: list[str] = []
    for m in _BILL.finditer(text):
        p = print_no(m["chamber"], m["num"], m["amd"])
        if p not in found:
            found.append(p)
    return found


@dataclass
class Segment:
    cal_no: int
    print_no: str
    sponsor: str
    start_turn: int
    end_turn: int  # exclusive
    debated: bool
    outcome: str | None  # "passed" | "lost" | "laid_aside" | None
    ayes: int | None
    nays: int | None


def segment_calendar(turns: list[Turn]) -> list[Segment]:
    """One segment per calendar item, from the Secretary's reading to the next reading."""
    starts = [(i, m) for i, t in enumerate(turns) if t.role == ROLE_SECRETARY and (m := _CAL.match(t.text))]
    segments: list[Segment] = []
    for n, (i, m) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(turns)
        outcome: str | None = None
        ayes: int | None = None
        nays: int | None = None
        words = 0
        for t in turns[i + 1:end]:
            if t.role in (ROLE_SENATOR, ROLE_CHAIR):
                words += len(t.text.split())
            if t.role == ROLE_SECRETARY and (v := _AYES.search(t.text)):
                ayes = int(v["ayes"])
                nays = int(v["nays"]) if v["nays"] else None
            if t.role in (ROLE_PRESIDING, ROLE_PRESIDENT):
                if _ASIDE.search(t.text):
                    outcome = "laid_aside"
                elif _PASSED.search(t.text):
                    outcome = "passed"
                elif _LOST.search(t.text):
                    outcome = "lost"
                if outcome:
                    break
        segments.append(Segment(
            cal_no=int(m["cal"]),
            print_no=print_no(m["chamber"], m["num"], m["amd"]),
            sponsor=m["sponsor"].strip(),
            start_turn=i,
            end_turn=end,
            debated=words >= DEBATE_WORDS,
            outcome=outcome,
            ayes=ayes,
            nays=nays,
        ))
    return segments


def bill_card(raw: dict[str, Any]) -> dict[str, Any]:
    """The bill fields the site shows, from a `/bills/{session}/{printNo}?view=no_fulltext` result."""
    sponsor = (raw.get("sponsor") or {}).get("member") or {}
    status = raw.get("status") or {}
    active = raw.get("activeVersion") or ""
    amendment = ((raw.get("amendments") or {}).get("items") or {}).get(active) or {}

    def counts(vote: dict[str, Any]) -> dict[str, int]:
        groups = (vote.get("memberVotes") or {}).get("items") or {}
        return {code: len(group.get("items") or []) for code, group in groups.items()}

    return {
        "printNo": raw.get("printNo") or raw.get("basePrintNo"),
        "basePrintNo": raw.get("basePrintNo"),
        "session": raw.get("session"),
        "title": raw.get("title"),
        "sponsor": {
            "memberId": sponsor.get("memberId"),
            "name": sponsor.get("fullName"),
            "shortName": sponsor.get("shortName"),
        } if sponsor else None,
        "status": {"type": status.get("statusType"), "text": status.get("statusDesc"), "date": status.get("actionDate")},
        "milestones": [
            {"type": m.get("statusType"), "text": m.get("statusDesc"), "date": m.get("actionDate")}
            for m in (raw.get("milestones") or {}).get("items") or []
        ],
        "signed": bool(raw.get("signed")),
        "vetoed": bool(raw.get("vetoed")),
        "floorVotes": [
            {"date": v.get("voteDate"), "version": v.get("version"), "counts": counts(v)}
            for v in (raw.get("votes") or {}).get("items") or []
            if v.get("voteType") == "FLOOR"
        ],
        "sameAs": [s.get("printNo") or s.get("basePrintNo") for s in (amendment.get("sameAs") or {}).get("items") or []],
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_bills.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/bills.py pipeline/tests/test_bills.py
git commit -m "feat(pipeline): find bill mentions, segment floor calendars, summarise bills"
```

---

### Task 7: Syncing from the API into the raw store

**Files:**
- Create: `pipeline/nyleg/sync.py`
- Test: `pipeline/tests/test_sync.py`

**Interfaces:**
- Consumes:
  - `NotFound` (`nyleg.api`)
  - `BILL_DATA_START`, `base_print_no` and `find_bills` (`nyleg.bills`)
  - `extract_lines` and `paragraphs` (`nyleg.clean`)
  - `session_year` (`nyleg.senators`)
  - `Store`, `read_json` and `write_json` (`nyleg.store`)
- Produces:
  - dataclass `SyncResult(changed: list[Path])`, with `.merge(other)`
  - `save_transcript(store, item, today=None)` and `save_hearing(store, item, today=None)`, which return the path when the file changed. When an already-stored record's `text` changes, the date goes into `data/corrections.json`.
  - `backfill_transcripts(client, store, years)` and `backfill_hearings(client, store, years)`, which resume using `state["backfill"][kind]`
  - `sync_transcript_updates(client, store, now: datetime)`, where `now` is naive New York time. It uses `/transcripts/updates/{since}/{now}` with a 10-minute overlap and a 7-day first look-back, and stores `state["transcripts_synced_at"]`.
  - `sync_hearings_year(client, store, year)`
  - `sync_members(client, store, session)`
  - `wanted_bills(paths) -> set[tuple[int, str]]`
  - `fetch_bills(client, store, wanted, budget) -> SyncResult`, which keeps `state["bills_pending"]` and `state["bills_missing"]`

All of these return a `SyncResult`. The `client` parameter is anything with `get` and `iter_items`, matching `nyleg.api.Client`.

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_sync.py`:

```python
from datetime import date, datetime
from urllib.parse import quote

import pytest

from nyleg.api import ApiError, NotFound
from nyleg.store import Store, read_json, write_json
from nyleg.sync import (
    backfill_hearings,
    backfill_transcripts,
    fetch_bills,
    save_transcript,
    sync_hearings_year,
    sync_members,
    sync_transcript_updates,
    wanted_bills,
)


class FakeClient:
    def __init__(self, pages=None, singles=None, fail_on=None):
        self.pages = pages or {}
        self.singles = singles or {}
        self.fail_on = fail_on
        self.calls = []

    def iter_items(self, path, **params):
        self.calls.append(path)
        if path == self.fail_on:
            raise ApiError("down")
        yield from self.pages.get(path, [])

    def get(self, path, **params):
        self.calls.append(path)
        if path not in self.singles:
            raise NotFound(path)
        return {"success": True, "result": self.singles[path]}


def transcript(date_time, text="THE SECRETARY: Hello."):
    return {"dateTime": date_time, "sessionType": "Regular Session", "text": text}


def test_backfill_resumes_after_an_interruption(tmp_path):
    store = Store(tmp_path)
    client = FakeClient(
        {"/transcripts/1993": [transcript("1993-01-06T12:00")], "/transcripts/1994": [transcript("1994-01-05T12:00")]},
        fail_on="/transcripts/1994",
    )
    with pytest.raises(ApiError):
        backfill_transcripts(client, store, [1993, 1994])
    assert store.load_state()["backfill"]["transcripts"] == [1993]
    client.fail_on = None
    client.calls.clear()
    result = backfill_transcripts(client, store, [1993, 1994])
    assert client.calls == ["/transcripts/1994"]
    assert len(result.changed) == 1


def test_resyncing_identical_data_reports_no_changes(tmp_path):
    store = Store(tmp_path)
    client = FakeClient({"/transcripts/1993": [transcript("1993-01-06T12:00")]})
    assert len(backfill_transcripts(client, store, [1993]).changed) == 1
    state = store.load_state()
    state["backfill"]["transcripts"] = []
    store.save_state(state)
    assert backfill_transcripts(client, store, [1993]).changed == []


def test_changed_text_is_recorded_as_a_correction(tmp_path):
    store = Store(tmp_path)
    first = transcript("2025-06-10T11:00", "THE SECRETARY: Ayes 40.")
    assert save_transcript(store, first, today=date(2025, 6, 10)) is not None
    assert read_json(store.corrections_path) is None
    same_text_new_field = {**first, "dayType": "SESSION"}
    save_transcript(store, same_text_new_field, today=date(2025, 6, 11))
    assert read_json(store.corrections_path) is None
    save_transcript(store, transcript("2025-06-10T11:00", "THE SECRETARY: Ayes 41."), today=date(2025, 6, 12))
    assert read_json(store.corrections_path) == {"transcripts/2025/2025-06-10T1100__regular-session.json": "2025-06-12"}


def test_hearings_are_keyed_by_filename(tmp_path):
    store = Store(tmp_path)
    hearing = {"id": 1234, "filename": "05-18-11 Valesky Aging.txt", "date": "2011-05-18", "text": "x"}
    client = FakeClient({"/hearings/2011": [hearing]})
    result = backfill_hearings(client, store, [2011])
    assert result.changed == [store.hearing_path(2011, "05-18-11 Valesky Aging.txt")]
    assert sync_hearings_year(client, store, 2011).changed == []


def test_updates_fetch_each_changed_transcript_and_move_the_window(tmp_path):
    store = Store(tmp_path)
    now = datetime(2025, 6, 10, 18, 0, 0)
    updates = "/transcripts/updates/2025-06-03T18:00:00/2025-06-10T18:00:00"
    single = f"/transcripts/{quote('2025-06-10T11:00')}/{quote('Regular Session')}"
    client = FakeClient(
        {updates: [{"transcriptId": {"dateTime": "2025-06-10T11:00", "sessionType": "Regular Session"}}]},
        {single: transcript("2025-06-10T11:00")},
    )
    assert len(sync_transcript_updates(client, store, now).changed) == 1
    assert store.load_state()["transcripts_synced_at"] == "2025-06-10T18:00:00"
    later = FakeClient()
    sync_transcript_updates(later, store, datetime(2025, 6, 10, 19, 0, 0))
    assert later.calls == ["/transcripts/updates/2025-06-10T17:50:00/2025-06-10T19:00:00"]


def test_members_are_saved_per_session(tmp_path):
    store = Store(tmp_path)
    client = FakeClient({"/members/2025/senate": [{"memberId": 1}]})
    assert sync_members(client, store, 2025).changed == [store.members_path(2025)]
    assert sync_members(client, store, 2025).changed == []


def test_wanted_bills_reads_mentions_from_cleaned_text_and_skips_old_sessions(tmp_path):
    store = Store(tmp_path)
    recent = store.transcript_path("2025-06-10T11:00", "Regular Session")
    write_json(recent, transcript(
        "2025-06-10T11:00",
        "                    THE SECRETARY:  Calendar Number 412, by\n"
        "        Senator Ortega, Senate Print 4597-A, an act.\n",
    ))
    old = store.transcript_path("1998-03-10T15:10", "Regular Session")
    write_json(old, transcript("1998-03-10T15:10", "THE SECRETARY: Senate Print 887, an act.\n"))
    assert wanted_bills([recent, old]) == {(2025, "S4597")}


def test_fetch_bills_respects_the_budget_and_remembers_missing_bills(tmp_path):
    store = Store(tmp_path)
    client = FakeClient(singles={"/bills/2025/S1": {"basePrintNo": "S1", "session": 2025}})
    fetch_bills(client, store, {(2025, "S1"), (2025, "S2"), (2025, "S3")}, budget=2)
    assert store.bill_path(2025, "S1").exists()
    state = store.load_state()
    assert state["bills_missing"] == [[2025, "S2"]]
    assert state["bills_pending"] == [[2025, "S3"]]
    client.calls.clear()
    fetch_bills(client, store, set(), budget=5)
    assert client.calls == ["/bills/2025/S3"]
    assert store.load_state()["bills_pending"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_sync.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.sync'`.

- [ ] **Step 3: Write the sync module**

`pipeline/nyleg/sync.py`:

```python
"""Download new and changed records from the API into the raw store."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from .api import NotFound
from .bills import BILL_DATA_START, base_print_no, find_bills
from .clean import extract_lines, paragraphs
from .senators import session_year
from .store import Store, read_json, write_json

UPDATE_OVERLAP = timedelta(minutes=10)
FIRST_LOOKBACK = timedelta(days=7)


class ApiClient(Protocol):
    def get(self, path: str, **params: Any) -> dict[str, Any]: ...
    def iter_items(self, path: str, **params: Any) -> Iterable[dict[str, Any]]: ...


@dataclass
class SyncResult:
    changed: list[Path] = field(default_factory=list)

    def merge(self, other: "SyncResult") -> "SyncResult":
        self.changed.extend(other.changed)
        return self


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat()


def _save(store: Store, path: Path, item: dict[str, Any], today: date | None = None) -> Path | None:
    """Write a raw record; if its transcript text changed, remember it as a correction."""
    old = read_json(path)
    if not write_json(path, item):
        return None
    if old is not None and old.get("text") != item.get("text"):
        corrections = read_json(store.corrections_path, {}) or {}
        corrections[store.raw_key(path)] = (today or date.today()).isoformat()
        write_json(store.corrections_path, corrections)
    return path


def save_transcript(store: Store, item: dict[str, Any], today: date | None = None) -> Path | None:
    return _save(store, store.transcript_path(item["dateTime"], item["sessionType"]), item, today)


def hearing_key(item: dict[str, Any]) -> str:
    # Hearing ids of 1000+ can't be fetched by id, so the filename is the durable key.
    return item.get("filename") or str(item["id"])


def save_hearing(store: Store, item: dict[str, Any], today: date | None = None) -> Path | None:
    return _save(store, store.hearing_path(int(str(item["date"])[:4]), hearing_key(item)), item, today)


def _backfill(client: ApiClient, store: Store, years: Iterable[int], kind: str) -> SyncResult:
    result = SyncResult()
    state = store.load_state()
    done = set(state.get("backfill", {}).get(kind, []))
    for year in years:
        if year in done:
            continue
        if kind == "transcripts":
            items = client.iter_items(f"/transcripts/{year}", full=True, sessionOnly=False)
            save = save_transcript
        else:
            items = client.iter_items(f"/hearings/{year}", full=True)
            save = save_hearing
        for item in items:
            path = save(store, item)
            if path:
                result.changed.append(path)
        done.add(year)
        state.setdefault("backfill", {})[kind] = sorted(done)
        store.save_state(state)
    return result


def backfill_transcripts(client: ApiClient, store: Store, years: Iterable[int]) -> SyncResult:
    """Download whole years of floor transcripts; resumes after the last finished year."""
    return _backfill(client, store, years, "transcripts")


def backfill_hearings(client: ApiClient, store: Store, years: Iterable[int]) -> SyncResult:
    return _backfill(client, store, years, "hearings")


def sync_transcript_updates(client: ApiClient, store: Store, now: datetime) -> SyncResult:
    """Fetch floor transcripts added or corrected since the last run. `now` is naive New York time."""
    state = store.load_state()
    last = state.get("transcripts_synced_at")
    since = datetime.fromisoformat(last) - UPDATE_OVERLAP if last else now - FIRST_LOOKBACK
    result = SyncResult()
    for item in client.iter_items(f"/transcripts/updates/{_iso(since)}/{_iso(now)}"):
        tid = item["transcriptId"]
        body = client.get(f"/transcripts/{quote(tid['dateTime'])}/{quote(tid['sessionType'])}")
        path = save_transcript(store, body["result"])
        if path:
            result.changed.append(path)
    state["transcripts_synced_at"] = _iso(now)
    store.save_state(state)
    return result


def sync_hearings_year(client: ApiClient, store: Store, year: int) -> SyncResult:
    result = SyncResult()
    for item in client.iter_items(f"/hearings/{year}", full=True):
        path = save_hearing(store, item)
        if path:
            result.changed.append(path)
    return result


def sync_members(client: ApiClient, store: Store, session: int) -> SyncResult:
    items = list(client.iter_items(f"/members/{session}/senate", full=True))
    path = store.members_path(session)
    return SyncResult([path] if write_json(path, items) else [])


def wanted_bills(paths: Iterable[Path]) -> set[tuple[int, str]]:
    """(session, base print number) for every bill mentioned in these raw transcripts."""
    wanted: set[tuple[int, str]] = set()
    for path in paths:
        raw = read_json(path) or {}
        when = str(raw.get("dateTime") or raw.get("date") or "")[:10]
        if not when:
            continue
        session = session_year(date.fromisoformat(when))
        if session < BILL_DATA_START:
            continue
        for para in paragraphs(extract_lines(raw.get("text") or "")):
            for p in find_bills(para.text):
                wanted.add((session, base_print_no(p)))
    return wanted


def fetch_bills(client: ApiClient, store: Store, wanted: Iterable[tuple[int, str]], budget: int) -> SyncResult:
    """Fetch up to `budget` bills not stored yet; remember the rest and the ones the API lacks."""
    state = store.load_state()
    pending = {tuple(x) for x in state.get("bills_pending", [])} | set(wanted)
    missing = {tuple(x) for x in state.get("bills_missing", [])}
    result = SyncResult()
    used = 0
    for session, base in sorted(pending):
        if (session, base) in missing or store.bill_path(session, base).exists():
            continue
        if used >= budget:
            break
        used += 1
        try:
            body = client.get(f"/bills/{session}/{base}", view="no_fulltext")
        except NotFound:
            missing.add((session, base))
            continue
        path = store.bill_path(session, base)
        if write_json(path, body["result"]):
            result.changed.append(path)
    left = {p for p in pending if p not in missing and not store.bill_path(*p).exists()}
    state["bills_pending"] = [list(p) for p in sorted(left)]
    state["bills_missing"] = [list(p) for p in sorted(missing)]
    store.save_state(state)
    return result
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_sync.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/sync.py pipeline/tests/test_sync.py
git commit -m "feat(pipeline): resumable backfill, hourly updates, members and bill fetching"
```

---

### Task 8: The quality report and deploy gate

**Files:**
- Create: `pipeline/nyleg/quality.py`
- Test: `pipeline/tests/test_quality.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - dataclass `Report`, with the fields `floor`, `hearings`, `chars_total`, `chars_attributed`, `bill_mentions`, `bill_mentions_linked`, `plain_text: list[str]`, `unmatched: Counter` and `per_year: Counter`
  - the properties `attribution` and `bill_link_rate`, which are 1.0 when empty
  - `to_dict()`, with the keys `floorTranscripts`, `hearings`, `attribution`, `billLinkRate`, `plainText`, `unmatchedLabels` and `perYear`
  - `gate(previous: dict | None, current: Report, max_drop_points=2.0) -> list[str]`

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_quality.py`:

```python
from nyleg.quality import Report, gate


def report(attributed=980, linked=96):
    r = Report(floor=2, hearings=1, chars_total=1000, chars_attributed=attributed, bill_mentions=100, bill_mentions_linked=linked)
    r.plain_text.append("1994-01-05-regular-session")
    r.unmatched["2025 SENATOR NOBODY"] += 3
    r.per_year[2025] += 2
    return r


def test_to_dict():
    d = report().to_dict()
    assert d["attribution"] == 0.98
    assert d["billLinkRate"] == 0.96
    assert d["plainText"] == ["1994-01-05-regular-session"]
    assert d["unmatchedLabels"] == {"2025 SENATOR NOBODY": 3}
    assert d["perYear"] == {"2025": 2}


def test_empty_report_counts_as_perfect():
    assert Report().attribution == 1.0
    assert Report().bill_link_rate == 1.0


def test_gate_allows_small_wobbles_and_first_runs():
    assert gate(None, report()) == []
    assert gate({"attribution": 0.99, "billLinkRate": 0.97}, report()) == []


def test_gate_blocks_a_real_drop():
    problems = gate({"attribution": 0.99, "billLinkRate": 0.96}, report(attributed=950))
    assert problems == ["Text matched to speakers dropped 4.0 points (99.0% -> 95.0%)"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_quality.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.quality'`.

- [ ] **Step 3: Write the quality module**

`pipeline/nyleg/quality.py`:

```python
"""Measure parse quality and block deploys that make it worse."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Report:
    floor: int = 0
    hearings: int = 0
    chars_total: int = 0
    chars_attributed: int = 0
    bill_mentions: int = 0
    bill_mentions_linked: int = 0
    plain_text: list[str] = field(default_factory=list)
    unmatched: Counter = field(default_factory=Counter)
    per_year: Counter = field(default_factory=Counter)

    @property
    def attribution(self) -> float:
        return self.chars_attributed / self.chars_total if self.chars_total else 1.0

    @property
    def bill_link_rate(self) -> float:
        return self.bill_mentions_linked / self.bill_mentions if self.bill_mentions else 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "floorTranscripts": self.floor,
            "hearings": self.hearings,
            "attribution": round(self.attribution, 4),
            "billLinkRate": round(self.bill_link_rate, 4),
            "plainText": sorted(self.plain_text),
            "unmatchedLabels": dict(self.unmatched.most_common(200)),
            "perYear": {str(year): count for year, count in sorted(self.per_year.items())},
        }


def gate(previous: dict[str, Any] | None, current: Report, max_drop_points: float = 2.0) -> list[str]:
    """Problems that should block a deploy: a quality measure fell by more than `max_drop_points`."""
    if not previous:
        return []
    problems: list[str] = []
    for key, label, now in (
        ("attribution", "Text matched to speakers", current.attribution),
        ("billLinkRate", "Bill mentions linked", current.bill_link_rate),
    ):
        before = previous.get(key)
        if before is None:
            continue
        drop = (float(before) - now) * 100
        if drop > max_drop_points:
            problems.append(f"{label} dropped {drop:.1f} points ({float(before) * 100:.1f}% -> {now * 100:.1f}%)")
    return problems
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_quality.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/quality.py pipeline/tests/test_quality.py
git commit -m "feat(pipeline): add quality report and the 2-point deploy gate"
```

---

### Task 9: Building the site data contract

**Files:**
- Create: `pipeline/nyleg/sitedata.py`
- Test: `pipeline/tests/test_sitedata.py`

**Interfaces:**
- Consumes everything above.
- Produces:
  - `transcript_slug(kind, raw) -> str`, giving for example `"2025-06-10-regular-session"` or `"2011-05-18-committee-for-the-aging-roundtable"`
  - `build_transcript(kind, raw, roster, overrides, slug) -> dict`
  - `load_roster(store) -> Roster`
  - `build_all(store, out: Path, now: datetime, overrides_path=None) -> Report`, which deletes and rebuilds `out`

**Output shapes (the contract Plan 2's site reads):**
- `transcripts/{slug}.json`:
  - top-level fields: `kind` ("floor" or "hearing"), `slug`, `date`, `session`, `sessionType`, `dayType`, `title`, `location`, `committees[]`, `pages[first, last]|null`, `coverage`, `plainText`, `corrected` (the date of the last correction, or null)
  - `turns[]`: each turn has `i`, `label`, `role`, `senator` (a slug or null), `text` (paragraphs joined with a blank line), `page`, `breaks[[offset, page]]` and `bills[]`
  - `segments[]`: each segment has `calNo`, `printNo`, `sponsor`, `startTurn`, `endTurn`, `debated`, `outcome`, `ayes`, `nays`, `remarks`, `speakers{slug: count}` and `pages`
- `bills/{session}.json`: `{session, bills[{basePrintNo, session, card|null, segments[{transcript, date, …segment}]}]}`
- `senators.json`: `[{slug, memberId, name, sessions{year: district}, remarks, transcripts}]`, sorted by last name
- `senators/{slug}.json`: `{slug, memberId, name, sessions, totals{remarks, transcripts}, appearances[{transcript, date, kind, title, remarks, firstTurn, firstPage}], bills[{session, basePrintNo, printNo, remarks, sponsor}]}`
- `words/{prefix}.json`: `{word: count}`, for words of 4 or more letters seen at least twice
- `meta.json`: `{updatedAt, counts{floorTranscripts, hearings, senators, bills}, quality}`

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_sitedata.py`:

```python
from datetime import datetime

from nyleg.senators import Roster
from nyleg.sitedata import build_all, build_transcript, transcript_slug
from nyleg.store import Store, read_json, write_json

TEXT_2025 = """                                                               5780

 1               THE SECRETARY:   Calendar Number 412, by Senator
 2   Ortega, Senate Print 4597-A, an act to amend the vehicle and
 3   traffic law.
 4               SENATOR ORTEGA:   Thank you, Mr. President.  This
 5   bill does one thing.  It says the congestion pricing program
 6   has to answer to the riders in my district before it answers
 7   to anyone else in this building, and it requires the authority
 8   to publish where each dollar collected in the zone is spent.
 9               THE SECRETARY:   Ayes, 41.  Nays, 20.
10               ACTING PRESIDENT BRENNAN:   The bill is passed.
"""


def member(member_id, full, first, last, short, session):
    return {
        "memberId": member_id, "chamber": "SENATE", "fullName": full, "shortName": short,
        "person": {"fullName": full, "firstName": first, "lastName": last},
        "sessionShortNameMap": {str(session): [{"shortName": short, "districtCode": member_id + 10}]},
    }


MEMBERS = {
    2025: [member(1, "Marisol Ortega", "Marisol", "Ortega", "ORTEGA", 2025),
           member(2, "Paul Brennan", "Paul", "Brennan", "BRENNAN", 2025)],
    1997: [member(7, "Franz Leichter", "Franz", "Leichter", "LEICHTER", 1997),
           member(8, "Emanuel Gold", "Emanuel", "Gold", "GOLD", 1997)],
}


def floor(date_time, text):
    return {"dateTime": date_time, "sessionType": "Regular Session", "location": "ALBANY, NEW YORK", "dayType": "SESSION", "text": text}


def test_slugs():
    assert transcript_slug("floor", floor("2025-06-10T11:00", "")) == "2025-06-10-regular-session"
    hearing = {"date": "2011-05-18", "title": "Committee for the Aging: roundtable"}
    assert transcript_slug("hearing", hearing) == "2011-05-18-committee-for-the-aging-roundtable"


def test_build_transcript_links_senators_bills_and_the_debate():
    roster = Roster.from_members(MEMBERS)
    doc = build_transcript("floor", floor("2025-06-10T11:00", TEXT_2025), roster, {}, "2025-06-10-regular-session")
    assert doc["session"] == 2025 and doc["plainText"] is False and doc["pages"] == [5780, 5780]
    roles = [(t["label"], t["senator"]) for t in doc["turns"]]
    assert roles == [
        ("THE SECRETARY", None),
        ("SENATOR ORTEGA", "marisol-ortega"),
        ("THE SECRETARY", None),
        ("ACTING PRESIDENT BRENNAN", "paul-brennan"),
    ]
    assert doc["turns"][0]["bills"] == ["S4597A"]
    (segment,) = doc["segments"]
    assert segment["printNo"] == "S4597A" and segment["outcome"] == "passed"
    assert (segment["ayes"], segment["nays"], segment["debated"]) == (41, 20, True)
    assert segment["speakers"] == {"marisol-ortega": 1}


def test_overrides_win_over_the_matcher():
    roster = Roster.from_members(MEMBERS)
    doc = build_transcript("floor", floor("2025-06-10T11:00", TEXT_2025), roster, {(2025, "SENATOR ORTEGA"): 2}, "x")
    assert doc["turns"][1]["senator"] == "paul-brennan"


def test_unlabelled_text_falls_back_to_plain_text():
    raw = floor("1994-01-05T12:00", "         1       Some words with no speakers.\n         2       More words.\n")
    doc = build_transcript("floor", raw, Roster({}), {}, "x")
    assert doc["plainText"] is True
    assert [t["role"] for t in doc["turns"]] == ["record"]
    assert doc["segments"] == []


def test_build_all_writes_the_whole_contract(tmp_path, fixture_text):
    store = Store(tmp_path / "data")
    for session, items in MEMBERS.items():
        write_json(store.members_path(session), items)
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", TEXT_2025))
    write_json(store.transcript_path("1998-03-10T15:10", "Regular Session"), floor("1998-03-10T15:10", fixture_text("floor-1998-03-10.txt")))
    write_json(store.transcript_path("2020-01-01T11:00", "Regular Session"), floor("2020-01-01T11:00", fixture_text("floor-2020-01-01.txt")))
    write_json(store.hearing_path(2011, "05-18-11 Valesky Aging.txt"), {
        "id": 42, "filename": "05-18-11 Valesky Aging.txt", "title": "Committee for the Aging roundtable",
        "date": "2011-05-18", "address": "Albany", "committees": [{"name": "Aging"}], "text": fixture_text("hearing-2011-05-18.txt"),
    })
    write_json(store.corrections_path, {"transcripts/2025/2025-06-10T1100__regular-session.json": "2025-06-12"})
    write_json(store.bill_path(2025, "S4597"), {"basePrintNo": "S4597", "session": 2025, "printNo": "S4597A",
                                                "title": "Relates to the central business district tolling program",
                                                "sponsor": {"member": {"memberId": 1, "fullName": "Marisol Ortega"}}})
    out = tmp_path / "site"
    report = build_all(store, out, datetime(2025, 6, 10, 18, 0, 0))

    assert sorted(p.name for p in (out / "transcripts").iterdir()) == [
        "1998-03-10-regular-session.json",
        "2011-05-18-committee-for-the-aging-roundtable.json",
        "2020-01-01-regular-session.json",
        "2025-06-10-regular-session.json",
    ]
    legislative_day = read_json(out / "transcripts" / "2020-01-01-regular-session.json")
    assert legislative_day["plainText"] is False and legislative_day["segments"] == []
    assert legislative_day["corrected"] is None
    assert read_json(out / "transcripts" / "2025-06-10-regular-session.json")["corrected"] == "2025-06-12"

    bills_2025 = read_json(out / "bills" / "2025.json")
    assert bills_2025["bills"][0]["card"]["title"] == "Relates to the central business district tolling program"
    assert read_json(out / "bills" / "1997.json")["bills"][0]["card"] is None

    ortega = read_json(out / "senators" / "marisol-ortega.json")
    assert ortega["totals"] == {"remarks": 1, "transcripts": 1}
    assert ortega["bills"] == [{"session": 2025, "basePrintNo": "S4597", "printNo": "S4597A", "remarks": 1, "sponsor": True}]
    leichter = read_json(out / "senators" / "franz-leichter.json")
    assert leichter["appearances"][0]["transcript"] == "1998-03-10-regular-session"
    assert {s["slug"] for s in read_json(out / "senators.json")} == {"marisol-ortega", "paul-brennan", "franz-leichter", "emanuel-gold"}

    senate_words = read_json(out / "words" / "se.json")
    assert senate_words["senator"] >= 2
    assert all(count >= 2 for count in senate_words.values())
    meta = read_json(out / "meta.json")
    assert meta["updatedAt"] == "2025-06-10T18:00:00"
    assert meta["counts"]["floorTranscripts"] == 3 and meta["counts"]["hearings"] == 1
    assert (report.bill_mentions, report.bill_link_rate) == (1, 1.0)
    assert report.attribution > 0.95
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_sitedata.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.sitedata'`.

- [ ] **Step 3: Write the builder**

`pipeline/nyleg/sitedata.py`:

```python
"""Build the site data contract (data/site/) from the raw store. See spec section 7."""
from __future__ import annotations

import re
import shutil
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .bills import BILL_DATA_START, Segment, base_print_no, bill_card, find_bills, segment_calendar
from .clean import PageBreak, Paragraph, extract_lines, paragraphs
from .quality import Report
from .senators import Roster, load_overrides, session_year
from .speakers import ROLE_CHAIR, ROLE_PRESIDING, ROLE_RECORD, ROLE_SENATOR, Turn, coverage, split_turns
from .store import Store, read_json, slugify, write_json

FALLBACK_COVERAGE = 0.8
MATCH_ROLES = (ROLE_SENATOR, ROLE_PRESIDING, ROLE_CHAIR)
_WORD = re.compile(r"[a-z]{4,}")


def transcript_slug(kind: str, raw: dict[str, Any]) -> str:
    if kind == "floor":
        return f"{raw['dateTime'][:10]}-{slugify(raw.get('sessionType') or 'session')}"
    return f"{str(raw['date'])[:10]}-{slugify(raw.get('title') or 'public hearing')}"[:100].rstrip("-")


def _as_plain(paras: list[Paragraph]) -> Turn:
    text = ""
    page: int | None = None
    breaks: list[PageBreak] = []
    for para in paras:
        base = len(text) + 2 if text else 0
        current = breaks[-1].page if breaks else page
        if page is None:
            page = para.page_start
        elif para.page_start is not None and para.page_start != current:
            breaks.append(PageBreak(base, para.page_start))
        breaks.extend(PageBreak(base + b.offset, b.page) for b in para.breaks)
        text = f"{text}\n\n{para.text}" if text else para.text
    return Turn(0, None, ROLE_RECORD, None, text, page, breaks)


def _senator_slug(turn: Turn, session: int, roster: Roster, overrides: dict[tuple[int, str], int | None]) -> str | None:
    if turn.role not in MATCH_ROLES or turn.label is None:
        return None
    key = (session, turn.label)
    member_id = overrides[key] if key in overrides else roster.match(turn.name or "", session)
    senator = roster.senators.get(member_id) if member_id is not None else None
    return senator.slug if senator else None


def _segment_dict(segment: Segment, turns: list[dict[str, Any]]) -> dict[str, Any]:
    body = turns[segment.start_turn:segment.end_turn]
    speakers = Counter(t["senator"] for t in body if t["senator"] and t["role"] != ROLE_PRESIDING)
    pages = [t["page"] for t in body if t["page"] is not None]
    return {
        "calNo": segment.cal_no,
        "printNo": segment.print_no,
        "sponsor": segment.sponsor,
        "startTurn": segment.start_turn,
        "endTurn": segment.end_turn,
        "debated": segment.debated,
        "outcome": segment.outcome,
        "ayes": segment.ayes,
        "nays": segment.nays,
        "remarks": sum(1 for t in body[1:] if t["role"] in (ROLE_SENATOR, ROLE_CHAIR)),
        "speakers": dict(speakers.most_common()),
        "pages": [min(pages), max(pages)] if pages else None,
    }


def build_transcript(kind: str, raw: dict[str, Any], roster: Roster, overrides: dict, slug: str) -> dict[str, Any]:
    when = date.fromisoformat(str(raw.get("dateTime") or raw.get("date"))[:10])
    session = session_year(when)
    paras = paragraphs(extract_lines(raw.get("text") or ""))
    turns = split_turns(paras)
    cov = coverage(turns)
    plain = cov < FALLBACK_COVERAGE
    if plain:
        turns = [_as_plain(paras)] if paras else []
    out_turns = [
        {
            "i": t.index,
            "label": t.label,
            "role": t.role,
            "senator": _senator_slug(t, session, roster, overrides),
            "text": t.text,
            "page": t.page_start,
            "breaks": [[b.offset, b.page] for b in t.breaks],
            "bills": find_bills(t.text),
        }
        for t in turns
    ]
    pages = [t.page_start for t in turns if t.page_start is not None] + [b.page for t in turns for b in t.breaks]
    segments = segment_calendar(turns) if kind == "floor" and not plain else []
    return {
        "kind": kind,
        "slug": slug,
        "date": when.isoformat(),
        "session": session,
        "sessionType": raw.get("sessionType"),
        "dayType": raw.get("dayType"),
        "title": raw.get("title"),
        "location": raw.get("location") or raw.get("address"),
        "committees": [c.get("name") for c in raw.get("committees") or [] if c.get("name")],
        "pages": [min(pages), max(pages)] if pages else None,
        "coverage": round(cov, 4),
        "plainText": plain,
        "corrected": None,
        "turns": out_turns,
        "segments": [_segment_dict(s, out_turns) for s in segments],
    }


def load_roster(store: Store) -> Roster:
    folder = store.raw / "members"
    by_session = {int(p.stem): read_json(p) or [] for p in sorted(folder.glob("*.json"))} if folder.exists() else {}
    return Roster.from_members(by_session)


def build_all(store: Store, out: Path, now: datetime, overrides_path: Path | None = None) -> Report:
    """Rebuild everything in `out` from the raw store and return the quality report."""
    if out.exists():
        shutil.rmtree(out)
    roster = load_roster(store)
    overrides = load_overrides(overrides_path or store.root / "overrides" / "speakers.yaml")
    corrections = read_json(store.corrections_path, {}) or {}
    report = Report()
    seen: set[str] = set()
    appearances: dict[str, list[dict[str, Any]]] = defaultdict(list)
    debated_bills: dict[str, Counter] = defaultdict(Counter)
    bills: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    words: Counter = Counter()

    for kind, folder in (("floor", "transcripts"), ("hearing", "hearings")):
        for path in store.iter_raw(folder):
            raw = read_json(path)
            slug = transcript_slug(kind, raw)
            if slug in seen:
                slug = f"{slug}-{slugify(path.stem)}"[:120]
            seen.add(slug)
            doc = build_transcript(kind, raw, roster, overrides, slug)
            doc["corrected"] = corrections.get(store.raw_key(path))
            write_json(out / "transcripts" / f"{slug}.json", doc)

            session = doc["session"]
            total = sum(len(t["text"]) for t in doc["turns"])
            report.floor += kind == "floor"
            report.hearings += kind == "hearing"
            report.per_year[int(doc["date"][:4])] += 1
            report.chars_total += total
            report.chars_attributed += round(total * min(doc["coverage"], 1.0))
            if doc["plainText"]:
                report.plain_text.append(slug)

            per_senator = Counter()
            first: dict[str, dict[str, Any]] = {}
            for t in doc["turns"]:
                if t["role"] in (ROLE_SENATOR, ROLE_PRESIDING) and t["label"] and not t["senator"]:
                    report.unmatched[f"{session} {t['label']}"] += 1
                if t["senator"]:
                    per_senator[t["senator"]] += 1
                    first.setdefault(t["senator"], t)
                for printed in t["bills"]:
                    if session >= BILL_DATA_START:
                        report.bill_mentions += 1
                        report.bill_mentions_linked += store.bill_path(session, base_print_no(printed)).exists()
                words.update(_WORD.findall(t["text"].lower()))
            for senator, count in per_senator.items():
                appearances[senator].append({
                    "transcript": slug,
                    "date": doc["date"],
                    "kind": kind,
                    "title": doc["title"] or doc["sessionType"],
                    "remarks": count,
                    "firstTurn": first[senator]["i"],
                    "firstPage": first[senator]["page"],
                })
            for seg in doc["segments"]:
                base = base_print_no(seg["printNo"])
                entry = bills[session].setdefault(base, {"basePrintNo": base, "session": session, "card": None, "segments": []})
                entry["segments"].append({"transcript": slug, "date": doc["date"], **seg})
                for senator, count in seg["speakers"].items():
                    debated_bills[senator][(session, base, seg["printNo"])] += count

    sponsors: dict[tuple[int, str], int | None] = {}
    for session, entries in bills.items():
        for base, entry in entries.items():
            raw_bill = read_json(store.bill_path(session, base))
            entry["card"] = bill_card(raw_bill) if raw_bill else None
            sponsors[(session, base)] = ((entry["card"] or {}).get("sponsor") or {}).get("memberId")
        write_json(out / "bills" / f"{session}.json", {"session": session, "bills": [entries[k] for k in sorted(entries)]})

    index = []
    for senator in sorted(roster.senators.values(), key=lambda s: (s.last_name.upper(), s.first_name.upper(), s.member_id)):
        apps = sorted(appearances.get(senator.slug, []), key=lambda a: a["date"], reverse=True)
        sessions = {str(k): v for k, v in sorted(senator.districts.items())}
        remarks = sum(a["remarks"] for a in apps)
        index.append({"slug": senator.slug, "memberId": senator.member_id, "name": senator.full_name,
                      "sessions": sessions, "remarks": remarks, "transcripts": len(apps)})
        if not apps:
            continue
        bill_rows = [
            {"session": s, "basePrintNo": b, "printNo": p, "remarks": n, "sponsor": sponsors.get((s, b)) == senator.member_id}
            for (s, b, p), n in debated_bills[senator.slug].most_common()
        ]
        write_json(out / "senators" / f"{senator.slug}.json", {
            "slug": senator.slug, "memberId": senator.member_id, "name": senator.full_name, "sessions": sessions,
            "totals": {"remarks": remarks, "transcripts": len(apps)}, "appearances": apps, "bills": bill_rows,
        })
    write_json(out / "senators.json", index)

    by_prefix: dict[str, dict[str, int]] = defaultdict(dict)
    for word, count in words.items():
        if count >= 2:
            by_prefix[word[:2]][word] = count
    for prefix, entries in by_prefix.items():
        write_json(out / "words" / f"{prefix}.json", entries)

    write_json(out / "meta.json", {
        "updatedAt": now.replace(microsecond=0).isoformat(),
        "counts": {"floorTranscripts": report.floor, "hearings": report.hearings,
                   "senators": len(appearances), "bills": sum(len(e) for e in bills.values())},
        "quality": report.to_dict(),
    })
    return report
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_sitedata.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/sitedata.py pipeline/tests/test_sitedata.py
git commit -m "feat(pipeline): build the site data contract with senators, bills and quality"
```

---

### Task 10: The command line and README

**Files:**
- Create: `pipeline/nyleg/__main__.py`
- Create: `pipeline/README.md`
- Test: `pipeline/tests/test_cli.py`

**Interfaces:**
- Consumes everything above.
- Produces:
  - `python -m nyleg [--data DIR] sync [--backfill YEAR[-YEAR]] [--hearings] [--rescan-bills] [--bill-budget N]`
  - `python -m nyleg [--data DIR] process [--out DIR] [--gate-against FILE]`
  - `python -m nyleg smoke`
  - module functions `years(spec)`, `emit(name, value)` and `main(argv) -> int`
  - the constants `EXIT_AUTH = 3`, `EXIT_API = 4` and `EXIT_GATE = 5`

Plan 3's workflow relies on these exact flags, exit codes and the `changed` output.

- [ ] **Step 1: Write the failing tests**

`pipeline/tests/test_cli.py`:

```python
from nyleg.__main__ import EXIT_AUTH, EXIT_GATE, emit, main, years
from nyleg.store import Store, read_json, write_json


def test_years():
    assert years("2025") == [2025]
    assert years("1993-1995") == [1993, 1994, 1995]


def test_emit_writes_github_output(tmp_path, monkeypatch, capsys):
    target = tmp_path / "out.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(target))
    emit("changed", "true")
    assert target.read_text() == "changed=true\n"
    assert "changed=true" in capsys.readouterr().out


def test_sync_without_a_key_exits_with_the_auth_code(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("NYSENATE_API_KEY", raising=False)
    assert main(["--data", str(tmp_path), "sync"]) == EXIT_AUTH
    assert "NYSENATE_API_KEY" in capsys.readouterr().err


def make_store(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.transcript_path("1994-01-05T12:00", "Regular Session"), {
        "dateTime": "1994-01-05T12:00", "sessionType": "Regular Session",
        "text": "         1       Some words with no speakers.\n         2       More words.\n",
    })
    return store


def test_process_writes_site_data_and_quality(tmp_path):
    store = make_store(tmp_path)
    out = tmp_path / "site"
    assert main(["--data", str(store.root), "process", "--out", str(out)]) == 0
    assert (out / "transcripts" / "1994-01-05-regular-session.json").exists()
    assert read_json(out / "quality.json")["attribution"] == 0.0


def test_process_fails_the_gate_when_quality_drops(tmp_path, capsys):
    store = make_store(tmp_path)
    previous = tmp_path / "previous.json"
    write_json(previous, {"attribution": 0.99, "billLinkRate": 1.0})
    code = main(["--data", str(store.root), "process", "--out", str(tmp_path / "site"), "--gate-against", str(previous)])
    assert code == EXIT_GATE
    assert "Text matched to speakers dropped" in capsys.readouterr().err
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_cli.py -v`
Expected: `ModuleNotFoundError: No module named 'nyleg.__main__'`.

- [ ] **Step 3: Write the command line and README**

`pipeline/nyleg/__main__.py`:

```python
"""Command line: python -m nyleg [--data DIR] {sync,process,smoke}."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import sync
from .api import ApiError, AuthError, Client
from .quality import gate
from .senators import session_year
from .sitedata import build_all
from .store import Store, read_json, write_json

NEW_YORK = ZoneInfo("America/New_York")
EXIT_AUTH = 3
EXIT_API = 4
EXIT_GATE = 5


def years(spec: str) -> list[int]:
    start, _, end = spec.partition("-")
    return list(range(int(start), int(end or start) + 1))


def emit(name: str, value: str) -> None:
    """Print a result and, inside GitHub Actions, expose it as a step output."""
    print(f"{name}={value}")
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


def new_york_now() -> datetime:
    return datetime.now(NEW_YORK).replace(tzinfo=None)


def cmd_sync(args: argparse.Namespace) -> int:
    store = Store(Path(args.data))
    client = Client(os.environ.get("NYSENATE_API_KEY", ""))
    now = new_york_now()
    result = sync.SyncResult()
    if args.backfill:
        span = years(args.backfill)
        result.merge(sync.backfill_transcripts(client, store, span))
        result.merge(sync.backfill_hearings(client, store, span))
        for session in sorted({session_year(date(y, 1, 1)) for y in span}):
            result.merge(sync.sync_members(client, store, session))
    result.merge(sync.sync_transcript_updates(client, store, now))
    if args.hearings:
        result.merge(sync.sync_hearings_year(client, store, now.year))
    result.merge(sync.sync_members(client, store, session_year(now.date())))
    if args.rescan_bills:
        scan = list(store.iter_raw("transcripts"))
    else:
        scan = [p for p in result.changed if "transcripts" in p.parts]
    result.merge(sync.fetch_bills(client, store, sync.wanted_bills(scan), budget=args.bill_budget))
    print(f"{len(result.changed)} raw files added or updated")
    emit("changed", "true" if result.changed else "false")
    return 0


def cmd_process(args: argparse.Namespace) -> int:
    store = Store(Path(args.data))
    out = Path(args.out)
    report = build_all(store, out, new_york_now())
    summary = report.to_dict()
    write_json(out / "quality.json", summary)
    print(json.dumps({k: summary[k] for k in ("floorTranscripts", "hearings", "attribution", "billLinkRate")}))
    if args.gate_against:
        problems = gate(read_json(Path(args.gate_against)), report)
        for problem in problems:
            print(f"QUALITY GATE: {problem}", file=sys.stderr)
        if problems:
            return EXIT_GATE
    return 0


def cmd_smoke(args: argparse.Namespace) -> int:
    """Print the shape of each endpoint we depend on; used to verify assumptions with a real key."""
    client = Client(os.environ.get("NYSENATE_API_KEY", ""))
    session = session_year(new_york_now().date())
    checks = {
        "transcripts": ("/transcripts", {"limit": 1, "full": True, "sessionOnly": False}),
        "hearings": ("/hearings", {"limit": 1}),
        "members": (f"/members/{session}/senate", {"limit": 1, "full": True}),
        "bills": (f"/bills/{session}", {"limit": 1}),
    }
    for name, (path, params) in checks.items():
        body = client.get(path, **params)
        items = (body.get("result") or {}).get("items") or []
        first = items[0] if items else {}
        print(f"{name}: total={body.get('total')} offsetStart={body.get('offsetStart')} keys={sorted(first)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nyleg", description="On the Record data pipeline")
    parser.add_argument("--data", default="data", help="the repo's data/ folder")
    commands = parser.add_subparsers(dest="command", required=True)
    s = commands.add_parser("sync", help="download new and changed records")
    s.add_argument("--backfill", metavar="YEAR[-YEAR]", help="also download whole years (resumable)")
    s.add_argument("--hearings", action="store_true", help="re-list this year's public hearings")
    s.add_argument("--rescan-bills", action="store_true", help="look for bill mentions in every stored transcript")
    s.add_argument("--bill-budget", type=int, default=3000, help="max bill requests this run")
    p = commands.add_parser("process", help="build data/site from the raw store")
    p.add_argument("--out", default="data/site")
    p.add_argument("--gate-against", help="previous quality.json; exit 5 if quality dropped")
    commands.add_parser("smoke", help="check the live API responses we depend on")
    args = parser.parse_args(argv)
    handlers = {"sync": cmd_sync, "process": cmd_process, "smoke": cmd_smoke}
    try:
        return handlers[args.command](args)
    except AuthError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return EXIT_AUTH
    except ApiError as exc:
        print(f"ERROR: NY Senate API unavailable: {exc}", file=sys.stderr)
        return EXIT_API


if __name__ == "__main__":
    sys.exit(main())
```

`pipeline/README.md`:

````markdown
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
````

- [ ] **Step 4: Run the whole suite**

Run: `python -m pytest`
Expected: 84 passed.

Run: `python -m nyleg --help`
Expected: usage text listing `sync`, `process` and `smoke`.

- [ ] **Step 5: Commit**

```bash
git add pipeline/nyleg/__main__.py pipeline/README.md pipeline/tests/test_cli.py
git commit -m "feat(pipeline): add sync/process/smoke commands with CI-friendly exit codes"
```

---

### Task 11: Check the assumptions against the live API (needs the user's API key)

This task changes no code unless a check fails. It answers spec section 13 with real data.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-on-the-record-design.md`, section 13: record each answer.
- Modify, only if a check fails: the module named in that check, plus a regression test.

- [ ] **Step 1: Run the smoke check** (from the repo root, with the key in the environment)

```bash
export NYSENATE_API_KEY=...   # never commit this
python -m nyleg smoke
```

Expected:
- four lines: `transcripts`, `hearings`, `members` and `bills`
- `offsetStart=1` on each
- the transcripts keys include `dateTime`, `sessionType`, `dayType` and `text`
- the members keys include `memberId`, `chamber`, `person` and `sessionShortNameMap`

If any key is missing, fix the reader in `senators.py`, `sync.py` or `bills.py` that uses it. Add a test built from the real response shape.

- [ ] **Step 2: Backfill one recent year and build it**

```bash
python -m nyleg sync --backfill 2025
python -m nyleg sync --rescan-bills --bill-budget 200
python -m nyleg process
```

Expected:
- `sync` prints `changed=true`
- `process` prints JSON with `attribution` of at least 0.95 and `billLinkRate` above 0
- `data/site/transcripts/` contains about one file per 2025 session day
- open one file and confirm the speakers and pages look right against the official PDF at `https://legislation.nysenate.gov/api/3/transcripts/{dateTime}.pdf`

- [ ] **Step 3: Answer the spec's open questions**

1. **Counts per year.** For each year `Y` from 1993 to now, run:

   ```bash
   python -c "import httpx,os;print(httpx.get('https://legislation.nysenate.gov/api/3/transcripts/Y',params={'key':os.environ['NYSENATE_API_KEY'],'limit':1,'sessionOnly':'false'}).json()['total'])"
   ```

   Do the same for `/hearings/Y`, keeping in mind that the hearing totals are unreliable. Compare the sum with the file budget in spec section 10.
2. **First session with bill details.** Fetch `/bills/2007/S1` and `/bills/2009/S1` with `view=no_fulltext`. If 2007 works, lower `BILL_DATA_START` and update the test.
3. **Party.** Confirm that member records have no party, which the smoke output from Step 1 shows.
4. **Bulk bill listing.** Check whether `/bills/2025?limit=1&full=true` returns votes. If it does, a later plan can use it to cut down the number of bill requests.

Write each answer into section 13 of the spec as "Verified 20YY-MM-DD: …".

- [ ] **Step 4: Commit**

Commit only the spec. `data/raw/` from this check stays local until Plan 3's workflow owns committing it.

```bash
git add docs/superpowers/specs/2026-10-15-on-the-record-design.md
git commit -m "docs(spec): record live API verification results"
```

---

## Notes for Plans 2–4

- **Plan 2 (the site)** reads only `data/site/`, in the shapes listed in Task 9.
  - Show **district, not party**: the API has no party data.
  - Render `breaks` as the inline `*page` markers, and turn `turns[].i` into anchors `#r-{i}`.
  - When `plainText` is true, show the single text block with the note "Speaker details aren't available for this transcript."
- **Plan 3 (automation)** runs `python -m nyleg sync` hourly, adding `--hearings` once a day. It runs `process --gate-against data/quality.json` only when `changed=true`.
  - It commits `data/raw/` and `data/state.json`.
  - After a successful deploy, it copies `data/site/quality.json` to `data/quality.json`.
  - It maps exit codes 3, 4 and 5 to the plain-language failures in spec section 11.
- **Plan 4 (the search experiment)** can build its SQLite remark table straight from `data/site/transcripts/*.json`.
