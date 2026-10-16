from datetime import date

from nyleg.officers import Officers, load_officers

OFFICERS = Officers(
    lieutenant_governors=[
        {"name": "Betsy McCaughey Ross", "from": date(1995, 1, 1), "until": date(1998, 12, 31)},
        {"name": "David A. Paterson", "from": date(2007, 1, 1), "until": date(2008, 3, 17)},
        {"name": "Brian A. Benjamin", "from": date(2021, 9, 9), "until": date(2022, 4, 12)},
        {"name": "Antonio Delgado", "from": date(2022, 5, 25), "until": None},
    ],
    secretaries=[
        {"name": "Stephen F. Sloan", "cover": ["SLOAN"]},
        {"name": "Steven M. Boggess", "cover": ["BOGGESS", "BOGGES"]},
        {"name": "Alejandra N. Paulino", "cover": ["PAULINO"]},
    ],
)


def test_the_president_is_the_lieutenant_governor_in_office_that_day():
    assert OFFICERS.lieutenant_governor(date(1997, 6, 3))["name"] == "Betsy McCaughey Ross"
    assert OFFICERS.lieutenant_governor(date(2022, 4, 8))["name"] == "Brian A. Benjamin"
    assert OFFICERS.lieutenant_governor(date(2026, 3, 23))["name"] == "Antonio Delgado"


def test_no_lieutenant_governor_while_the_office_is_vacant():
    assert OFFICERS.lieutenant_governor(date(2008, 6, 18)) is None  # Paterson became Governor
    assert OFFICERS.lieutenant_governor(date(2022, 5, 1)) is None   # between Benjamin and Delgado


def test_the_secretary_is_the_one_named_on_the_cover_page_even_misspelled():
    sloan = "REGULAR SESSION SENATOR HUGH T. FARLEY, Acting President STPHEN F. SLOAN, Secretary P R O C E E D I N G S"
    boggess = "LT. GOVERNOR MARY O. DONOHUE, President STEVEN M. BOGGES, Secretary"
    paulino = "SENATOR NEIL D. BRESLIN, Acting President ALEJANDRA N. PAULINO, ESQ., Secretary"
    assert OFFICERS.secretary(sloan) == "Stephen F. Sloan"
    assert OFFICERS.secretary(boggess) == "Steven M. Boggess"
    assert OFFICERS.secretary(paulino) == "Alejandra N. Paulino"
    assert OFFICERS.secretary("REGULAR SESSION P R O C E E D I N G S") is None


def test_load_officers_reads_the_yaml(tmp_path):
    path = tmp_path / "officers.yaml"
    path.write_text(
        "lieutenant_governors:\n- name: Antonio Delgado\n  from: 2022-05-25\n  until: null\n"
        "secretaries:\n- name: Alejandra N. Paulino\n  cover: [PAULINO]\n", encoding="utf-8")
    officers = load_officers(path)
    assert officers.lieutenant_governor(date(2025, 1, 8))["name"] == "Antonio Delgado"
    assert officers.secretary("ALEJANDRA N. PAULINO, ESQ., Secretary") == "Alejandra N. Paulino"
    empty = load_officers(tmp_path / "missing.yaml")
    assert empty.lieutenant_governor(date(2025, 1, 8)) is None
