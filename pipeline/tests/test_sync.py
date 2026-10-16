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
