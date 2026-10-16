"""Measure parse quality and block deploys that make it worse."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Report:
    floor: int = 0
    hearings: int = 0
    chars_total: int = 0
    chars_attributed: int = 0
    bill_mentions: int = 0
    bill_mentions_linked: int = 0
    plain_text: list[str] = field(default_factory=list)
    empty: list[str] = field(default_factory=list)   # transcripts the API returned with no text
    failed: list[str] = field(default_factory=list)  # raw records that could not be built at all
    unmatched: Counter = field(default_factory=Counter)
    per_year: Counter = field(default_factory=Counter)

    @property
    def attribution(self) -> float:
        return self.chars_attributed / self.chars_total if self.chars_total else 1.0

    @property
    def bill_link_rate(self) -> float:
        return self.bill_mentions_linked / self.bill_mentions if self.bill_mentions else 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "floorTranscripts": self.floor,
            "hearings": self.hearings,
            "attribution": round(self.attribution, 4),
            "billLinkRate": round(self.bill_link_rate, 4),
            "plainText": sorted(self.plain_text),
            "empty": sorted(self.empty),
            "failed": sorted(self.failed),
            "unmatchedLabels": dict(self.unmatched.most_common(200)),
            "perYear": {str(year): count for year, count in sorted(self.per_year.items())},
        }


def gate(previous: dict[str, Any] | None, current: Report, max_drop_points: float = 2.0) -> list[str]:
    """Problems that should block a deploy: a quality measure fell by more than `max_drop_points`,
    or the site would lose transcripts (an empty build scores perfectly on the rates)."""
    if not previous:
        return []
    problems: list[str] = []
    for key, label, now in (
        ("attribution", "Text matched to speakers", current.attribution),
        ("billLinkRate", "Bill mentions linked", current.bill_link_rate),
    ):
        before = previous.get(key)
        if before is None:
            continue
        drop = (float(before) - now) * 100
        if drop > max_drop_points:
            problems.append(f"{label} dropped {drop:.1f} points ({float(before) * 100:.1f}% -> {now * 100:.1f}%)")
    for key, label, count in (("floorTranscripts", "Floor transcripts", current.floor), ("hearings", "Hearings", current.hearings)):
        before = previous.get(key)
        if before is not None and count < int(before):
            problems.append(f"{label} fell from {int(before)} to {count}")
    return problems
