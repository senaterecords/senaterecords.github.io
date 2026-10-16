from datetime import date

import pytest

from nyleg.senators import Roster, load_history, load_overrides, session_year


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


def members():
    return {
        2009: [
            member(1, "Ada Smith", "Ada", "Smith", "SMITH A", 10, 2009),
            member(2, "Malcolm Smith", "Malcolm", "Smith", "SMITH M", 14, 2009),
            member(3, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 26, 2009),
            {"memberId": 99, "chamber": "ASSEMBLY", "fullName": "Somebody Else", "shortName": "ELSE"},
        ],
        2011: [member(3, "Liz Krueger", "Liz", "Krueger", "KRUEGER", 26, 2011)],
    }


def roster():
    return Roster.from_members(members())


# Senators of sessions the API doesn't list (1993-2007), from data/rosters/.
HISTORY = [
    {"member_id": 100001, "name": "Emanuel R. Gold", "first": "Emanuel", "last": "Gold", "sessions": {1993: 16, 1995: 16}},
    {"member_id": 3, "name": "Liz Krueger", "first": "Liz", "last": "Krueger", "sessions": {2001: 26}},
    {"member_id": 2, "name": "Malcolm Smith", "first": "Malcolm", "last": "Smith", "sessions": {1999: 10}},
    {"member_id": 100002, "name": "Howard Smith", "first": "Howard", "last": "Smith", "sessions": {1999: 12}},
]


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


def test_accents_particles_and_garbled_letters_match_without_guessing():
    r = Roster.from_members({2025: [
        member(10, "Luis R. Sepulveda", "Luis", "Sepulveda", "SEPULVEDA", 32, 2025),
        member(11, "John DeFrancisco", "John", "DeFrancisco", "DEFRANCISCO", 50, 2025),
        member(12, "Ann Smith", "Ann", "Smith", "SMITH", 1, 2025),
        member(13, "Bob Smyth", "Bob", "Smyth", "SMYTH", 2, 2025),
    ]})
    assert r.match("SEPÚLVEDA", 2025) == 10
    assert r.match("SEP�LVEDA", 2025) == 10
    assert r.match("DeFRANCISCO", 2025) == 11
    assert r.match("SM�TH", 2025) is None


def test_accented_api_names_keep_their_accents_and_get_clean_slugs():
    # The live API returns this senator as shortName "SEPULVEDA", lastName "Sepúlveda".
    r = Roster.from_members({2025: [member(10, "Luis R. Sepúlveda", "Luis", "Sepúlveda", "SEPULVEDA", 32, 2025)]})
    assert r.match("SEPÚLVEDA", 2025) == 10
    senator = r.senators[10]
    assert (senator.full_name, senator.slug) == ("Luis R. Sepúlveda", "luis-r-sepulveda")


def test_middle_initials_do_not_block_a_match():
    r = Roster.from_members({2025: [member(20, "Joseph P. Addabbo", "Joseph", "Addabbo", "ADDABBO", 15, 2025)]})
    assert r.match("JOSEPH P. ADDABBO", 2025) == 20
    assert r.match("JOSEPH ADDABBO", 2025) == 20


def test_first_and_last_names_with_an_apostrophe_particle_match():
    # "O" in O'Mara is part of the surname, not a middle initial.
    r = Roster.from_members({2025: [member(30, "Thomas F. O'Mara", "Thomas", "O'Mara", "O'MARA", 58, 2025)]})
    assert r.match("THOMAS O'MARA", 2025) == 30
    assert r.match("THOMAS F. O'MARA", 2025) == 30


def test_shares_name_spots_any_member_with_that_name():
    pretlow = {**member(900, "J. Gary Pretlow", "J. Gary", "Pretlow", "PRETLOW", 89, 2025), "chamber": "ASSEMBLY"}
    assembly = Roster.from_members({2025: [pretlow]}, chamber="ASSEMBLY")
    assert assembly.shares_name("PRETLOW", 2025)
    assert assembly.shares_name("GARY PRETLOW", 2025)
    assert not assembly.shares_name("KRUEGER", 2025)
    assert not assembly.shares_name("PRETLOW", 2023)


def test_senators_before_2009_match_from_the_history_list():
    r = Roster.from_members(members(), history=HISTORY)
    assert r.match("GOLD", 1995) == 100001
    assert r.match("GOLD", 2009) is None  # only in the sessions the list gives
    gold = r.senators[100001]
    assert (gold.full_name, gold.slug, gold.districts) == ("Emanuel R. Gold", "emanuel-r-gold", {1993: 16, 1995: 16})


def test_history_extends_an_api_senator_and_keeps_their_page():
    r = Roster.from_members(members(), history=HISTORY)
    assert r.match("KRUEGER", 2001) == 3
    assert r.match("KRUEGER", 2011) == 3
    krueger = r.senators[3]
    assert krueger.slug == "liz-krueger"
    assert krueger.districts == {2001: 26, 2009: 26, 2011: 26}


def test_history_never_guesses_between_shared_surnames():
    r = Roster.from_members(members(), history=HISTORY)
    assert r.match("SMITH", 1999) is None
    assert r.match("M. SMITH", 1999) == 2
    assert r.match("HOWARD SMITH", 1999) == 100002


def test_history_rows_must_extend_a_real_api_senator_or_use_a_history_id():
    with pytest.raises(ValueError, match="member_id 7"):
        Roster.from_members(members(), history=[
            {"member_id": 7, "name": "Nobody Known", "first": "Nobody", "last": "Known", "sessions": {1995: 1}},
        ])


STAVISKYS = [
    {"member_id": 100010, "name": "Leonard P. Stavisky", "first": "Leonard", "last": "Stavisky",
     "sessions": {1997: 16, 1999: 16}, "until": date(1999, 6, 19)},
    {"member_id": 100011, "name": "Toby Ann Stavisky", "first": "Toby", "last": "Stavisky",
     "sessions": {1999: 16}, "from": date(1999, 11, 2)},
]


def test_service_dates_settle_a_shared_surname_within_a_session():
    r = Roster.from_members({}, history=STAVISKYS)
    assert r.match("STAVISKY", 1999, date(1999, 3, 1)) == 100010
    assert r.match("STAVISKY", 1999, date(2000, 2, 1)) == 100011
    assert r.match("STAVISKY", 1999) is None  # without a date it is still a guess
    assert r.match("STAVISKY", 1997, date(1997, 5, 1)) == 100010


def test_load_history_reads_the_yaml_list(tmp_path):
    path = tmp_path / "senate-1993-2008.yaml"
    path.write_text(
        "- member_id: 100001\n  name: Emanuel R. Gold\n  first: Emanuel\n  last: Gold\n"
        "  sessions: {1993: 16, 1995: 16}\n", encoding="utf-8")
    assert load_history(path) == [HISTORY[0]]
    assert load_history(tmp_path / "missing.yaml") == []
