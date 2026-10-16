from datetime import date

from nyleg.bills import BillResolver, base_print_no, bill_card, extraordinary_print, find_bills, load_bill_fixes, segment_calendar
from nyleg.clean import extract_lines, paragraphs
from nyleg.speakers import Turn, classify, split_turns


def test_extraordinary_session_numbers_map_to_the_api_series():
    # Open Legislation files extraordinary-session bills as S5000N (Senate) and A4000N (Assembly).
    assert extraordinary_print("S25") == "S50025"
    assert extraordinary_print("A3") == "A40003"
    assert extraordinary_print("S11A") == "S50011A"
    assert extraordinary_print("S1145B") is None  # a regular bill mentioned during a special session


def resolver(bills=None, fixes=None):
    bills = bills or {}
    return BillResolver(fixes or {}, lambda session, base: bills.get((session, base)))


JUNE_23 = date(2009, 6, 23)


def test_regular_sessions_keep_the_number_as_read():
    assert resolver().resolve("S25", 2009, JUNE_23, extraordinary=False) == "S25"


def test_a_special_session_reading_links_the_special_session_bill_published_for_it():
    r = resolver({(2009, "S50025"): {"publishedDateTime": "2009-06-23T15:01:01"}})
    assert r.resolve("S25", 2009, JUNE_23, extraordinary=True) == "S50025"


def test_a_special_session_number_is_never_linked_to_the_regular_bill_or_a_stale_one():
    # November 2009's "Senate Print 5" is not June's S50005, and never the regular S5.
    r = resolver({(2009, "S50005"): {"publishedDateTime": "2009-06-23T15:01:01"}, (2009, "S5"): {}})
    assert r.resolve("S5", 2009, date(2009, 11, 10), extraordinary=True) is None
    assert r.resolve("S77", 2009, date(2009, 11, 10), extraordinary=True) is None  # not in the API at all


def test_large_numbers_in_a_special_session_are_regular_bills():
    assert resolver().resolve("S1145B", 2009, date(2010, 1, 19), extraordinary=True) == "S1145B"


def test_reviewed_fixes_win(tmp_path):
    path = tmp_path / "bills.yaml"
    path.write_text("- date: 2021-09-01\n  printed: S5001\n  bill: S50001\n", encoding="utf-8")
    fixes = load_bill_fixes(path)
    assert fixes == {("2021-09-01", "S5001"): "S50001"}
    assert resolver(fixes=fixes).resolve("S5001", 2021, date(2021, 9, 1), extraordinary=True) == "S50001"
    assert resolver(fixes=fixes).resolve("S5001", 2021, date(2021, 3, 1), extraordinary=False) == "S5001"
    assert load_bill_fixes(tmp_path / "missing.yaml") == {}


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


def test_modern_readings_put_the_print_number_first():
    turns = [
        turn(0, "THE SECRETARY", "Calendar Number 1, Senate Print 88, by Senator Gianaris, an act to amend the Election Law."),
        turn(1, "SENATOR LANZA", "Lay it aside."),
        turn(2, "ACTING PRESIDENT BAILEY", "Lay it aside."),
        turn(3, "THE SECRETARY", "Calendar Number 412, Assembly Bill Number 1234A, by Assemblymember Paulin, an act to amend the public health law."),
        turn(4, "THE SECRETARY", "Calendar Number 9, Assembly Bill Number 4000, Budget Bill, an act making appropriations."),
        turn(5, "THE SECRETARY", "Calendar Number 77, Print 2310B, by Senator May, an act to amend the Environmental Conservation Law."),
    ]
    got = [(s.cal_no, s.print_no, s.sponsor, s.outcome) for s in segment_calendar(turns)]
    assert got == [
        (1, "S88", "Gianaris", "laid_aside"),
        (412, "A1234A", "Paulin", None),
        (9, "A4000", None, None),
        (77, "S2310B", "May", None),
    ]


def test_real_2025_calendar(fixture_text):
    turns = split_turns(paragraphs(extract_lines(fixture_text("floor-2025-01-13.txt"))))
    segments = segment_calendar(turns)
    assert len(segments) == 15  # every Secretary reading in this real transcript
    assert (segments[0].cal_no, segments[0].print_no, segments[0].sponsor, segments[0].outcome) == (1, "S88", "Gianaris", "laid_aside")


def test_debate_window_ends_at_the_outcome():
    turns = [
        turn(0, "THE SECRETARY", "Calendar Number 5, by Senator Hannon, Senate Print 10, an act."),
        turn(1, "SENATOR LEICHTER", "Explanation. " + "word " * 60),
        turn(2, "ACTING PRESIDENT KUHL", "The bill is passed."),
        turn(3, "SENATOR BRUNO", "I move we adjourn."),
    ]
    (segment,) = segment_calendar(turns)
    assert (segment.start_turn, segment.debate_end, segment.end_turn) == (0, 3, 4)


def test_adopted_resolutions_get_an_outcome():
    turns = [
        turn(0, "THE SECRETARY", "Calendar Number 30, Senate Print 501, by Senator Hannon, Concurrent Resolution."),
        turn(1, "ACTING PRESIDENT KUHL", "The question is on the resolution. All in favor. The resolution is adopted."),
    ]
    (segment,) = segment_calendar(turns)
    assert segment.outcome == "adopted"
