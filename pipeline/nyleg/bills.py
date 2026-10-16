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
_CAL = re.compile(
    r"^Calendar Number (?P<cal>\d+), by Senators? (?P<sponsor>[^,]+), "
    r"(?P<chamber>Senate|Assembly) Print (?:Number )?(?P<num>\d{1,5})(?:-?(?P<amd>[A-Z])\b)?"
)
_AYES = re.compile(r"\bAyes,? (?P<ayes>\d+)\.?(?: Nays,? (?P<nays>\d+))?")
_PASSED = re.compile(r"\bbill is passed\b", re.I)
_LOST = re.compile(r"\bbill is lost\b|\bbill is defeated\b", re.I)
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
    sponsor: str
    start_turn: int
    end_turn: int  # exclusive
    debated: bool
    outcome: str | None  # "passed" | "lost" | "laid_aside" | None
    ayes: int | None
    nays: int | None


def segment_calendar(turns: list[Turn]) -> list[Segment]:
    """One segment per calendar item, from the Secretary's reading to the next reading."""
    starts = [(i, m) for i, t in enumerate(turns) if t.role == ROLE_SECRETARY and (m := _CAL.match(t.text))]
    segments: list[Segment] = []
    for n, (i, m) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(turns)
        outcome: str | None = None
        ayes: int | None = None
        nays: int | None = None
        words = 0
        for t in turns[i + 1:end]:
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
                if outcome:
                    break
        segments.append(Segment(
            cal_no=int(m["cal"]),
            print_no=print_no(m["chamber"], m["num"], m["amd"]),
            sponsor=m["sponsor"].strip(),
            start_turn=i,
            end_turn=end,
            debated=words >= DEBATE_WORDS,
            outcome=outcome,
            ayes=ayes,
            nays=nays,
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
