"""Find bill mentions, split floor calendars into per-bill segments, and summarise bill records."""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import yaml

from .speakers import ROLE_CHAIR, ROLE_PRESIDENT, ROLE_PRESIDING, ROLE_SECRETARY, ROLE_SENATOR, Turn

BILL_DATA_START = 2009  # first session with bill details in the API (to confirm with a live key)
DEBATE_WORDS = 40
# Raised whenever find_bills learns another way of naming a bill: the next sync then reads every stored record for
# the bills it now finds (2: compact print numbers, "S9051B").
MENTION_RULES = 2

_BILL = re.compile(
    r"\b(?P<chamber>Senate|Assembly) (?:Print|Bill) (?:Number |No\. ?)?(?P<num>\d{1,5})(?:-?(?P<amd>[A-Z])\b)?"
)
# A print number written compactly, as speakers and witnesses often name a bill ("my bill, S9051B", "S1507-C",
# "S5040/A7046"). Three digits or more, standing alone, so codes like "Class A1", "NY-A100" or an Airbus A320 are
# left out.
_COMPACT = re.compile(r"(?<![\w-])(?<!Airbus )(?P<chamber>[SA])(?P<num>\d{3,5})(?:-?(?P<amd>[A-Z]))?(?![\w-])")
_CAL_START = re.compile(r"^Calendar Number (?P<cal>\d+),")
_SPONSOR = re.compile(
    r"\bby (?P<title>Senators?|Assemblymembers?|Assemblyman|Assemblywoman|Members? of the Assembly) (?P<name>[^,]+)"
)
_BARE_PRINT = re.compile(r"\bPrint (?:Number )?(?P<num>\d{1,5})(?:-?(?P<amd>[A-Z])\b)?")
READING_HEAD = 200  # only the start of the Secretary's reading names the bill and sponsor
_AYES = re.compile(r"\bAyes,? (?P<ayes>\d+)\.?(?: Nays,? (?P<nays>\d+))?")
_PASSED = re.compile(r"\bbill is passed\b", re.I)
_LOST = re.compile(r"\bbill is lost\b|\bbill is defeated\b", re.I)
_ADOPTED = re.compile(r"\bresolution is adopted\b", re.I)
_ASIDE = re.compile(r"\blay (?:it|the bill) aside\b|\blaid aside\b", re.I)
_BASE = re.compile(r"^([SA]\d+)[A-Z]?$")


def print_no(chamber: str, num: str, amd: str | None) -> str:
    return f"{'S' if chamber == 'Senate' else 'A'}{int(num)}{amd or ''}"


def base_print_no(value: str) -> str:
    m = _BASE.match(value)
    return m.group(1) if m else value


ES_OFFSET = {"S": 50000, "A": 40000}  # how Open Legislation files extraordinary-session bills
ES_READ_MAX = 1000  # special sessions read small numbers ("Senate Print 25"); larger ones are regular bills
ES_PUBLISHED_WITHIN = timedelta(days=45)  # a special session's bill is introduced shortly before it


def extraordinary_print(printed: str) -> str | None:
    """'S25' read in an extraordinary session -> 'S50025', the number the API files it under."""
    m = re.fullmatch(r"([SA])(\d+)([A-Z]?)", printed)
    if not m or int(m[2]) >= ES_READ_MAX:
        return None
    return f"{m[1]}{ES_OFFSET[m[1]] + int(m[2])}{m[3]}"


def load_bill_fixes(path: Path) -> dict[tuple[str, str], str]:
    """Reviewed fixes for print numbers misread on the floor: [{date, printed, bill}]."""
    if not path.exists():
        return {}
    rows = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return {(str(row["date"]), str(row["printed"]).upper()): str(row["bill"]).upper() for row in rows}


class BillResolver:
    """Which bill a print number read on the floor means, or None when that can't be told."""

    def __init__(self, fixes: dict[tuple[str, str], str], lookup: Callable[[int, str], dict[str, Any] | None]) -> None:
        self.fixes = fixes
        self.lookup = lookup  # (session, base print number) -> stored bill record or None

    def resolve(self, printed: str, session: int, day: date, extraordinary: bool) -> str | None:
        fixed = self.fixes.get((day.isoformat(), printed))
        if fixed:
            return fixed
        if not extraordinary:
            return printed
        candidate = extraordinary_print(printed)
        if candidate is None:
            return printed
        # Several special sessions in one term reuse the same small numbers, and the API keeps only one
        # bill per number: accept it only if it was published for this session, never the regular bill.
        published = str((self.lookup(session, base_print_no(candidate)) or {}).get("publishedDateTime") or "")[:10]
        try:
            when = date.fromisoformat(published)
        except ValueError:
            return None
        return candidate if day - ES_PUBLISHED_WITHIN <= when <= day + timedelta(days=1) else None


def find_bills(text: str) -> list[str]:
    """The bills a text names, in the order it names them: "Senate Print 4597-A" and the like, and compact print
    numbers ("S9051B")."""
    matches = [(m.start(), m["chamber"], m["num"], m["amd"]) for m in _BILL.finditer(text)]
    matches += [(m.start(), "Senate" if m["chamber"] == "S" else "Assembly", m["num"], m["amd"]) for m in _COMPACT.finditer(text)]
    found: list[str] = []
    for _, chamber, num, amd in sorted(matches):
        p = print_no(chamber, num, amd)
        if p not in found:
            found.append(p)
    return found


@dataclass
class Segment:
    cal_no: int
    print_no: str
    sponsor: str | None  # None for budget bills, which are read without a sponsor
    start_turn: int
    end_turn: int  # exclusive: the next reading, or the end of the day
    debated: bool
    outcome: str | None  # "passed" | "lost" | "adopted" (resolutions) | "laid_aside" | None
    ayes: int | None
    nays: int | None
    debate_end: int = 0  # exclusive end of the debate: just past the outcome turn, else end_turn


def parse_reading(text: str) -> tuple[int, str, str | None] | None:
    """(calendar number, print number, sponsor) from a reading in either the 1990s or the modern order."""
    m = _CAL_START.match(text)
    if not m:
        return None
    head = text[m.end():m.end() + READING_HEAD]
    sponsor = _SPONSOR.search(head)
    bill = _BILL.search(head)
    if bill:
        printed = print_no(bill["chamber"], bill["num"], bill["amd"])
    else:
        bare = _BARE_PRINT.search(head)
        if not bare:
            return None
        assembly = bool(sponsor) and not sponsor["title"].startswith("Senator")
        printed = print_no("Assembly" if assembly else "Senate", bare["num"], bare["amd"])
    return int(m["cal"]), printed, sponsor["name"].strip() if sponsor else None


def segment_calendar(turns: list[Turn]) -> list[Segment]:
    """One segment per calendar item, from the Secretary's reading to the next reading."""
    starts = [(i, r) for i, t in enumerate(turns) if t.role == ROLE_SECRETARY and (r := parse_reading(t.text))]
    segments: list[Segment] = []
    for n, (i, (cal_no, printed, sponsor)) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(turns)
        outcome: str | None = None
        ayes: int | None = None
        nays: int | None = None
        words = 0
        debate_end = end
        for j, t in enumerate(turns[i + 1:end], start=i + 1):
            if t.role in (ROLE_SENATOR, ROLE_CHAIR):
                words += len(t.text.split())
            if t.role == ROLE_SECRETARY and (v := _AYES.search(t.text)):
                ayes = int(v["ayes"])
                nays = int(v["nays"]) if v["nays"] else None
            if t.role in (ROLE_PRESIDING, ROLE_PRESIDENT):
                if _ASIDE.search(t.text):
                    outcome = "laid_aside"
                elif _PASSED.search(t.text):
                    outcome = "passed"
                elif _LOST.search(t.text):
                    outcome = "lost"
                elif _ADOPTED.search(t.text):
                    outcome = "adopted"
                if outcome:
                    debate_end = j + 1
                    break
        segments.append(Segment(
            cal_no=cal_no,
            print_no=printed,
            sponsor=sponsor,
            start_turn=i,
            end_turn=end,
            debated=words >= DEBATE_WORDS,
            outcome=outcome,
            ayes=ayes,
            nays=nays,
            debate_end=debate_end,
        ))
    return segments


def bill_card(raw: dict[str, Any]) -> dict[str, Any]:
    """The bill fields the site shows, from a `/bills/{session}/{printNo}?view=no_fulltext` result."""
    sponsor = (raw.get("sponsor") or {}).get("member") or {}
    status = raw.get("status") or {}
    active = raw.get("activeVersion") or ""
    amendment = ((raw.get("amendments") or {}).get("items") or {}).get(active) or {}

    def counts(vote: dict[str, Any]) -> dict[str, int]:
        groups = (vote.get("memberVotes") or {}).get("items") or {}
        return {code: len(group.get("items") or []) for code, group in groups.items()}

    def members(vote: dict[str, Any]) -> dict[str, list[int]]:
        groups = (vote.get("memberVotes") or {}).get("items") or {}
        return {code: [m["memberId"] for m in group.get("items") or [] if m.get("memberId") is not None]
                for code, group in groups.items()}

    committee = status.get("committeeName")
    if not committee:
        past = [c for c in (raw.get("pastCommittees") or {}).get("items") or []
                if (c.get("chamber") or "").upper() == "SENATE"]
        committee = max(past, key=lambda c: c.get("referenceDate") or "").get("name") if past else None

    return {
        "printNo": raw.get("printNo") or raw.get("basePrintNo"),
        "basePrintNo": raw.get("basePrintNo"),
        "session": raw.get("session"),
        "title": raw.get("title"),
        "sponsor": {
            "memberId": sponsor.get("memberId"),
            "name": sponsor.get("fullName"),
            "shortName": sponsor.get("shortName"),
        } if sponsor else None,
        "status": {"type": status.get("statusType"), "text": status.get("statusDesc"), "date": status.get("actionDate")},
        "milestones": [
            {"type": m.get("statusType"), "text": m.get("statusDesc"), "date": m.get("actionDate")}
            for m in (raw.get("milestones") or {}).get("items") or []
        ],
        "signed": bool(raw.get("signed")),
        "vetoed": bool(raw.get("vetoed")),
        "floorVotes": [
            {"date": v.get("voteDate"), "version": v.get("version"), "counts": counts(v), "members": members(v)}
            for v in (raw.get("votes") or {}).get("items") or []
            if v.get("voteType") == "FLOOR"
        ],
        "sameAs": [s.get("printNo") or s.get("basePrintNo") for s in (amendment.get("sameAs") or {}).get("items") or []],
        "committee": committee,
        "coSponsors": len((amendment.get("coSponsors") or {}).get("items") or []),
    }
