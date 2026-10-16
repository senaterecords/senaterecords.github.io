from nyleg.quality import Report, gate


def report(attributed=980, linked=96):
    r = Report(floor=2, hearings=1, chars_total=1000, chars_attributed=attributed, bill_mentions=100, bill_mentions_linked=linked)
    r.plain_text.append("1994-01-05-regular-session")
    r.unmatched["2025 SENATOR NOBODY"] += 3
    r.per_year[2025] += 2
    return r


def test_to_dict():
    d = report().to_dict()
    assert d["attribution"] == 0.98
    assert d["billLinkRate"] == 0.96
    assert d["plainText"] == ["1994-01-05-regular-session"]
    assert d["unmatchedLabels"] == {"2025 SENATOR NOBODY": 3}
    assert d["perYear"] == {"2025": 2}


def test_empty_report_counts_as_perfect():
    assert Report().attribution == 1.0
    assert Report().bill_link_rate == 1.0


def test_gate_allows_small_wobbles_and_first_runs():
    assert gate(None, report()) == []
    assert gate({"attribution": 0.99, "billLinkRate": 0.97}, report()) == []


def test_gate_blocks_a_real_drop():
    problems = gate({"attribution": 0.99, "billLinkRate": 0.96}, report(attributed=950))
    assert problems == ["Text matched to speakers dropped 4.0 points (99.0% -> 95.0%)"]


def test_gate_blocks_an_empty_or_shrunken_site():
    previous = {"attribution": 0.99, "billLinkRate": 0.9, "floorTranscripts": 5000, "hearings": 250}
    assert gate(previous, Report()) == [
        "Floor transcripts fell from 5000 to 0",
        "Hearings fell from 250 to 0",
    ]
