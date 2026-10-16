from datetime import date

from nyleg.senators import Roster, load_overrides, session_year


def member(member_id, full, first, last, short, district, session):
    return {
        "memberId": member_id,
        "chamber": "SENATE",
        "fullName": full,
        "shortName": short,
        "districtCode": district,
        "person": {"fullName": full, "firstName": first, "lastName": last},
        "sessionShortNameMap": {
            str(session): [{"shortName": short, "districtCode": district, "sessionYear": session, "memberId": member_id}]
        },
    }


def roster():
    return Roster.from_members({
        2009: [
            member(1, "Ada Smith", "Ada", "Smith", "SMITH A", 10, 2009),
            member(2, "Malcolm Smith", "Malcolm", "Smith", "SMITH M", 14, 2009),
            member(3, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 26, 2009),
            {"memberId": 99, "chamber": "ASSEMBLY", "fullName": "Somebody Else", "shortName": "ELSE"},
        ],
        2011: [member(3, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 26, 2011)],
    })


def test_session_year():
    assert session_year(date(2025, 6, 10)) == 2025
    assert session_year(date(2026, 3, 1)) == 2025


def test_simple_surname_matches():
    assert roster().match("KRUEGER", 2009) == 3


def test_full_name_labels_pick_the_right_smith():
    r = roster()
    assert r.match("ADA SMITH", 2009) == 1
    assert r.match("MALCOLM SMITH", 2009) == 2


def test_bare_shared_surname_is_never_guessed():
    assert roster().match("SMITH", 2009) is None


def test_unknown_names_and_sessions_do_not_match():
    r = roster()
    assert r.match("NOBODY", 2009) is None
    assert r.match("SMITH", 2011) is None
    assert r.match("", 2009) is None


def test_assembly_members_are_ignored_and_sessions_accumulate():
    r = roster()
    assert 99 not in r.senators
    krueger = r.senators[3]
    assert krueger.slug == "liz-krueger"
    assert krueger.districts == {2009: 26, 2011: 26}


def test_slugs_stay_unique_when_names_collide():
    r = Roster.from_members({2009: [
        member(5, "John Smith", "John", "Smith", "SMITH J", 1, 2009),
        member(6, "John Smith", "John", "Smith", "SMITH JR", 2, 2009),
    ]})
    assert sorted(s.slug for s in r.senators.values()) == ["john-smith", "john-smith-6"]


def test_overrides(tmp_path):
    path = tmp_path / "speakers.yaml"
    path.write_text("- session: 2009\n  label: senator smith\n  member_id: 2\n- session: 2009\n  label: SENATOR X\n  member_id: null\n")
    assert load_overrides(path) == {(2009, "SENATOR SMITH"): 2, (2009, "SENATOR X"): None}
    assert load_overrides(tmp_path / "missing.yaml") == {}
