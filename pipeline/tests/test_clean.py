import time

import pytest

from nyleg.clean import extract_lines, paragraphs


def test_a_huge_single_paragraph_is_joined_in_linear_time():
    rows = "".join(f"         2       word{i} continues the same paragraph\n" for i in range(50_000))
    lines = extract_lines("         1                      THE SECRETARY:  Begin\n" + rows)
    start = time.perf_counter()
    paras = paragraphs(lines)
    assert len(paras) == 1
    assert time.perf_counter() - start < 2.0


def test_strips_line_numbers_and_reads_right_aligned_page_numbers():
    raw = (
        "                                                               7583\n\n"
        " 1                P R O C E E D I N G S\n\n"
        " 2                ACTING PRESIDENT BRESLIN:   The\n\n"
        " 3   Senate will come to order.\n"
    )
    lines = extract_lines(raw)
    assert [line.text for line in lines] == [
        "P R O C E E D I N G S",
        "ACTING PRESIDENT BRESLIN:   The",
        "Senate will come to order.",
    ]
    assert {line.page for line in lines} == {7583}


def test_unnumbered_format_keeps_leading_digits_in_the_text():
    raw = (
        "                                                           3\n\n"
        "                             THE PRESIDENT:    The Secretary\n\n"
        "                 2020 budget talks will continue.\n"
    )
    lines = extract_lines(raw)
    assert lines[1].text == "2020 budget talks will continue."
    assert lines[0].page == 3


def test_left_aligned_page_numbers_from_the_1990s():
    raw = (
        "                                                             \n"
        "1081\n\n"
        "         1                      ACTING PRESIDENT MEGA:  Senate\n\n"
        "         2       will come to order.\n"
    )
    lines = extract_lines(raw)
    assert [line.page for line in lines] == [1081, 1081]
    assert lines[0].indent > lines[1].indent


def test_crlf_and_form_feeds_are_handled():
    raw = "\f                                                     12\r\n 1          THE SECRETARY:  Ayes 48.\r\n"
    lines = extract_lines(raw)
    assert [(line.text, line.page) for line in lines] == [("THE SECRETARY:  Ayes 48.", 12)]


def test_paragraphs_join_wrapped_lines_and_record_page_breaks():
    raw = (
        "                                                               5780\n\n"
        " 24              SENATOR ORTEGA:   This bill does\n\n"
        " 25   one thing.\n\n"
        "                                                               5781\n\n"
        " 1   It says the program has to answer.\n\n"
        " 2               SENATOR KEARNEY:   Will the sponsor\n\n"
        " 3   yield?\n"
    )
    paras = paragraphs(extract_lines(raw))
    assert [p.text for p in paras] == [
        "SENATOR ORTEGA: This bill does one thing. It says the program has to answer.",
        "SENATOR KEARNEY: Will the sponsor yield?",
    ]
    assert paras[0].page_start == 5780
    assert [(b.offset, b.page) for b in paras[0].breaks] == [(len("SENATOR ORTEGA: This bill does one thing. "), 5781)]
    assert paras[1].page_start == 5781
    assert paras[1].breaks == []


def test_vendor_page_headers_running_headers_and_footers_are_removed():
    page = (
        "\f                                                    Page {n}\n"
        "1    Joint Hearing on the MTA, 8-25-20\n\n"
        "2                 SENATOR COMRIE:   Line {n} of testimony\n\n"
        "3       continues here.\n\n\n"
        "                           Geneva Worldwide, Inc.\n"
        "           256 West 38 t h Street, 10 t h Floor, New York, NY 10018\n"
    )
    lines = extract_lines("".join(page.format(n=n) for n in (2, 3, 4)))
    assert not any("Geneva" in l.text or "West 38" in l.text or "Joint Hearing" in l.text for l in lines)
    assert [l.page for l in lines] == [2, 2, 3, 3, 4, 4]


def test_empty_text_gives_no_paragraphs():
    assert paragraphs(extract_lines("")) == []


def test_repeated_speaker_lines_at_page_edges_are_not_mistaken_for_headers(fixture_text):
    # In this real 23-page session, "ACTING PRESIDENT BAILEY:   The" opens a page 22 times;
    # the old filter deleted all 22 and glued the presiding officer's words onto other speakers.
    lines = extract_lines(fixture_text("floor-2025-04-10.txt"))
    assert sum(1 for l in lines if l.text == "ACTING PRESIDENT BAILEY:   The") == 22
    assert sum(1 for l in lines if l.text.startswith("ACTING PRESIDENT BAILEY:")) == 53


def test_common_speech_on_a_short_day_is_kept(fixture_text):
    # Pages 1522-1527 of the 1998 transcript, as if they were a whole six-page day.
    rows = fixture_text("floor-1998-03-10.txt").split("\n")
    start = next(i for i, r in enumerate(rows) if r.strip() == "1522" and len(r) - len(r.lstrip()) >= 30)
    end = next(i for i, r in enumerate(rows) if r.strip() == "1528" and len(r) - len(r.lstrip()) >= 30)
    lines = extract_lines("\n".join(rows[start:end]))
    assert sum(1 for l in lines if l.text == "is passed.") == 9


@pytest.mark.parametrize(
    "name,first_page",
    [
        ("floor-1993-03-10.txt", 1080),
        ("floor-2000-01-05.txt", 1),
        ("floor-2020-01-01.txt", 7582),
        ("hearing-2011-05-18.txt", None),
        ("hearing-2020-08-25-vendor.txt", None),
    ],
)
def test_real_transcripts_from_each_era(fixture_text, name, first_page):
    paras = paragraphs(extract_lines(fixture_text(name)))
    assert len(paras) > 10
    assert paras[0].page_start == first_page


def test_all_caps_transcripts_still_split_into_paragraphs(fixture_text):
    # A short legislative day typed in capitals: no line starts in lower case, and the centred cover lines
    # outnumber the wrapped body lines, so the body indent must come from the smallest common indent.
    from nyleg.speakers import split_turns

    paras = paragraphs(extract_lines(fixture_text("floor-2013-11-01-allcaps.txt")))
    labels = [t.label for t in split_turns(paras) if t.label]
    assert labels[:3] == ["ACTING PRESIDENT MARCHIONE", "THE SECRETARY", "ACTING PRESIDENT MARCHIONE"]
