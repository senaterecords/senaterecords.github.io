import pytest

from nyleg.clean import PageBreak, Paragraph, extract_lines, paragraphs
from nyleg.speakers import classify, coverage, parse_label, split_turns


def test_parse_label():
    assert parse_label("ACTING PRESIDENT BRESLIN: The Senate will come to order.") == (
        "ACTING PRESIDENT BRESLIN",
        "The Senate will come to order.",
    )
    assert parse_label("SENATOR ADA SMITH: Thank you.") == ("SENATOR ADA SMITH", "Thank you.")
    assert parse_label("OCFS COMMISSIONER POOLE: Thank you.") == ("OCFS COMMISSIONER POOLE", "Thank you.")
    assert parse_label("MR. PATRICK J. FOYE, CHAIRMAN & CEO, METROPOLITAN TRANSPORTATION AUTHORITY: Thank you.") == (
        "MR. PATRICK J. FOYE, CHAIRMAN & CEO, METROPOLITAN TRANSPORTATION AUTHORITY",
        "Thank you.",
    )
    assert parse_label("PRESIDING:") is None
    assert parse_label("Senator Smith: lower case is not a label") is None
    assert parse_label("(Whereupon, the Senate joined in the Pledge.)") is None


@pytest.mark.parametrize(
    "label,expected",
    [
        ("THE SECRETARY", ("secretary", None)),
        ("THE PRESIDENT", ("president", None)),
        ("ACTING PRESIDENT KUHL", ("presiding", "KUHL")),
        ("SENATOR ADA SMITH", ("senator", "ADA SMITH")),
        ("ASSEMBLYMAN FARRELL", ("assembly", "FARRELL")),
        ("CHAIRWOMAN KRUEGER", ("chair", "KRUEGER")),
        ("MS. MILLER", ("guest", "MS. MILLER")),
        ("SENATOR TIM KENNEDY, CHAIR, SENATE STANDING COMMITTEE ON TRANSPORTATION", ("senator", "TIM KENNEDY")),
        ("ASSEMBLY MEMBER PAULIN", ("assembly", "PAULIN")),
    ],
)
def test_classify(label, expected):
    assert classify(label) == expected


def test_split_turns_attaches_unlabelled_paragraphs_and_carries_page_breaks():
    paras = [
        Paragraph("NEW YORK STATE SENATE", 7582),
        Paragraph("ACTING PRESIDENT BRESLIN: The Senate will come to order.", 7583),
        Paragraph("The Secretary will begin by reading the Journal.", 7583),
        Paragraph("THE SECRETARY: In session, Tuesday.", 7583, [PageBreak(len("THE SECRETARY: In session, "), 7584)]),
        Paragraph("Second paragraph on the new page.", 7585),
    ]
    turns = split_turns(paras)
    assert [t.role for t in turns] == ["record", "presiding", "secretary"]
    assert turns[1].text == "The Senate will come to order.\n\nThe Secretary will begin by reading the Journal."
    assert turns[2].text == "In session, Tuesday.\n\nSecond paragraph on the new page."
    assert [(b.offset, b.page) for b in turns[2].breaks] == [
        (len("In session, "), 7584),
        (len("In session, Tuesday.") + 2, 7585),
    ]
    assert (turns[2].page_start, turns[2].page_end) == (7583, 7585)


def test_coverage_ignores_short_front_matter():
    turns = split_turns([Paragraph("COVER PAGE " * 100, 1), Paragraph("THE SECRETARY: Ayes 48.", 2)])
    assert coverage(turns) == 1.0


def test_coverage_is_zero_when_no_speakers_are_found():
    assert coverage(split_turns([Paragraph("Some text without any labels at all.", 1)])) == 0.0


def turns_for(fixture_text, name):
    return split_turns(paragraphs(extract_lines(fixture_text(name))))


def test_2020_legislative_day_with_only_procedural_voices(fixture_text):
    turns = turns_for(fixture_text, "floor-2020-01-01.txt")
    assert [t.label for t in turns] == [None, "ACTING PRESIDENT BRESLIN", "THE SECRETARY", "ACTING PRESIDENT BRESLIN"]
    assert turns[1].page_start == 7583
    assert turns[1].text.startswith("The Senate will come to order.")
    assert turns[2].text.startswith("In session, Tuesday, December 31, 2019")
    assert coverage(turns) == 1.0


def test_1993_session(fixture_text):
    turns = turns_for(fixture_text, "floor-1993-03-10.txt")
    assert (turns[1].label, turns[1].page_start) == ("ACTING PRESIDENT MEGA", 1081)
    assert turns[1].text.startswith("Senate will come to order.")
    assert (turns[3].label, turns[3].role) == ("REVEREND SELWYN WILKINSON", "guest")


def test_2000_session(fixture_text):
    turns = turns_for(fixture_text, "floor-2000-01-05.txt")
    assert (turns[1].label, turns[1].role, turns[1].page_start) == ("THE PRESIDENT", "president", 2)
    assert any(t.label == "ASSEMBLYMAN FARRELL" and t.role == "assembly" for t in turns)


def test_hearing_skips_front_matter_labels(fixture_text):
    turns = turns_for(fixture_text, "hearing-2011-05-18.txt")
    assert (turns[1].label, turns[1].role, turns[1].page_start) == ("SENATOR VALESKY", "senator", 4)
    assert turns[1].text.startswith("I want to welcome everyone")
    assert (turns[2].label, turns[2].page_start) == ("MS. MILLER", 6)
    assert not any(t.label == "PRESIDING" for t in turns)


def test_vendor_hearing_with_running_headers_footers_and_long_titles(fixture_text):
    turns = turns_for(fixture_text, "hearing-2020-08-25-vendor.txt")
    assert (turns[1].role, turns[1].name, turns[1].page_start) == ("senator", "TIM KENNEDY", 8)
    assert turns[2].label.startswith("MR. PATRICK J. FOYE, CHAIRMAN & CEO")
    assert (turns[3].label, turns[3].page_start, turns[3].text) == ("SENATOR COMRIE", 14, "Yes.")
    assert not any("Geneva Worldwide" in t.text or "Joint Hearing Impact" in t.text for t in turns)
    assert coverage(turns) > 0.95
