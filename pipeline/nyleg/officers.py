"""Who "THE PRESIDENT" and "THE SECRETARY" were on a given day.

"THE PRESIDENT" is the Lieutenant Governor presiding; nobody holds the title while the office is vacant.
"THE SECRETARY" is the Senate's officer at the desk; each transcript's cover page names the Secretary of
the Senate that day (a deputy often does the reading, so the card says who held the office, not who read).
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from .senators import norm

_COVER_SECRETARY = re.compile(r"([^,]{0,60}),\s*(?:ESQ\.?,\s*)?(?:Acting\s+)?Secretary\b")


class Officers:
    def __init__(self, lieutenant_governors: list[dict[str, Any]], secretaries: list[dict[str, Any]]) -> None:
        self.lieutenant_governors = lieutenant_governors  # [{name, from, until (None while in office)}]
        self.secretaries = secretaries                    # [{name, cover: [surname spellings seen on covers]}]

    def lieutenant_governor(self, day: date) -> dict[str, Any] | None:
        for lg in self.lieutenant_governors:
            if lg["from"] <= day and (lg["until"] is None or day <= lg["until"]):
                return lg
        return None

    def secretary(self, cover: str) -> str | None:
        """The Secretary named on a cover page ("ALEJANDRA N. PAULINO, ESQ., Secretary"), matched by surname
        so cover typos ("STPHEN F. SLOAN", "STEVEN M. BOGGES") still give the proper name."""
        m = _COVER_SECRETARY.search(cover)
        if not m:
            return None
        words = norm(m.group(1)).split()
        for secretary in self.secretaries:
            if any(spelling in words for spelling in secretary["cover"]):
                return secretary["name"]
        return None


def load_officers(path: Path) -> Officers:
    if not path.exists():
        return Officers([], [])
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return Officers(data.get("lieutenant_governors") or [], data.get("secretaries") or [])
