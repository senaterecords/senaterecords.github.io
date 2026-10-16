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


def test_senators_before_2009_link_through_the_history_list(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.members_path(2025), MEMBERS[2025])
    write_json(store.transcript_path("1995-03-01T11:00", "Regular Session"),
               floor("1995-03-01T11:00", "         1             SENATOR GOLD:  I rise in support of this bill.\n"))
    (store.root / "rosters").mkdir(parents=True)
    (store.root / "rosters" / "senate-1993-2008.yaml").write_text(
        "- member_id: 100001\n  name: Emanuel R. Gold\n  first: Emanuel\n  last: Gold\n  sessions: {1995: 16}\n",
        encoding="utf-8")
    build_all(store, tmp_path / "site", datetime(2025, 6, 11))
    doc = read_json(tmp_path / "site" / "transcripts" / "1995-03-01-regular-session.json")
    assert [t["senator"] for t in doc["turns"]] == ["emanuel-r-gold"]
    assert read_json(tmp_path / "site" / "senators" / "emanuel-r-gold.json")["sessions"] == {"1995": 16}


def test_the_transcript_date_settles_senators_who_never_served_together():
    from datetime import date

    roster = Roster.from_members({}, history=[
        {"member_id": 100010, "name": "Leonard P. Stavisky", "first": "Leonard", "last": "Stavisky",
         "sessions": {1999: 16}, "until": date(1999, 6, 19)},
        {"member_id": 100011, "name": "Toby Ann Stavisky", "first": "Toby", "last": "Stavisky",
         "sessions": {1999: 16}, "from": date(1999, 11, 2)},
    ])
    text = "         1             SENATOR STAVISKY:  I rise in support of this bill.\n"
    spring = build_transcript("floor", floor("1999-03-01T11:00", text), roster, {}, "a")
    winter = build_transcript("floor", floor("2000-02-01T11:00", text), roster, {}, "b")
    assert spring["turns"][0]["senator"] == "leonard-p-stavisky"
    assert winter["turns"][0]["senator"] == "toby-ann-stavisky"


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


def hearing(key, title, date="2011-05-18", text="         1             SENATOR VALESKY:  Welcome.\n", committees=None):
    return {"id": 1, "filename": key, "title": title, "date": date, "committees": committees or [], "text": text}


def test_colliding_hearing_slugs_are_all_suffixed_and_unique(tmp_path):
    store = Store(tmp_path / "data")
    for key in ("b-second.txt", "a-first.txt"):
        write_json(store.hearing_path(2011, key), hearing(key, "Budget hearing"))
    write_json(store.hearing_path(2011, "c.txt"), hearing("c.txt", "x" * 300))
    write_json(store.hearing_path(2011, "d.txt"), hearing("d.txt", "x" * 300 + "y"))
    build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    names = sorted(p.stem for p in (tmp_path / "site" / "transcripts").iterdir())
    assert "2011-05-18-budget-hearing-a-first-txt" in names and "2011-05-18-budget-hearing-b-second-txt" in names
    assert len(names) == len(set(names)) == 4


def test_build_all_refuses_to_wipe_a_folder_that_is_not_a_previous_build(tmp_path):
    import pytest
    store = Store(tmp_path / "data")
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", TEXT_2025))
    with pytest.raises(ValueError, match="not a previous build"):
        build_all(store, store.root, datetime(2025, 1, 1))
    assert store.transcript_path("2025-06-10T11:00", "Regular Session").exists()
    other = tmp_path / "notes"
    other.mkdir()
    (other / "keep.txt").write_text("mine")
    with pytest.raises(ValueError):
        build_all(store, other, datetime(2025, 1, 1))
    assert (other / "keep.txt").exists()
    build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    build_all(store, tmp_path / "site", datetime(2025, 1, 2))  # a previous build may be replaced


def test_one_bad_record_is_reported_and_the_rest_still_build(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", TEXT_2025))
    write_json(store.transcript_path("2025-06-11T11:00", "Regular Session"), {"sessionType": "Regular Session", "text": "x"})
    report = build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    assert report.floor == 1
    assert report.failed == ["transcripts/2025/2025-06-11T1100__regular-session.json"]


def test_committee_names_may_be_plain_strings():
    raw = hearing("a.txt", "Roundtable", committees=["Aging", {"name": "Health", "chamber": "SENATE"}])
    doc = build_transcript("hearing", raw, Roster({}), {}, "x")
    assert doc["committees"] == ["Aging", "Health"]


def test_chairs_in_joint_hearings_are_not_matched_to_senators():
    roster = Roster.from_members({2011: [member(5, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 2011)]})
    text = "         1             CHAIRWOMAN KRUEGER:  Welcome to the hearing.\n"
    senate_only = hearing("a.txt", "Budget", text=text, committees=[{"name": "Finance", "chamber": "SENATE"}])
    joint = hearing("b.txt", "Budget", text=text, committees=[{"name": "Finance", "chamber": "SENATE"},
                                                             {"name": "Ways and Means", "chamber": "ASSEMBLY"}])
    assert build_transcript("hearing", senate_only, roster, {}, "x")["turns"][0]["senator"] == "liz-krueger"
    assert build_transcript("hearing", joint, roster, {}, "x")["turns"][0]["senator"] is None


JOINT = [{"name": "Finance", "chamber": "SENATE"}, {"name": "Ways and Means", "chamber": "ASSEMBLY"}]


def assembly_member(member_id, full, first, last, short, session):
    return {**member(member_id, full, first, last, short, session), "chamber": "ASSEMBLY"}


def test_joint_hearing_chairs_link_only_when_no_assembly_member_shares_the_name():
    roster = Roster.from_members({2011: [member(5, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 2011),
                                         member(6, "Ann Weinstein", "Ann", "Weinstein", "WEINSTEIN", 2011)]})
    assembly = Roster.from_members(
        {2011: [assembly_member(900, "Helene Weinstein", "Helene", "Weinstein", "WEINSTEIN", 2011)]}, chamber="ASSEMBLY")

    def chair(name):
        text = f"         1             CHAIRWOMAN {name}:  Welcome to the hearing.\n"
        raw = hearing("b.txt", "Budget", text=text, committees=JOINT)
        return build_transcript("hearing", raw, roster, {}, "x", assembly=assembly)["turns"][0]["senator"]

    assert chair("KRUEGER") == "liz-krueger"
    assert chair("WEINSTEIN") is None  # Helene Weinstein of the Assembly shares the name: never guess


def test_senator_photos_are_copied_into_the_site_data(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.members_path(2025), [{**MEMBERS[2025][0], "imgName": "1_marisol_ortega.jpg"}, MEMBERS[2025][1]])
    store.photo_path("1_marisol_ortega.jpg").parent.mkdir(parents=True)
    store.photo_path("1_marisol_ortega.jpg").write_bytes(b"jpeg-bytes")
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", TEXT_2025))
    site = tmp_path / "site"
    build_all(store, site, datetime(2025, 6, 11))
    assert (site / "photos" / "marisol-ortega.jpg").read_bytes() == b"jpeg-bytes"
    index = {s["slug"]: s for s in read_json(site / "senators.json")}
    assert index["marisol-ortega"]["photo"] == "photos/marisol-ortega.jpg"
    assert index["paul-brennan"]["photo"] is None
    assert read_json(site / "senators" / "marisol-ortega.json")["photo"] == "photos/marisol-ortega.jpg"


def test_senator_data_lists_service_periods(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.members_path(2025), [{**MEMBERS[2025][0], "incumbent": True}, MEMBERS[2025][1]])
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", TEXT_2025))
    build_all(store, tmp_path / "site", datetime(2025, 6, 11))
    index = {s["slug"]: s for s in read_json(tmp_path / "site" / "senators.json")}
    assert index["marisol-ortega"]["service"] == [{"from": 2025, "to": None}]
    assert index["paul-brennan"]["service"] == [{"from": 2025, "to": 2026}]
    assert read_json(tmp_path / "site" / "senators" / "marisol-ortega.json")["service"] == [{"from": 2025, "to": None}]


SPECIAL = """                                                               2001

 1               THE SECRETARY:   Calendar Number 1, Extraordinary
 2   Session Senate Print Number 25, by the Senate Committee on Rules,
 3   an act to amend the Executive Law.
 4               THE SECRETARY:   Calendar Number 2, Extraordinary
 5   Session Senate Print Number 26, by the Senate Committee on Rules,
 6   an act to amend the Retirement and Social Security Law.
"""


def test_special_session_readings_link_the_special_session_bill_never_the_regular_one(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.transcript_path("2009-06-23T15:00", "Extraordinary Session"),
               {**floor("2009-06-23T15:00", SPECIAL), "sessionType": "Extraordinary Session"})
    write_json(store.bill_path(2009, "S50025"), {"basePrintNo": "S50025", "printNo": "S50025", "session": 2009,
                                                 "publishedDateTime": "2009-06-23T15:01:01", "title": "Veterans"})
    write_json(store.bill_path(2009, "S26"), {"basePrintNo": "S26", "printNo": "S26", "session": 2009,
                                              "publishedDateTime": "2009-01-07T10:00:00", "title": "Something else"})
    report = build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    doc = read_json(tmp_path / "site" / "transcripts" / "2009-06-23-extraordinary-session.json")
    assert [s["printNo"] for s in doc["segments"]] == ["S50025", None]
    assert [b for t in doc["turns"] for b in t["bills"]] == ["S50025"]
    bills = {b["basePrintNo"] for b in read_json(tmp_path / "site" / "bills" / "2009.json")["bills"]}
    assert bills == {"S50025"}
    assert (report.bill_mentions, report.bill_mentions_linked) == (2, 1)


def test_build_all_reads_the_assembly_lists_for_joint_hearings(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.members_path(2011), [member(5, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 2011)])
    write_json(store.assembly_members_path(2011),
               [assembly_member(900, "Herman D. Farrell", "Herman", "Farrell", "FARRELL", 2011)])
    text = "         1             CHAIRWOMAN KRUEGER:  Welcome to the hearing.\n"
    write_json(store.hearing_path(2011, "joint.txt"), hearing("joint.txt", "Budget", text=text, committees=JOINT))
    build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    doc = read_json(tmp_path / "site" / "transcripts" / "2011-05-18-budget.json")
    assert doc["turns"][0]["senator"] == "liz-krueger"


TEXT_SPANS_PAGES = """                                                               5800

 1               THE SECRETARY:   Calendar Number 11, Senate Print 200, by
 2   Senator Ortega, an act to amend the vehicle and traffic law.
 3               SENATOR ORTEGA:   Thank you, Mr. President.  This
 4   bill does one thing.  It says the congestion pricing program
 5   has to answer to the riders in my district before it answers
                                                               5801

 1   to anyone else in this building, and it requires the authority
 2   to publish where each dollar collected in the zone is spent.
"""


def test_segment_pages_include_pages_reached_inside_a_turn():
    doc = build_transcript("floor", floor("2025-06-10T11:00", TEXT_SPANS_PAGES), Roster.from_members(MEMBERS), {}, "x")
    (segment,) = doc["segments"]
    assert segment["pages"] == [5800, 5801]


def test_empty_transcripts_are_flagged_as_empty_not_plain_text(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.transcript_path("2025-06-12T11:00", "Regular Session"), floor("2025-06-12T11:00", ""))
    report = build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    doc = read_json(tmp_path / "site" / "transcripts" / "2025-06-12-regular-session.json")
    assert (doc["empty"], doc["plainText"], doc["turns"]) == (True, False, [])
    assert report.empty == ["2025-06-12-regular-session"] and report.plain_text == []


def test_vocabulary_keeps_accented_words(tmp_path):
    store = Store(tmp_path / "data")
    text = TEXT_2025.replace("Thank you, Mr. President.", "Thank you, Senator Sepúlveda and Senator Sepúlveda.")
    write_json(store.transcript_path("2025-06-10T11:00", "Regular Session"), floor("2025-06-10T11:00", text))
    build_all(store, tmp_path / "site", datetime(2025, 1, 1))
    assert read_json(tmp_path / "site" / "words" / "se.json")["sepúlveda"] == 2
