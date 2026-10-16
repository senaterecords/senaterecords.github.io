from datetime import date, datetime
from urllib.parse import quote

import pytest

from nyleg.api import ApiError, AuthError, NotFound
from nyleg.store import Store, read_json, write_json
from nyleg.sync import (
    backfill_hearings,
    backfill_transcripts,
    fetch_bills,
    save_transcript,
    sync_hearings_year,
    sync_members,
    sync_recent_hearings,
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
        if path in getattr(self, "errors", {}):
            raise self.errors[path]
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


def test_members_of_both_chambers_are_saved_per_session(tmp_path):
    # Assembly members are kept so a joint-hearing chair is only matched to a senator when no
    # Assembly member shares the name.
    store = Store(tmp_path)
    client = FakeClient({"/members/2025/senate": [{"memberId": 1}], "/members/2025/assembly": [{"memberId": 900}]})
    assert sync_members(client, store, 2025).changed == [store.members_path(2025), store.assembly_members_path(2025)]
    assert read_json(store.assembly_members_path(2025)) == [{"memberId": 900}]
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


def test_one_missing_transcript_does_not_stall_the_hourly_updates(tmp_path):
    store = Store(tmp_path)
    now = datetime(2025, 6, 10, 18, 0, 0)
    updates = "/transcripts/updates/2025-06-03T18:00:00/2025-06-10T18:00:00"
    gone = {"dateTime": "2025-06-09T11:00", "sessionType": "Regular Session"}
    kept = {"dateTime": "2025-06-10T11:00", "sessionType": "Regular Session"}
    single = f"/transcripts/{quote(kept['dateTime'])}/{quote(kept['sessionType'])}"
    client = FakeClient({updates: [{"transcriptId": gone}, {"transcriptId": kept}]}, {single: transcript(kept["dateTime"])})
    assert len(sync_transcript_updates(client, store, now).changed) == 1
    state = store.load_state()
    assert state["transcripts_synced_at"] == "2025-06-10T18:00:00"
    assert state["transcripts_missing"] == [["2025-06-09T11:00", "Regular Session"]]


def test_recent_hearings_include_last_year_so_late_postings_are_not_lost(tmp_path):
    store = Store(tmp_path)
    late = {"id": 7, "filename": "12-15-25 Budget.txt", "date": "2025-12-15", "text": "x"}
    client = FakeClient({"/hearings/2025": [late], "/hearings/2026": []})
    result = sync_recent_hearings(client, store, date(2026, 1, 10))
    assert client.calls == ["/hearings/2026", "/hearings/2025"]
    assert result.changed == [store.hearing_path(2025, "12-15-25 Budget.txt")]


def test_current_session_bills_are_refreshed_weekly(tmp_path):
    store = Store(tmp_path)
    client = FakeClient(singles={"/bills/2025/S1": {"basePrintNo": "S1", "session": 2025, "signed": False}})
    fetch_bills(client, store, {(2025, "S1")}, budget=5, today=date(2025, 6, 1), refresh_session=2025)
    client.singles["/bills/2025/S1"] = {"basePrintNo": "S1", "session": 2025, "signed": True}
    client.calls.clear()
    fetch_bills(client, store, set(), budget=5, today=date(2025, 6, 5), refresh_session=2025)
    assert client.calls == []  # checked 4 days ago: still fresh
    fetch_bills(client, store, set(), budget=5, today=date(2025, 6, 9), refresh_session=2025)
    assert client.calls == ["/bills/2025/S1"]
    assert read_json(store.bill_path(2025, "S1"))["signed"] is True
    client.calls.clear()
    fetch_bills(client, store, set(), budget=5, today=date(2025, 7, 1), refresh_session=2027)
    assert client.calls == []  # bills from past sessions are no longer refreshed


def test_members_are_saved_in_a_stable_order(tmp_path):
    store = Store(tmp_path)
    sync_members(FakeClient({"/members/2025/senate": [{"memberId": 2}, {"memberId": 1}]}), store, 2025)
    again = sync_members(FakeClient({"/members/2025/senate": [{"memberId": 1}, {"memberId": 2}]}), store, 2025)
    assert again.changed == []
    assert [m["memberId"] for m in read_json(store.members_path(2025))] == [1, 2]


def test_the_updates_window_never_runs_backwards(tmp_path):
    store = Store(tmp_path)
    store.save_state({"transcripts_synced_at": "2025-11-02T01:30:00"})  # a run just before the clocks went back
    client = FakeClient()
    sync_transcript_updates(client, store, datetime(2025, 11, 2, 1, 5, 0))
    assert client.calls == ["/transcripts/updates/2025-11-02T00:55:00/2025-11-02T01:05:00"]


def test_a_server_error_while_fetching_bills_leaves_the_rest_pending(tmp_path):
    store = Store(tmp_path)
    client = FakeClient(singles={"/bills/2025/S1": {"basePrintNo": "S1", "session": 2025}})
    client.errors = {"/bills/2025/S2": ApiError("Gave up on /bills/2025/S2 after 5 attempts (HTTP 503)")}
    fetch_bills(client, store, {(2025, "S1"), (2025, "S2"), (2025, "S3")}, budget=10)
    assert store.bill_path(2025, "S1").exists()
    assert store.load_state()["bills_pending"] == [[2025, "S2"], [2025, "S3"]]


def test_a_rejected_key_while_fetching_bills_still_stops_the_run(tmp_path):
    store = Store(tmp_path)
    client = FakeClient()
    client.errors = {"/bills/2025/S1": AuthError("NY Senate API key rejected")}
    with pytest.raises(AuthError):
        fetch_bills(client, store, {(2025, "S1")}, budget=10)


def test_hearings_without_a_date_are_skipped_not_fatal(tmp_path):
    store = Store(tmp_path)
    good = {"id": 1, "filename": "a.txt", "date": "2025-03-01", "text": "x"}
    client = FakeClient({"/hearings/2025": [{"id": 2, "filename": "b.txt", "date": None, "text": "y"}, good]})
    result = sync_hearings_year(client, store, 2025)
    assert result.changed == [store.hearing_path(2025, "a.txt")]
    assert store.load_state()["hearings_skipped"] == ["b.txt"]


def test_bills_can_be_fetched_in_parallel(tmp_path):
    store = Store(tmp_path)
    singles = {f"/bills/2025/S{i}": {"basePrintNo": f"S{i}", "session": 2025} for i in range(1, 41)}
    client = FakeClient(singles=singles)
    result = fetch_bills(client, store, {(2025, f"S{i}") for i in range(1, 41)}, budget=100, workers=8)
    assert len(result.changed) == 40
    assert sorted(client.calls) == sorted(singles)
    assert store.load_state()["bills_pending"] == []


def test_parallel_fetching_leaves_failed_bills_pending_and_still_stops_on_a_rejected_key(tmp_path):
    store = Store(tmp_path)
    singles = {f"/bills/2025/S{i}": {"basePrintNo": f"S{i}", "session": 2025} for i in range(1, 21)}
    client = FakeClient(singles=singles)
    client.errors = {"/bills/2025/S7": ApiError("HTTP 503")}
    fetch_bills(client, store, {(2025, f"S{i}") for i in range(1, 21)}, budget=100, workers=4)
    assert [2025, "S7"] in store.load_state()["bills_pending"]
    assert not store.bill_path(2025, "S7").exists()
    client.errors = {"/bills/2025/S7": AuthError("NY Senate API key rejected")}
    with pytest.raises(AuthError):
        fetch_bills(client, store, set(), budget=100, workers=4)
