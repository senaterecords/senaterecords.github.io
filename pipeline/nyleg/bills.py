"""Find bill mentions, split floor calendars into per-bill segments, and summarise bill records."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .speakers import ROLE_CHAIR, ROLE_PRESIDENT, ROLE_PRESIDING, ROLE_SECRETARY, ROLE_SENATOR, Turn

BILL_DATA_START = 2009  # first session with bill details in the API (to confirm with a live key)
DEBATE_WORDS = 40

_BILL = re.compile(
    r"\b(?P<chamber>Senate|Assembly) (?:Print|Bill) (?:Number |No\. ?)?(?P<num>\d{1,5})(?:-?(?P<amd>[A-Z])\b)?"
)
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


def find_bills(text: str) -> list[str]:
    found: list[str] = []
    for m in _BILL.finditer(text):
        p = print_no(m["chamber"], m["num"], m["amd"])
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
            {"date": v.get("voteDate"), "version": v.get("version"), "counts": counts(v)}
            for v in (raw.get("votes") or {}).get("items") or []
            if v.get("voteType") == "FLOOR"
        ],
        "sameAs": [s.get("printNo") or s.get("basePrintNo") for s in (amendment.get("sameAs") or {}).get("items") or []],
    }
