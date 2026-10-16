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
