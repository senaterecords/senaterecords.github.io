"""Build the site data contract (data/site/) from the raw store. See spec section 7."""
from __future__ import annotations

import heapq
import re
import shutil
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from PIL import Image

from .bills import (
    BILL_DATA_START, BillResolver, Segment, base_print_no, bill_card, bill_mentions, load_bill_fixes, segment_calendar,
)
from .clean import PageBreak, Paragraph, extract_lines, paragraphs
from .official import load_official_overrides, official_url
from .officers import Officers, load_officers
from .quality import Report
from .senators import Roster, Senator, load_history, load_overrides, session_year
from .speakers import ROLE_ASSEMBLY, ROLE_CHAIR, ROLE_PRESIDING, ROLE_RECORD, ROLE_SENATOR, Turn, coverage, split_turns
from .store import Store, is_real_photo, read_json, slugify, write_json

FALLBACK_COVERAGE = 0.8
RECENT_REMARKS = 20   # newest remarks kept on each senator page
EXCERPT_TURNS = 3     # debate remarks quoted on a bill page
MATCH_ROLES = (ROLE_SENATOR, ROLE_PRESIDING, ROLE_CHAIR)
_WORD = re.compile(r"[^\W\d_]{4,}")  # letters only, accents included (sepúlveda)


def _clip(text: str, limit: int) -> str:
    """One line of at most limit characters, cut at a word, with an ellipsis when cut."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text.rfind(" ", 0, limit)
    return text[: cut if cut > limit // 2 else limit].rstrip(" ,;:") + "…"


_SENTENCE_END = re.compile(r"[.?!][\"')\]]*(?=\s)|\n")
SAID_SIDE = 140  # characters kept on each side of a mention in a long sentence


def _said(text: str, start: int, end: int) -> str:
    """The sentence a mention is in, on one line: what a link to it washes yellow. A long sentence keeps about
    SAID_SIDE characters on each side of the mention, cut at words."""
    begin = 0
    for m in _SENTENCE_END.finditer(text, 0, start):
        begin = m.end()
    stop = m.end() if (m := _SENTENCE_END.search(text, end)) else len(text)
    if start - begin > SAID_SIDE:
        begin = text.find(" ", start - SAID_SIDE, start) + 1 or begin
    if stop - end > SAID_SIDE:
        cut = text.rfind(" ", end, end + SAID_SIDE)
        stop = cut if cut > end else stop
    return " ".join(text[begin:stop].split())


def _page_at(turn: dict[str, Any], offset: int) -> int | None:
    """The page a character of a turn's text is on."""
    page = turn["page"]
    for at, number in turn["breaks"]:
        if at > offset:
            break
        page = number
    return page


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


def _senator_slug(
    turn: Turn, session: int, roster: Roster, overrides: dict[tuple[int, str], int | None], match_chairs: bool = True,
    day: date | None = None, assembly: Roster | None = None,
) -> str | None:
    if turn.role not in MATCH_ROLES or turn.label is None:
        return None
    key = (session, turn.label.upper())  # overrides are stored upper-case; labels may be "SENATOR DeFRANCISCO"
    if key not in overrides and turn.role == ROLE_CHAIR and not match_chairs:
        # In a joint hearing "CHAIRWOMAN X" may be an Assembly member: match only when that session's
        # Assembly list is known and nobody on it shares the name.
        if assembly is None or not assembly.in_session(session) or assembly.shares_name(turn.name or "", session):
            return None
    member_id = overrides[key] if key in overrides else roster.match(turn.name or "", session, day)
    senator = roster.senators.get(member_id) if member_id is not None else None
    return senator.slug if senator else None


def _assembly_slug(turn: Turn, session: int, roster: Roster, assembly: Roster | None, joint: bool,
                   overrides: dict[tuple[int, str], int | None]) -> str | None:
    """An Assembly member's card: "ASSEMBLYMAN X", or a joint-hearing chair whom no senator shares a name with
    (the mirror of the senator rule, so a chair is never given to both chambers)."""
    if assembly is None or turn.label is None or (session, turn.label.upper()) in overrides:
        return None
    name = turn.name or ""
    if turn.role == ROLE_CHAIR and joint and not roster.shares_name(name, session):
        member_id = assembly.match(name, session)
    elif turn.role == ROLE_ASSEMBLY:
        member_id = assembly.match(name, session)
    else:
        return None
    return assembly.senators[member_id].slug if member_id is not None else None


def _segment_dict(segment: Segment, turns: list[dict[str, Any]]) -> dict[str, Any]:
    body = turns[segment.start_turn:segment.end_turn]
    # Who debated: senators speaking between the reading and the outcome, and only in a real debate
    # ("Lay it aside" and a motion to adjourn after the vote are not debate).
    debate = turns[segment.start_turn + 1:segment.debate_end] if segment.debated else []
    speaking = [t for t in debate if t["role"] in (ROLE_SENATOR, ROLE_CHAIR)]
    speakers = Counter(t["senator"] for t in speaking if t["senator"])
    pages = [t["page"] for t in body if t["page"] is not None] + [page for t in body for _, page in t["breaks"]]
    return {
        "calNo": segment.cal_no,
        "printNo": segment.print_no,
        "sponsor": segment.sponsor,
        "startTurn": segment.start_turn,
        "endTurn": segment.end_turn,
        "debateEnd": segment.debate_end,
        "debated": segment.debated,
        "outcome": segment.outcome,
        "ayes": segment.ayes,
        "nays": segment.nays,
        "remarks": len(speaking),
        "speakers": dict(speakers.most_common()),
        "pages": [min(pages), max(pages)] if pages else None,
        "excerpt": [{"label": t["label"], "senator": t["senator"], "text": _clip(t["text"], 280)}
                    for t in speaking[:EXCERPT_TURNS]],
        "reading": _clip(turns[segment.start_turn]["text"], 280),  # what a link to the reading washes yellow
    }


COVER_HEAD = 1000  # characters of a transcript's cover page, which names its officers


def _officers(kind: str, when: date, text: str, officers: Officers | None) -> dict[str, Any]:
    found: dict[str, Any] = {"president": None, "secretary": None}
    if officers is None or kind != "floor":
        return found
    lg = officers.lieutenant_governor(when)
    if lg:
        found["president"] = {"name": lg["name"], "title": "Lieutenant Governor", "from": lg["from"].year,
                              "until": lg["until"].year if lg["until"] else None}
    secretary = officers.secretary(" ".join(text[:COVER_HEAD].split()))
    if secretary:
        found["secretary"] = {"name": secretary, "title": "Secretary of the Senate"}
    return found


def build_transcript(kind: str, raw: dict[str, Any], roster: Roster, overrides: dict, slug: str,
                     assembly: Roster | None = None, bills: BillResolver | None = None,
                     officers: Officers | None = None) -> dict[str, Any]:
    when = date.fromisoformat(str(raw.get("dateTime") or raw.get("date"))[:10])
    session = session_year(when)
    extraordinary = "EXTRAORDINARY" in str(raw.get("sessionType") or "").upper()
    resolver = bills or BillResolver({}, lambda _session, _base: None)
    unresolved = 0

    def linked_bills(text: str) -> dict[str, list[int]]:
        """Each bill the text names, with where it first names it."""
        nonlocal unresolved
        found: dict[str, list[int]] = {}
        for printed, start, end in bill_mentions(text):
            bill = resolver.resolve(printed, session, when, extraordinary)
            if bill is None:
                unresolved += 1  # a special-session number the API has no bill for: shown, never linked
            elif bill not in found:
                found[bill] = [start, end]
        return found

    text = raw.get("text") or ""
    empty = not text.strip()
    paras = paragraphs(extract_lines(text))
    turns = split_turns(paras)
    cov = coverage(turns)
    plain = cov < FALLBACK_COVERAGE and not empty
    if plain:
        turns = [_as_plain(paras)] if paras else []
    committees = [c for c in raw.get("committees") or [] if isinstance(c, (dict, str))]
    joint = any(isinstance(c, dict) and (c.get("chamber") or "").upper() == "ASSEMBLY" for c in committees)
    out_turns = []
    for t in turns:
        out = {
            "i": t.index,
            "label": t.label,
            "role": t.role,
            "senator": _senator_slug(t, session, roster, overrides, match_chairs=not joint, day=when, assembly=assembly),
            "text": t.text,
            "page": t.page_start,
            "breaks": [[b.offset, b.page] for b in t.breaks],
        }
        named = linked_bills(t.text)
        out["bills"] = list(named)
        if named:
            out["billAt"] = list(named.values())  # where each bill is first named, for links that land on it
        member = _assembly_slug(t, session, roster, assembly, joint, overrides)
        if member:
            out["assembly"] = member  # only on matched turns: millions of turns, so no empty field elsewhere
        out_turns.append(out)
    pages = [t.page_start for t in turns if t.page_start is not None] + [b.page for t in turns for b in t.breaks]
    segments = segment_calendar(turns) if kind == "floor" and not plain else []
    for segment in segments:
        segment.print_no = resolver.resolve(segment.print_no, session, when, extraordinary)
    return {
        "kind": kind,
        "slug": slug,
        "date": when.isoformat(),
        "session": session,
        "sessionType": raw.get("sessionType"),
        "dayType": raw.get("dayType"),
        "title": raw.get("title"),
        "location": raw.get("location") or raw.get("address"),
        "committees": [name for c in committees if (name := c if isinstance(c, str) else c.get("name"))],
        "pages": [min(pages), max(pages)] if pages else None,
        "coverage": round(cov, 4),
        "plainText": plain,
        "empty": empty,
        "corrected": None,
        "turns": out_turns,
        "segments": [_segment_dict(s, out_turns) for s in segments],
        "unresolvedBillMentions": unresolved,
        "officers": _officers(kind, when, text, officers),
    }


def _bill_entry(bills: dict[int, dict[str, dict[str, Any]]], session: int, base: str) -> dict[str, Any]:
    return bills[session].setdefault(
        base, {"basePrintNo": base, "session": session, "card": None, "segments": [], "mentionedIn": []}
    )


def _bill_rows(spoke: Counter, sponsored: set[tuple[int, str, str]]) -> list[dict[str, Any]]:
    """One row per bill a senator debated or sponsored (spec 7: "sponsored or spoke")."""
    rows: dict[tuple[int, str], dict[str, Any]] = {}
    for (session, base, printed), count in spoke.items():
        row = rows.setdefault((session, base), {"session": session, "basePrintNo": base, "printNo": printed,
                                                "remarks": 0, "sponsor": False})
        row["remarks"] += count
    for session, base, printed in sponsored:
        row = rows.setdefault((session, base), {"session": session, "basePrintNo": base, "printNo": printed,
                                                "remarks": 0, "sponsor": False})
        row["sponsor"] = True
    return sorted(rows.values(), key=lambda r: (-r["remarks"], -r["session"], r["basePrintNo"]))


PHOTO_BOX = (120, 156)  # twice the largest card size, so photos stay sharp on high-density screens


def _copy_photo(store: Store, senator: Senator, out: Path, folder: str = "photos") -> str | None:
    """Write a stored API photo to {folder}/{slug}.jpg, shrunk to fit PHOTO_BOX: newer API photos are
    full-resolution originals of several MB. Small ones are never enlarged; senators before 2009 have none."""
    if not is_real_photo(senator.img_name) or not store.photo_path(senator.img_name).exists():
        return None
    target = out / folder / f"{senator.slug}.jpg"
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(store.photo_path(senator.img_name)) as image:
            image = image.convert("RGB")
            image.thumbnail(PHOTO_BOX, Image.Resampling.LANCZOS)
            image.save(target, "JPEG", quality=85, optimize=True)
    except OSError:
        return None  # not a readable image: show no photo rather than a broken one
    return f"{folder}/{senator.slug}.jpg"


def load_roster(store: Store) -> Roster:
    folder = store.raw / "members"
    by_session = {int(p.stem): read_json(p) or [] for p in sorted(folder.glob("*.json"))} if folder.exists() else {}
    # The API lists senators from 2009 only; data/rosters/ covers the sessions before that.
    history = [row for path in sorted((store.root / "rosters").glob("senate-*.yaml")) for row in load_history(path)]
    return Roster.from_members(by_session, history)


def load_assembly(store: Store) -> Roster:
    folder = store.raw / "members-assembly"
    by_session = {int(p.stem): read_json(p) or [] for p in sorted(folder.glob("*.json"))} if folder.exists() else {}
    return Roster.from_members(by_session, chamber="ASSEMBLY")


def _check_out(store: Store, out: Path) -> None:
    """Never wipe anything but a previous build: not the data folder, its parents, or someone's notes."""
    if not out.exists():
        return
    target, root = out.resolve(), store.root.resolve()
    inside_raw = target == root / "raw" or (root / "raw") in target.parents
    previous_build = (out / "meta.json").exists() or not any(out.iterdir())
    if target == root or target in root.parents or inside_raw or not previous_build:
        raise ValueError(f"Refusing to replace {out}: it is not a previous build")


def plan_slugs(store: Store, report: Report) -> list[tuple[str, Path, str]]:
    """(kind, raw path, slug) for every record, with slugs that are unique and don't depend on
    which duplicate happens to sort first: every member of a colliding group gets its file's suffix."""
    planned: list[tuple[str, Path, str]] = []
    for kind, folder in (("floor", "transcripts"), ("hearing", "hearings")):
        for path in store.iter_raw(folder):
            try:
                planned.append((kind, path, transcript_slug(kind, read_json(path))))
            except Exception as exc:  # noqa: BLE001 - one bad record must not stop the build
                report.failed.append(store.raw_key(path))
                print(f"WARNING: skipped {store.raw_key(path)}: {exc}")
    counts = Counter(slug for _, _, slug in planned)
    used: set[str] = set()
    result = []
    for kind, path, slug in planned:
        if counts[slug] > 1:
            slug = f"{slug}-{slugify(path.stem)}"[:120].rstrip("-")
        unique, n = slug, 2
        while unique in used:
            unique, n = f"{slug}-{n}", n + 1
        used.add(unique)
        result.append((kind, path, unique))
    return result


def build_all(store: Store, out: Path, now: datetime, overrides_path: Path | None = None) -> Report:
    """Rebuild everything in `out` from the raw store and return the quality report."""
    _check_out(store, out)
    if out.exists():
        shutil.rmtree(out)
    roster = load_roster(store)
    assembly = load_assembly(store)
    overrides = load_overrides(overrides_path or store.root / "overrides" / "speakers.yaml")
    official = load_official_overrides(store.root / "overrides" / "official-urls.yaml")
    corrections = read_json(store.corrections_path, {}) or {}
    report = Report()
    appearances: dict[str, list[dict[str, Any]]] = defaultdict(list)
    assembly_seen: set[str] = set()
    summaries: list[dict[str, Any]] = []
    recent: dict[str, list[tuple[tuple[str, str, int], dict[str, Any]]]] = defaultdict(list)
    mention_seen: dict[tuple[int, str], set[str]] = defaultdict(set)

    def mention(entry: dict[str, Any], doc: dict[str, Any], slug: str, kind: str, page: int | None,
                turn: int | None, said: str | None) -> None:
        """The first time a transcript names a bill: the page, the remark and the words it is named in."""
        seen = mention_seen[(entry["session"], entry["basePrintNo"])]
        if slug in seen:
            return
        seen.add(slug)
        entry["mentionedIn"].append({"transcript": slug, "kind": kind, "date": doc["date"],
                                     "title": doc["title"] or doc["sessionType"], "page": page,
                                     "turn": turn, "said": said})

    debated_bills: dict[str, Counter] = defaultdict(Counter)
    bills: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    words: Counter = Counter()

    resolver = BillResolver(load_bill_fixes(store.root / "overrides" / "bills.yaml"),
                            lambda session, base: read_json(store.bill_path(session, base)))
    officers = load_officers(store.root / "rosters" / "officers.yaml")
    for kind, path, slug in plan_slugs(store, report):
        try:
            doc = build_transcript(kind, read_json(path), roster, overrides, slug, assembly, resolver, officers)
        except Exception as exc:  # noqa: BLE001 - one bad record must not stop the build
            report.failed.append(store.raw_key(path))
            print(f"WARNING: skipped {store.raw_key(path)}: {exc}")
            continue
        doc["corrected"] = corrections.get(store.raw_key(path))
        write_json(out / "transcripts" / f"{slug}.json", doc)
        if doc["empty"]:
            report.empty.append(slug)

        session = doc["session"]
        total = sum(len(t["text"]) for t in doc["turns"])
        report.floor += kind == "floor"
        report.hearings += kind == "hearing"
        report.per_year[int(doc["date"][:4])] += 1
        summaries.append({
            "slug": slug, "kind": kind, "date": doc["date"], "title": doc["title"], "sessionType": doc["sessionType"],
            "dayType": doc["dayType"], "pages": doc["pages"], "committees": doc["committees"],
            "speakers": len({t["senator"] for t in doc["turns"]
                             if t["senator"] and t["role"] in (ROLE_SENATOR, ROLE_CHAIR)}),
            "billsDebated": sum(1 for s in doc["segments"] if s["debated"]),
            "plainText": doc["plainText"], "corrected": doc["corrected"],
        })
        report.chars_total += total
        # A plain-text fallback publishes no speaker attribution, so it adds nothing here.
        report.chars_attributed += 0 if doc["plainText"] else round(total * min(doc["coverage"], 1.0))
        if doc["plainText"]:
            report.plain_text.append(slug)

        if session >= BILL_DATA_START:
            report.bill_mentions += doc["unresolvedBillMentions"]  # counted, never linked
        spoke = Counter()
        presided = Counter()
        first: dict[str, dict[str, Any]] = {}
        for t in doc["turns"]:
            if t.get("assembly"):
                assembly_seen.add(t["assembly"])
            if t["role"] in (ROLE_SENATOR, ROLE_PRESIDING) and t["label"] and not t["senator"]:
                report.unmatched[f"{session} {t['label']}"] += 1
            if t["senator"]:
                (presided if t["role"] == ROLE_PRESIDING else spoke)[t["senator"]] += 1
                first.setdefault(t["senator"], t)
                if t["role"] in (ROLE_SENATOR, ROLE_CHAIR):
                    key = (doc["date"], slug, t["i"])
                    item = {"transcript": slug, "date": doc["date"], "kind": kind,
                            "title": doc["title"] or doc["sessionType"], "turn": t["i"], "page": t["page"],
                            "text": _clip(t["text"], 400), "bills": t["bills"]}
                    heap = recent[t["senator"]]
                    if len(heap) < RECENT_REMARKS:
                        heapq.heappush(heap, (key, item))
                    elif key > heap[0][0]:
                        heapq.heapreplace(heap, (key, item))
            for printed, at in zip(t["bills"], t.get("billAt", [])):
                base = base_print_no(printed)
                if session >= BILL_DATA_START:
                    report.bill_mentions += 1
                    report.bill_mentions_linked += store.bill_path(session, base).exists()
                mention(_bill_entry(bills, session, base), doc, slug, kind, _page_at(t, at[0]), t["i"],
                        _said(t["text"], *at))
            words.update(_WORD.findall(t["text"].lower()))
        for senator in first:
            appearances[senator].append({
                "transcript": slug,
                "date": doc["date"],
                "kind": kind,
                "title": doc["title"] or doc["sessionType"],
                "remarks": spoke[senator],
                "presiding": presided[senator],
                "firstTurn": first[senator]["i"],
                "firstPage": first[senator]["page"],
            })
        for seg in doc["segments"]:
            if not seg["printNo"]:
                continue  # a special-session reading the API has no bill for
            base = base_print_no(seg["printNo"])
            entry = _bill_entry(bills, session, base)
            entry["segments"].append({"transcript": slug, "date": doc["date"], **seg})
            mention(entry, doc, slug, kind, seg["pages"][0] if seg["pages"] else None, seg["startTurn"], seg["reading"])
            for senator, count in seg["speakers"].items():
                debated_bills[senator][(session, base, seg["printNo"])] += count

    write_json(out / "transcripts.json", sorted(summaries, key=lambda s: (s["date"], s["slug"]), reverse=True))
    sponsored: dict[str, set[tuple[int, str, str]]] = defaultdict(set)
    for session, entries in bills.items():
        for base, entry in entries.items():
            raw_bill = read_json(store.bill_path(session, base))
            entry["card"] = bill_card(raw_bill) if raw_bill else None
            sponsor_id = ((entry["card"] or {}).get("sponsor") or {}).get("memberId")
            if sponsor_id in roster.senators:
                sponsored[roster.senators[sponsor_id].slug].add((session, base, entry["card"]["printNo"] or base))
        write_json(out / "bills" / f"{session}.json", {"session": session, "bills": [entries[k] for k in sorted(entries)]})

    index = []
    for senator in sorted(roster.senators.values(), key=lambda s: (s.last_name.upper(), s.first_name.upper(), s.member_id)):
        apps = sorted(appearances.get(senator.slug, []), key=lambda a: a["date"], reverse=True)
        sessions = {str(k): v for k, v in sorted(senator.districts.items())}
        remarks = sum(a["remarks"] for a in apps)
        presiding = sum(a["presiding"] for a in apps)
        photo = _copy_photo(store, senator, out)
        link = official_url("senate", senator.member_id, senator.full_name, official)
        service = senator.service(current=session_year(now.date()))
        index.append({"slug": senator.slug, "memberId": senator.member_id, "name": senator.full_name, "photo": photo,
                      "officialUrl": link, "service": service, "sessions": sessions, "remarks": remarks,
                      "presiding": presiding, "transcripts": len(apps)})
        own = sponsored.get(senator.slug, set())
        if not apps and not own:
            continue
        write_json(out / "senators" / f"{senator.slug}.json", {
            "slug": senator.slug, "memberId": senator.member_id, "name": senator.full_name, "photo": photo,
            "officialUrl": link, "service": service, "sessions": sessions,
            "totals": {"remarks": remarks, "presiding": presiding, "transcripts": len(apps)},
            "appearances": apps, "bills": _bill_rows(debated_bills[senator.slug], own),
            "recent": [item for _, item in sorted(recent.get(senator.slug, []), key=lambda pair: pair[0], reverse=True)],
        })
    write_json(out / "senators.json", index)

    # Assembly members who speak (joint hearings): card details only, they have no pages here.
    members = {}
    latest_assembly = max((max(m.districts) for m in assembly.senators.values() if m.districts), default=0)
    for member in assembly.senators.values():
        if member.slug in assembly_seen:
            members[member.slug] = {"memberId": member.member_id, "name": member.full_name,
                                    "sessions": {str(k): v for k, v in sorted(member.districts.items())},
                                    "photo": _copy_photo(store, member, out, "photos/assembly"),
                                    "officialUrl": official_url("assembly", member.member_id, member.full_name, official,
                                                                current=bool(member.districts) and max(member.districts) == latest_assembly)}
    write_json(out / "assembly.json", members)

    by_prefix: dict[str, dict[str, int]] = defaultdict(dict)
    for word, count in words.items():
        if count >= 2:
            by_prefix[word[:2]][word] = count
    for prefix, entries in by_prefix.items():
        write_json(out / "words" / f"{prefix}.json", entries)

    write_json(out / "meta.json", {
        # When new records last arrived (sync records it), else when this ran.
        "updatedAt": store.load_state().get("updated_at") or now.replace(microsecond=0).isoformat(),
        "counts": {"floorTranscripts": report.floor, "hearings": report.hearings,
                   "senators": len(appearances), "bills": sum(len(e) for e in bills.values())},
        "quality": report.to_dict(),
    })
    return report
