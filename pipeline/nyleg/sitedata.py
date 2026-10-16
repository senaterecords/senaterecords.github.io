"""Build the site data contract (data/site/) from the raw store. See spec section 7."""
from __future__ import annotations

import re
import shutil
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .bills import BILL_DATA_START, Segment, base_print_no, bill_card, find_bills, segment_calendar
from .clean import PageBreak, Paragraph, extract_lines, paragraphs
from .quality import Report
from .senators import Roster, load_overrides, session_year
from .speakers import ROLE_CHAIR, ROLE_PRESIDING, ROLE_RECORD, ROLE_SENATOR, Turn, coverage, split_turns
from .store import Store, read_json, slugify, write_json

FALLBACK_COVERAGE = 0.8
MATCH_ROLES = (ROLE_SENATOR, ROLE_PRESIDING, ROLE_CHAIR)
_WORD = re.compile(r"[a-z]{4,}")


def transcript_slug(kind: str, raw: dict[str, Any]) -> str:
    if kind == "floor":
        return f"{raw['dateTime'][:10]}-{slugify(raw.get('sessionType') or 'session')}"
    return f"{str(raw['date'])[:10]}-{slugify(raw.get('title') or 'public hearing')}"[:100].rstrip("-")


def _as_plain(paras: list[Paragraph]) -> Turn:
    text = ""
    page: int | None = None
    breaks: list[PageBreak] = []
    for para in paras:
        base = len(text) + 2 if text else 0
        current = breaks[-1].page if breaks else page
        if page is None:
            page = para.page_start
        elif para.page_start is not None and para.page_start != current:
            breaks.append(PageBreak(base, para.page_start))
        breaks.extend(PageBreak(base + b.offset, b.page) for b in para.breaks)
        text = f"{text}\n\n{para.text}" if text else para.text
    return Turn(0, None, ROLE_RECORD, None, text, page, breaks)


def _senator_slug(turn: Turn, session: int, roster: Roster, overrides: dict[tuple[int, str], int | None]) -> str | None:
    if turn.role not in MATCH_ROLES or turn.label is None:
        return None
    key = (session, turn.label)
    member_id = overrides[key] if key in overrides else roster.match(turn.name or "", session)
    senator = roster.senators.get(member_id) if member_id is not None else None
    return senator.slug if senator else None


def _segment_dict(segment: Segment, turns: list[dict[str, Any]]) -> dict[str, Any]:
    body = turns[segment.start_turn:segment.end_turn]
    speakers = Counter(t["senator"] for t in body if t["senator"] and t["role"] != ROLE_PRESIDING)
    pages = [t["page"] for t in body if t["page"] is not None]
    return {
        "calNo": segment.cal_no,
        "printNo": segment.print_no,
        "sponsor": segment.sponsor,
        "startTurn": segment.start_turn,
        "endTurn": segment.end_turn,
        "debated": segment.debated,
        "outcome": segment.outcome,
        "ayes": segment.ayes,
        "nays": segment.nays,
        "remarks": sum(1 for t in body[1:] if t["role"] in (ROLE_SENATOR, ROLE_CHAIR)),
        "speakers": dict(speakers.most_common()),
        "pages": [min(pages), max(pages)] if pages else None,
    }


def build_transcript(kind: str, raw: dict[str, Any], roster: Roster, overrides: dict, slug: str) -> dict[str, Any]:
    when = date.fromisoformat(str(raw.get("dateTime") or raw.get("date"))[:10])
    session = session_year(when)
    paras = paragraphs(extract_lines(raw.get("text") or ""))
    turns = split_turns(paras)
    cov = coverage(turns)
    plain = cov < FALLBACK_COVERAGE
    if plain:
        turns = [_as_plain(paras)] if paras else []
    out_turns = [
        {
            "i": t.index,
            "label": t.label,
            "role": t.role,
            "senator": _senator_slug(t, session, roster, overrides),
            "text": t.text,
            "page": t.page_start,
            "breaks": [[b.offset, b.page] for b in t.breaks],
            "bills": find_bills(t.text),
        }
        for t in turns
    ]
    pages = [t.page_start for t in turns if t.page_start is not None] + [b.page for t in turns for b in t.breaks]
    segments = segment_calendar(turns) if kind == "floor" and not plain else []
    return {
        "kind": kind,
        "slug": slug,
        "date": when.isoformat(),
        "session": session,
        "sessionType": raw.get("sessionType"),
        "dayType": raw.get("dayType"),
        "title": raw.get("title"),
        "location": raw.get("location") or raw.get("address"),
        "committees": [c.get("name") for c in raw.get("committees") or [] if c.get("name")],
        "pages": [min(pages), max(pages)] if pages else None,
        "coverage": round(cov, 4),
        "plainText": plain,
        "corrected": None,
        "turns": out_turns,
        "segments": [_segment_dict(s, out_turns) for s in segments],
    }


def load_roster(store: Store) -> Roster:
    folder = store.raw / "members"
    by_session = {int(p.stem): read_json(p) or [] for p in sorted(folder.glob("*.json"))} if folder.exists() else {}
    return Roster.from_members(by_session)


def build_all(store: Store, out: Path, now: datetime, overrides_path: Path | None = None) -> Report:
    """Rebuild everything in `out` from the raw store and return the quality report."""
    if out.exists():
        shutil.rmtree(out)
    roster = load_roster(store)
    overrides = load_overrides(overrides_path or store.root / "overrides" / "speakers.yaml")
    corrections = read_json(store.corrections_path, {}) or {}
    report = Report()
    seen: set[str] = set()
    appearances: dict[str, list[dict[str, Any]]] = defaultdict(list)
    debated_bills: dict[str, Counter] = defaultdict(Counter)
    bills: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    words: Counter = Counter()

    for kind, folder in (("floor", "transcripts"), ("hearing", "hearings")):
        for path in store.iter_raw(folder):
            raw = read_json(path)
            slug = transcript_slug(kind, raw)
            if slug in seen:
                slug = f"{slug}-{slugify(path.stem)}"[:120]
            seen.add(slug)
            doc = build_transcript(kind, raw, roster, overrides, slug)
            doc["corrected"] = corrections.get(store.raw_key(path))
            write_json(out / "transcripts" / f"{slug}.json", doc)

            session = doc["session"]
            total = sum(len(t["text"]) for t in doc["turns"])
            report.floor += kind == "floor"
            report.hearings += kind == "hearing"
            report.per_year[int(doc["date"][:4])] += 1
            report.chars_total += total
            report.chars_attributed += round(total * min(doc["coverage"], 1.0))
            if doc["plainText"]:
                report.plain_text.append(slug)

            per_senator = Counter()
            first: dict[str, dict[str, Any]] = {}
            for t in doc["turns"]:
                if t["role"] in (ROLE_SENATOR, ROLE_PRESIDING) and t["label"] and not t["senator"]:
                    report.unmatched[f"{session} {t['label']}"] += 1
                if t["senator"]:
                    per_senator[t["senator"]] += 1
                    first.setdefault(t["senator"], t)
                for printed in t["bills"]:
                    if session >= BILL_DATA_START:
                        report.bill_mentions += 1
                        report.bill_mentions_linked += store.bill_path(session, base_print_no(printed)).exists()
                words.update(_WORD.findall(t["text"].lower()))
            for senator, count in per_senator.items():
                appearances[senator].append({
                    "transcript": slug,
                    "date": doc["date"],
                    "kind": kind,
                    "title": doc["title"] or doc["sessionType"],
                    "remarks": count,
                    "firstTurn": first[senator]["i"],
                    "firstPage": first[senator]["page"],
                })
            for seg in doc["segments"]:
                base = base_print_no(seg["printNo"])
                entry = bills[session].setdefault(base, {"basePrintNo": base, "session": session, "card": None, "segments": []})
                entry["segments"].append({"transcript": slug, "date": doc["date"], **seg})
                for senator, count in seg["speakers"].items():
                    debated_bills[senator][(session, base, seg["printNo"])] += count

    sponsors: dict[tuple[int, str], int | None] = {}
    for session, entries in bills.items():
        for base, entry in entries.items():
            raw_bill = read_json(store.bill_path(session, base))
            entry["card"] = bill_card(raw_bill) if raw_bill else None
            sponsors[(session, base)] = ((entry["card"] or {}).get("sponsor") or {}).get("memberId")
        write_json(out / "bills" / f"{session}.json", {"session": session, "bills": [entries[k] for k in sorted(entries)]})

    index = []
    for senator in sorted(roster.senators.values(), key=lambda s: (s.last_name.upper(), s.first_name.upper(), s.member_id)):
        apps = sorted(appearances.get(senator.slug, []), key=lambda a: a["date"], reverse=True)
        sessions = {str(k): v for k, v in sorted(senator.districts.items())}
        remarks = sum(a["remarks"] for a in apps)
        index.append({"slug": senator.slug, "memberId": senator.member_id, "name": senator.full_name,
                      "sessions": sessions, "remarks": remarks, "transcripts": len(apps)})
        if not apps:
            continue
        bill_rows = [
            {"session": s, "basePrintNo": b, "printNo": p, "remarks": n, "sponsor": sponsors.get((s, b)) == senator.member_id}
            for (s, b, p), n in debated_bills[senator.slug].most_common()
        ]
        write_json(out / "senators" / f"{senator.slug}.json", {
            "slug": senator.slug, "memberId": senator.member_id, "name": senator.full_name, "sessions": sessions,
            "totals": {"remarks": remarks, "transcripts": len(apps)}, "appearances": apps, "bills": bill_rows,
        })
    write_json(out / "senators.json", index)

    by_prefix: dict[str, dict[str, int]] = defaultdict(dict)
    for word, count in words.items():
        if count >= 2:
            by_prefix[word[:2]][word] = count
    for prefix, entries in by_prefix.items():
        write_json(out / "words" / f"{prefix}.json", entries)

    write_json(out / "meta.json", {
        "updatedAt": now.replace(microsecond=0).isoformat(),
        "counts": {"floorTranscripts": report.floor, "hearings": report.hearings,
                   "senators": len(appearances), "bills": sum(len(e) for e in bills.values())},
        "quality": report.to_dict(),
    })
    return report
