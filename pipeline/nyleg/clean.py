"""Turn raw transcript text into paragraphs that know their official page numbers."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

_DIGITS = re.compile(r"^\d{1,5}$")
_PAGE_WORD = re.compile(r"^Page (\d{1,5})$")
_LINE_NO = re.compile(r"^\s{0,10}(\d{1,2})(?=\s|$)")
_WS = re.compile(r"\s+")
_LABELISH = re.compile(r"^[^\W\d_a-z][^:]{0,90}:")  # starts like "ACTING PRESIDENT BAILEY: ..."
MAX_LINE_NO = 28
PAGE_INDENT = 30
PARA_STEP = 4
EDGE_LINES = 2           # lines at the top and bottom of a page that may be running headers/footers
BOILERPLATE_SHARE = 0.3  # ...and are dropped when repeated on this share of pages (at least 3)


@dataclass
class Line:
    text: str      # content, without the line number or leading spaces
    indent: int    # spaces before the content, after removing the line number
    page: int | None


@dataclass
class PageBreak:
    offset: int    # character offset in the paragraph (or turn) text where the new page starts
    page: int


@dataclass
class Paragraph:
    text: str
    page_start: int | None
    breaks: list[PageBreak] = field(default_factory=list)

    @property
    def page_end(self) -> int | None:
        return self.breaks[-1].page if self.breaks else self.page_start


def _is_numbered(rows: list[str]) -> bool:
    content = [r for r in rows if r.strip() and not _DIGITS.match(r.strip())]
    if not content:
        return False
    hits = 0
    for r in content:
        m = _LINE_NO.match(r)
        if m and int(m.group(1)) <= MAX_LINE_NO:
            hits += 1
    return hits / len(content) >= 0.5


def _drop_boilerplate(lines: list[Line]) -> list[Line]:
    """Remove running headers and vendor footers.

    Boilerplate is text that sits at the edges of many pages and (almost) never anywhere else.
    Speaker labels are never boilerplate, even when a presiding officer opens every page.
    """
    pages: dict[int | None, list[Line]] = defaultdict(list)
    for line in lines:
        pages[line.page].append(line)
    edges: Counter = Counter()
    for page_lines in pages.values():
        edges.update({_WS.sub(" ", l.text) for l in page_lines[:EDGE_LINES] + page_lines[-EDGE_LINES:]})
    everywhere = Counter(_WS.sub(" ", l.text) for l in lines)
    floor = max(3, BOILERPLATE_SHARE * len(pages))
    boilerplate = {
        text for text, at_edges in edges.items()
        if at_edges >= floor
        and everywhere[text] <= at_edges + max(1, at_edges // 20)
        and not _LABELISH.match(text)
    }
    return [l for l in lines if _WS.sub(" ", l.text) not in boilerplate]


def extract_lines(raw: str) -> list[Line]:
    rows = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n").expandtabs(8).split("\n")
    numbered = _is_numbered(rows)
    lines: list[Line] = []
    page: int | None = None
    prev_wide_blank = False
    for row in rows:
        stripped = row.strip()
        if not stripped:
            prev_wide_blank = len(row) >= PAGE_INDENT
            continue
        lead = len(row) - len(row.lstrip(" "))
        worded = _PAGE_WORD.match(stripped)
        if worded and lead >= PAGE_INDENT:
            page = int(worded.group(1))
            prev_wide_blank = False
            continue
        if _DIGITS.match(stripped):
            value = int(stripped)
            if lead >= PAGE_INDENT or prev_wide_blank or value > MAX_LINE_NO:
                page = value
            prev_wide_blank = False
            continue  # a page number, or a bare line number on an empty line
        prev_wide_blank = False
        body = row.rstrip()
        if numbered:
            m = _LINE_NO.match(body)
            if m and int(m.group(1)) <= MAX_LINE_NO:
                body = body[m.end():]
        content = body.lstrip(" ")
        if content:
            lines.append(Line(text=content, indent=len(body) - len(content), page=page))
    return _drop_boilerplate(lines)


def body_indent(lines: list[Line]) -> int:
    """The indent of ordinary continuation lines, which usually start in lower case."""
    lower = Counter(l.indent for l in lines if l.text[:1].islower())
    pool = lower if lower else Counter(l.indent for l in lines)
    return pool.most_common(1)[0][0]


def paragraphs(lines: list[Line]) -> list[Paragraph]:
    """Join wrapped lines. A line indented PARA_STEP past the body indent starts a new paragraph."""
    if not lines:
        return []
    threshold = body_indent(lines) + PARA_STEP
    out: list[Paragraph] = []
    cur: Paragraph | None = None
    for line in lines:
        text = _WS.sub(" ", line.text).strip()
        if cur is None or line.indent >= threshold:
            cur = Paragraph(text=text, page_start=line.page)
            out.append(cur)
            continue
        offset = len(cur.text) + 1
        if line.page is not None and line.page != cur.page_end:
            cur.breaks.append(PageBreak(offset=offset, page=line.page))
        cur.text = f"{cur.text} {text}"
    return out
