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
