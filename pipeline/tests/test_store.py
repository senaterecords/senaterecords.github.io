from nyleg.store import Store, read_json, slugify, write_json


def test_slugify():
    assert slugify("Extraordinary Session II") == "extraordinary-session-ii"
    assert slugify("10-29-13 NYsenate_Flanagan_Education_FINAL.txt") == "10-29-13-nysenate-flanagan-education-final-txt"


def test_slugify_folds_accents():
    assert slugify("Luis R. Sepúlveda") == "luis-r-sepulveda"
    assert slugify("Jessica González-Rojas") == "jessica-gonzalez-rojas"


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
