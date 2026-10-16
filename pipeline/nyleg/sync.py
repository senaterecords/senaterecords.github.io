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
