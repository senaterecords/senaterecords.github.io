"""Download new and changed records from the API into the raw store."""
from __future__ import annotations

from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from .api import ApiError, AuthError, NotFound
from .bills import BILL_DATA_START, base_print_no, find_bills
from .clean import extract_lines, paragraphs
from .senators import session_year
from .store import Store, read_json, write_json

UPDATE_OVERLAP = timedelta(minutes=10)
FIRST_LOOKBACK = timedelta(days=7)
REFRESH_DAYS = 7  # re-check current-session bills weekly


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


def hearing_year(item: dict[str, Any]) -> int | None:
    """The hearing's year, or None when the record has no usable date."""
    text = str(item.get("date") or "")[:4]
    return int(text) if text.isdigit() else None


def save_hearing(store: Store, item: dict[str, Any], today: date | None = None) -> Path | None:
    year = hearing_year(item)
    if year is None:
        return None
    return _save(store, store.hearing_path(year, hearing_key(item)), item, today)


def _note_skipped(state: dict[str, Any], skipped: list[str]) -> None:
    if skipped:
        state["hearings_skipped"] = sorted(set(state.get("hearings_skipped", [])) | set(skipped))


def _backfill(client: ApiClient, store: Store, years: Iterable[int], kind: str) -> SyncResult:
    result = SyncResult()
    state = store.load_state()
    done = set(state.get("backfill", {}).get(kind, []))
    for year in years:
        if year in done:
            continue
        skipped: list[str] = []
        if kind == "transcripts":
            items = client.iter_items(f"/transcripts/{year}", full=True, sessionOnly=False)
            save = save_transcript
        else:
            items = client.iter_items(f"/hearings/{year}", full=True)
            save = save_hearing
        for item in items:
            if kind == "hearings" and hearing_year(item) is None:
                skipped.append(hearing_key(item))
                continue
            path = save(store, item)
            if path:
                result.changed.append(path)
        done.add(year)
        state.setdefault("backfill", {})[kind] = sorted(done)
        _note_skipped(state, skipped)
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
    if since >= now:  # e.g. the November clock change: never ask for a window that runs backwards
        since = now - UPDATE_OVERLAP
    result = SyncResult()
    missing = [list(x) for x in state.get("transcripts_missing", [])]
    for item in client.iter_items(f"/transcripts/updates/{_iso(since)}/{_iso(now)}"):
        tid = item["transcriptId"]
        try:
            body = client.get(f"/transcripts/{quote(tid['dateTime'])}/{quote(tid['sessionType'])}")
        except NotFound:
            # Listed as updated but not fetchable: remember it rather than failing every hour.
            if [tid["dateTime"], tid["sessionType"]] not in missing:
                missing.append([tid["dateTime"], tid["sessionType"]])
            continue
        path = save_transcript(store, body["result"])
        if path:
            result.changed.append(path)
    state = store.load_state()
    state["transcripts_synced_at"] = _iso(now)
    if missing:
        state["transcripts_missing"] = sorted(missing)
    store.save_state(state)
    return result


def sync_hearings_year(client: ApiClient, store: Store, year: int) -> SyncResult:
    result = SyncResult()
    skipped: list[str] = []
    for item in client.iter_items(f"/hearings/{year}", full=True):
        if hearing_year(item) is None:
            skipped.append(hearing_key(item))  # one bad record must not stop the run
            continue
        path = save_hearing(store, item)
        if path:
            result.changed.append(path)
    if skipped:
        state = store.load_state()
        _note_skipped(state, skipped)
        store.save_state(state)
    return result


def sync_recent_hearings(client: ApiClient, store: Store, today: date) -> SyncResult:
    """Re-list this year's and last year's hearings: some are posted weeks after they happen."""
    result = sync_hearings_year(client, store, today.year)
    return result.merge(sync_hearings_year(client, store, today.year - 1))


def sync_members(client: ApiClient, store: Store, session: int) -> SyncResult:
    # Sorted, so a different API ordering doesn't look like a change every hour.
    items = sorted(client.iter_items(f"/members/{session}/senate", full=True), key=lambda m: m.get("memberId") or 0)
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


def fetch_bills(
    client: ApiClient,
    store: Store,
    wanted: Iterable[tuple[int, str]],
    budget: int,
    today: date | None = None,
    refresh_session: int | None = None,
    refresh_days: int = REFRESH_DAYS,
    workers: int = 1,
) -> SyncResult:
    """Fetch up to `budget` bills: first ones not stored yet, then `refresh_session` bills not checked
    for `refresh_days` (status, votes and the Governor's action change after the floor vote).
    `workers` > 1 fetches in parallel (meant for the one-time backfill)."""
    today = today or date.today()
    state = store.load_state()
    pending = {tuple(x) for x in state.get("bills_pending", [])} | set(wanted)
    missing = {tuple(x) for x in state.get("bills_missing", [])}
    checked: dict[str, str] = dict(state.get("bills_checked", {}))
    result = SyncResult()

    queue: list[tuple[int, str]] = []
    for session, base in sorted(pending):
        if len(queue) >= budget:
            break
        if (session, base) not in missing and not store.bill_path(session, base).exists():
            queue.append((session, base))
    if refresh_session is not None:
        cutoff = (today - timedelta(days=refresh_days)).isoformat()
        folder = store.raw / "bills" / str(refresh_session)
        for base in sorted(p.stem for p in folder.glob("*.json")) if folder.exists() else []:
            if len(queue) >= budget:
                break
            if checked.get(f"{refresh_session}/{base}", "") <= cutoff:
                queue.append((refresh_session, base))

    def request(item: tuple[int, str]) -> dict[str, Any]:
        return client.get(f"/bills/{item[0]}/{item[1]}", view="no_fulltext")

    def keep(item: tuple[int, str], body: dict[str, Any]) -> None:
        checked[f"{item[0]}/{item[1]}"] = today.isoformat()
        path = store.bill_path(*item)
        if write_json(path, body["result"]):
            result.changed.append(path)

    try:
        if workers <= 1:
            for item in queue:
                try:
                    keep(item, request(item))
                except NotFound:
                    missing.add(item)
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(request, item): item for item in queue}
                try:
                    for future in as_completed(futures):
                        item = futures[future]
                        try:
                            keep(item, future.result())
                        except NotFound:
                            missing.add(item)
                except ApiError:
                    pool.shutdown(cancel_futures=True)
                    raise
    except AuthError:
        raise
    except ApiError:
        pass  # the API is struggling: keep what we have, leave the rest pending for the next run
    left = {p for p in pending if p not in missing and not store.bill_path(*p).exists()}
    state["bills_pending"] = [list(p) for p in sorted(left)]
    state["bills_missing"] = [list(p) for p in sorted(missing)]
    state["bills_checked"] = dict(sorted(checked.items()))
    store.save_state(state)
    return result
