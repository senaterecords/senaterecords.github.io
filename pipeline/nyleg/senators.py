"""Match transcript speaker labels to senators using the API's member lists."""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from .store import slugify

GARBLED = "�"  # a decoding error's replacement character; matches any one letter


def session_year(day: date) -> int:
    """Legislative sessions are two years long and named after the odd year."""
    return day.year if day.year % 2 == 1 else day.year - 1


def norm(value: str | None) -> str:
    """Upper-case, accents folded (Ú -> U), the API's garbled letter kept, everything else a space."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = "".join(c if ("A" <= c <= "Z" or c == GARBLED) else " " for c in text)
    return " ".join(text.split())


def same(a: str, b: str) -> bool:
    """Equal normalized names, where a garbled letter on either side stands for any one letter."""
    return bool(a) and len(a) == len(b) and all(x == y or GARBLED in (x, y) for x, y in zip(a, b))


@dataclass
class Senator:
    member_id: int
    slug: str
    full_name: str
    first_name: str
    last_name: str
    districts: dict[int, int | None] = field(default_factory=dict)
    short_names: dict[int, str] = field(default_factory=dict)


class Roster:
    def __init__(self, senators: dict[int, Senator]) -> None:
        self.senators = senators

    @classmethod
    def from_members(cls, by_session: dict[int, list[dict[str, Any]]]) -> "Roster":
        """Build from `/members/{session}/senate?full=true` items, keyed by session year."""
        senators: dict[int, Senator] = {}
        taken: set[str] = set()
        for session in sorted(by_session):
            for item in by_session[session]:
                if (item.get("chamber") or "").upper() != "SENATE":
                    continue
                member_id = int(item["memberId"])
                person = item.get("person") or {}
                senator = senators.get(member_id)
                if senator is None:
                    full = person.get("fullName") or item.get("fullName") or item.get("shortName") or str(member_id)
                    slug = slugify(full)
                    if slug in taken:
                        slug = f"{slug}-{member_id}"
                    taken.add(slug)
                    senator = Senator(member_id, slug, full, person.get("firstName") or "", person.get("lastName") or "")
                    senators[member_id] = senator
                entries = (item.get("sessionShortNameMap") or {}).get(str(session)) or [
                    {"shortName": item.get("shortName"), "districtCode": item.get("districtCode")}
                ]
                senator.short_names[session] = entries[0].get("shortName") or item.get("shortName") or ""
                senator.districts[session] = entries[0].get("districtCode")
        return cls(senators)

    def in_session(self, session: int) -> list[Senator]:
        return [s for s in self.senators.values() if session in s.short_names]

    def match(self, name: str, session: int) -> int | None:
        """Return the member id for a label name like "KRUEGER" or "ADA SMITH". Never guesses."""
        key = norm(name)
        if not key:
            return None
        pool = self.in_session(session)
        for matches in (
            lambda s: same(norm(s.short_names.get(session)), key),
            lambda s: same(norm(s.last_name), key),
        ):
            found = [s for s in pool if matches(s)]
            if len(found) == 1:
                return found[0].member_id
            if len(found) > 1:
                return None
        words = key.split()
        # "JOSEPH P. ADDABBO": a middle initial must not stop a first-and-last-name match.
        words = [w for i, w in enumerate(words) if i in (0, len(words) - 1) or len(w) > 1]
        if len(words) > 1:
            first, last = words[0], " ".join(words[1:])
            found = [
                s for s in pool
                if same(norm(s.last_name), last) and same(norm(s.first_name)[:len(first)], first)
            ]
            if len(found) == 1:
                return found[0].member_id
        return None


def load_overrides(path: Path) -> dict[tuple[int, str], int | None]:
    """Manual fixes: a list of {session, label, member_id} (member_id null means "not a senator")."""
    if not path.exists():
        return {}
    rows = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return {
        (int(row["session"]), str(row["label"]).upper()): (
            int(row["member_id"]) if row.get("member_id") is not None else None
        )
        for row in rows
    }
