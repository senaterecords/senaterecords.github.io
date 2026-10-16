"""Split cleaned paragraphs into speaker turns."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .clean import PageBreak, Paragraph

ROLE_RECORD = "record"
ROLE_SECRETARY = "secretary"
ROLE_PRESIDENT = "president"
ROLE_PRESIDING = "presiding"
ROLE_SENATOR = "senator"
ROLE_ASSEMBLY = "assembly"
ROLE_CHAIR = "chair"
ROLE_GUEST = "guest"

FRONT_MATTER_ALLOWANCE = 3000

_LABEL = re.compile(r"^(?P<label>[A-Z][A-Z0-9.,&'’\- ]{1,90}?)\s*:\s*(?P<rest>.*)$", re.S)
_STOP = {
    "PRESIDING", "PRESENT", "ALSO PRESENT", "ALSO IN ATTENDANCE", "APPEARANCES", "INDEX",
    "SPEAKERS", "LIST OF SPEAKERS", "WITNESSES", "SENATE MEMBERS PRESENT",
    "ROUNDTABLE PARTICIPANTS", "NOTE",
}
_ASSEMBLY = ("ASSEMBLYMAN ", "ASSEMBLYWOMAN ", "ASSEMBLYMEMBER ", "ASSEMBLY MEMBER ")
_CHAIR = ("CHAIRMAN ", "CHAIRWOMAN ", "CHAIRPERSON ", "CHAIR ")


@dataclass
class Turn:
    index: int
    label: str | None
    role: str
    name: str | None
    text: str
    page_start: int | None
    breaks: list[PageBreak] = field(default_factory=list)

    @property
    def page_end(self) -> int | None:
        return self.breaks[-1].page if self.breaks else self.page_start


def parse_label(text: str) -> tuple[str, str] | None:
    m = _LABEL.match(text)
    if not m:
        return None
    label = " ".join(m.group("label").split()).rstrip(".,")
    words = label.split()
    if len(words) > 10 or label in _STOP:
        return None
    if not any(len(w.strip(".,'")) >= 2 for w in words):
        return None
    return label, m.group("rest").strip()


def _name(rest: str) -> str:
    # "TIM KENNEDY, CHAIR, SENATE STANDING COMMITTEE ON TRANSPORTATION" -> "TIM KENNEDY"
    return rest.split(",")[0].strip()


def classify(label: str) -> tuple[str, str | None]:
    if label == "THE SECRETARY":
        return ROLE_SECRETARY, None
    if label == "THE PRESIDENT":
        return ROLE_PRESIDENT, None
    if label.startswith("ACTING PRESIDENT "):
        return ROLE_PRESIDING, _name(label[len("ACTING PRESIDENT "):])
    if label.startswith("SENATOR "):
        return ROLE_SENATOR, _name(label[len("SENATOR "):])
    for prefix in _ASSEMBLY:
        if label.startswith(prefix):
            return ROLE_ASSEMBLY, _name(label[len(prefix):])
    for prefix in _CHAIR:
        if label.startswith(prefix):
            return ROLE_CHAIR, _name(label[len(prefix):])
    return ROLE_GUEST, label


def split_turns(paras: list[Paragraph]) -> list[Turn]:
    turns: list[Turn] = []
    for para in paras:
        parsed = parse_label(para.text)
        if parsed is not None:
            label, rest = parsed
            role, name = classify(label)
            shift = len(para.text) - len(rest)
            breaks = [PageBreak(b.offset - shift, b.page) for b in para.breaks if b.offset - shift > 0]
            page = para.page_start
            early = [b for b in para.breaks if b.offset - shift <= 0]
            if early:
                page = early[-1].page
            turns.append(Turn(len(turns), label, role, name, rest, page, breaks))
            continue
        if not turns:
            turns.append(Turn(0, None, ROLE_RECORD, None, para.text, para.page_start, list(para.breaks)))
            continue
        cur = turns[-1]
        base = len(cur.text) + 2
        if para.page_start is not None and para.page_start != cur.page_end:
            cur.breaks.append(PageBreak(base, para.page_start))
        cur.breaks.extend(PageBreak(base + b.offset, b.page) for b in para.breaks)
        cur.text = f"{cur.text}\n\n{para.text}"
    return turns


def coverage(turns: list[Turn]) -> float:
    total = sum(len(t.text) for t in turns)
    record = sum(len(t.text) for t in turns if t.role == ROLE_RECORD)
    labeled = total - record
    denominator = total - min(record, FRONT_MATTER_ALLOWANCE)
    if denominator <= 0:
        return 1.0 if labeled else 0.0
    return min(1.0, labeled / denominator)
