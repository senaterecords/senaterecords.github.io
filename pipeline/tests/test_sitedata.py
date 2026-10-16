from datetime import datetime

from nyleg.senators import Roster
from nyleg.sitedata import build_all, build_transcript, transcript_slug
from nyleg.store import Store, read_json, write_json

TEXT_2025 = """                                                               5780

 1               THE SECRETARY:   Calendar Number 412, Senate Print
 2   4597A, by Senator Ortega, an act to amend the vehicle and
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
    assert ortega["totals"] == {"remarks": 1, "presiding": 0, "transcripts": 1}
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


TEXT_TWO_BILLS = """                                                               5800

 1               THE SECRETARY:   Calendar Number 10, Senate Print 100, by
 2   Senator Ortega, an act to amend the tax law.
 3               SENATOR KEARNEY:   Lay it aside.
 4               ACTING PRESIDENT BRENNAN:   Lay it
 5   aside.
 6               THE SECRETARY:   Calendar Number 11, Senate Print 200, by
 7   Senator Ortega, an act to amend the vehicle and traffic law.
 8               SENATOR ORTEGA:   Thank you, Mr. President.  This
 9   bill does one thing, much like Senate Print 999 did last year.
10   it says the congestion pricing program has to answer to the
11   riders in my district before it answers to anyone else in this
12   building, and it requires the authority to publish its spending.
13               THE SECRETARY:   Ayes, 41.  Nays, 20.
14               ACTING PRESIDENT BRENNAN:   The bill is passed.
15               SENATOR KEARNEY:   I move that the Senate stand adjourned
16   until tomorrow at eleven.
"""

THREE_SENATORS = {2025: [
    member(1, "Marisol Ortega", "Marisol", "Ortega", "ORTEGA", 2025),
    member(2, "Paul Brennan", "Paul", "Brennan", "BRENNAN", 2025),
    member(3, "Thomas Kearney", "Thomas", "Kearney", "KEARNEY", 2025),
]}


def build_two_bills(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.members_path(2025), THREE_SENATORS[2025])
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", TEXT_TWO_BILLS))
    write_json(store.bill_path(2025, "S100"), {"basePrintNo": "S100", "session": 2025, "printNo": "S100",
                                               "sponsor": {"member": {"memberId": 2, "fullName": "Paul Brennan"}}})
    out = tmp_path / "site"
    return out, build_all(store, out, datetime(2025, 6, 10, 18, 0, 0))


def test_segment_speakers_and_remarks_cover_only_the_debate(tmp_path):
    out, _ = build_two_bills(tmp_path)
    laid_aside, passed = read_json(out / "transcripts" / "2025-06-10-regular-session.json")["segments"]
    assert (laid_aside["debated"], laid_aside["speakers"], laid_aside["remarks"]) == (False, {}, 0)
    assert (passed["debated"], passed["speakers"], passed["remarks"]) == (True, {"marisol-ortega": 1}, 1)


def test_presiding_turns_are_counted_apart_from_remarks(tmp_path):
    out, _ = build_two_bills(tmp_path)
    brennan = read_json(out / "senators" / "paul-brennan.json")
    assert brennan["totals"] == {"remarks": 0, "presiding": 2, "transcripts": 1}
    assert brennan["appearances"][0]["remarks"] == 0 and brennan["appearances"][0]["presiding"] == 2
    index = {s["slug"]: s for s in read_json(out / "senators.json")}
    assert (index["paul-brennan"]["remarks"], index["thomas-kearney"]["remarks"]) == (0, 2)


def test_bills_file_lists_every_mentioned_bill_and_sponsors_get_their_bills(tmp_path):
    out, _ = build_two_bills(tmp_path)
    bills = {b["basePrintNo"]: b for b in read_json(out / "bills" / "2025.json")["bills"]}
    assert sorted(bills) == ["S100", "S200", "S999"]
    assert bills["S999"]["segments"] == [] and bills["S999"]["mentionedIn"] == ["2025-06-10-regular-session"]
    brennan_bills = read_json(out / "senators" / "paul-brennan.json")["bills"]
    assert {"session": 2025, "basePrintNo": "S100", "printNo": "S100", "remarks": 0, "sponsor": True} in brennan_bills


def test_plain_text_transcripts_add_nothing_to_attribution(tmp_path):
    store = Store(tmp_path / "data")
    text = ("         1       some front matter " + "word " * 1200 + "\n"
            "         2                      THE SECRETARY:  Ayes 48. " + "word " * 150 + "\n")
    write_json(store.transcript_path("1994-01-05T12:00", "Regular Session"), floor("1994-01-05T12:00", text))
    report = build_all(store, tmp_path / "site", datetime(2025, 6, 10, 18, 0, 0))
    assert report.plain_text == ["1994-01-05-regular-session"]
    assert report.attribution == 0.0


def test_overrides_match_labels_regardless_of_letter_case():
    text = TEXT_2025.replace("SENATOR ORTEGA:", "SENATOR DeORTEGA:")
    roster = Roster.from_members(MEMBERS)
    doc = build_transcript("floor", floor("2025-06-10T11:00", text), roster, {(2025, "SENATOR DEORTEGA"): 2}, "x")
    assert doc["turns"][1]["senator"] == "paul-brennan"
