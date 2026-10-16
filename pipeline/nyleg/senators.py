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
HISTORY_ID_START = 100000  # ids for senators the API doesn't know: they left before 2009
RECORDS_START = 1993  # the first year of floor transcripts


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
    served_from: date | None = None   # joined mid-session (a special election), when known
    served_until: date | None = None  # left mid-session (died or resigned), when known
    img_name: str | None = None       # the API's photo file name, from the latest session
    before_records: bool = False      # already serving in 1993, where these records begin
    incumbent: bool = False           # sitting now, according to the latest API list

    def service(self, current: int) -> list[dict[str, Any]]:
        """Each separate stretch in the Senate, in years: [{"from": 1993, "to": 1996}, {"from": 2001, ...}].
        Known join and leave dates sharpen the ends; "to" is None while still serving."""
        periods: list[dict[str, Any]] = []
        for session in sorted(self.districts):
            if periods and session == periods[-1]["to"] + 1:
                periods[-1]["to"] = session + 1
            else:
                periods.append({"from": session, "to": session + 1})
        if not periods:
            return []
        if self.served_from and periods[0]["from"] <= self.served_from.year <= periods[0]["to"]:
            periods[0]["from"] = self.served_from.year
        if self.served_until and periods[-1]["from"] <= self.served_until.year <= periods[-1]["to"]:
            periods[-1]["to"] = self.served_until.year
        if self.before_records and periods[0]["from"] == RECORDS_START:
            periods[0]["beforeRecords"] = True
        if self.incumbent and max(self.districts) == current and not self.served_until:
            periods[-1]["to"] = None
        return periods


class Roster:
    def __init__(self, senators: dict[int, Senator]) -> None:
        self.senators = senators

    @classmethod
    def from_members(cls, by_session: dict[int, list[dict[str, Any]]], history: list[dict[str, Any]] | None = None,
                     chamber: str = "SENATE") -> "Roster":
        """Build from `/members/{session}/senate?full=true` items, keyed by session year, plus `history`
        rows (see load_history) for the sessions the API doesn't list. API senators are added first, so
        history never changes an existing senator's page address."""
        senators: dict[int, Senator] = {}
        taken: set[str] = set()
        for session in sorted(by_session):
            for item in by_session[session]:
                if (item.get("chamber") or "").upper() != chamber:
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
                senator.img_name = person.get("imgName") or item.get("imgName") or senator.img_name
                senator.incumbent = bool(item.get("incumbent"))
        for row in history or []:
            member_id = int(row["member_id"])
            senator = senators.get(member_id)
            if senator is None:
                if member_id < HISTORY_ID_START:
                    raise ValueError(f"History row {row.get('name')!r} has member_id {member_id}, which is not an API senator")
                slug = slugify(row["name"])
                if slug in taken:
                    slug = f"{slug}-{member_id}"
                taken.add(slug)
                senator = Senator(member_id, slug, row["name"], row.get("first") or "", row.get("last") or "")
                senators[member_id] = senator
            senator.served_from = row.get("from") or senator.served_from
            senator.served_until = row.get("until") or senator.served_until
            senator.before_records = bool(row.get("before_1993")) or senator.before_records
            for session, district in row["sessions"].items():
                senator.short_names[int(session)] = row.get("short") or row.get("last") or senator.last_name
                senator.districts[int(session)] = district
        return cls(senators)

    def in_session(self, session: int) -> list[Senator]:
        return [s for s in self.senators.values() if session in s.short_names]

    def shares_name(self, name: str, session: int) -> bool:
        """Whether anyone in the session could be meant by this name: the same short name or surname."""
        words = norm(name).split()
        if not words:
            return False
        for s in self.in_session(session):
            last = norm(s.last_name).split()
            if same(norm(s.short_names.get(session)), " ".join(words)):
                return True
            if last and len(words) >= len(last) and all(same(a, b) for a, b in zip(words[-len(last):], last)):
                return True
        return False

    def match(self, name: str, session: int, day: date | None = None) -> int | None:
        """Return the member id for a label name like "KRUEGER" or "ADA SMITH". Never guesses.
        `day` leaves out senators who had left or not yet joined, which settles names like "STAVISKY"."""
        key = norm(name)
        if not key:
            return None
        pool = self.in_session(session)
        if day is not None:
            pool = [s for s in pool if (s.served_from is None or s.served_from <= day)
                    and (s.served_until is None or day <= s.served_until)]
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
        if len(words) > 1:
            # First name, then only middle initials, then the whole surname: "JOSEPH P. ADDABBO",
            # "THOMAS F. O'MARA" (the O belongs to the surname, it is not an initial).
            first = words[0]
            found = []
            for s in pool:
                last = norm(s.last_name).split()
                if not last or len(words) <= len(last):
                    continue
                middle = words[1:len(words) - len(last)]
                if (all(same(a, b) for a, b in zip(words[-len(last):], last)) and all(len(w) == 1 for w in middle)
                        and same(norm(s.first_name)[:len(first)], first)):
                    found.append(s)
            if len(found) == 1:
                return found[0].member_id
        return None


def load_history(path: Path) -> list[dict[str, Any]]:
    """Senators of sessions the API doesn't list: a list of {member_id, name, first, last,
    sessions: {session: district}, short (optional, when transcripts use another form)}."""
    if not path.exists():
        return []
    rows = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return [{**row, "sessions": {int(k): v for k, v in (row.get("sessions") or {}).items()}} for row in rows]


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
