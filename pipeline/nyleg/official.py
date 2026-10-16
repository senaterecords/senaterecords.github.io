"""Official Senate and Assembly page addresses, derived from names, with reviewed fixes.

The Senate site answers automated requests with 403 for some valid pages, so addresses are not checked on
every run; `python -m nyleg check-official` lists suspects for a person to review."""
from __future__ import annotations

import re
import time
import unicodedata
from collections.abc import Callable
from pathlib import Path

import httpx
import yaml

from .senators import HISTORY_ID_START
from .store import slugify

SENATE = "https://www.nysenate.gov/senators/"
ASSEMBLY = "https://nyassembly.gov/mem/"


def official_url(chamber: str, member_id: int, full_name: str, overrides: dict[str, str | None],
                 current: bool = True) -> str | None:
    """`current`: the member sits in the latest session. nyassembly.gov removes former members' pages."""
    key = f"{chamber}:{member_id}"
    if key in overrides:
        return overrides[key]
    if chamber == "assembly" and not current:
        return None
    if chamber == "senate":
        # Senators who left before 2009 come from data/rosters and have no API record or official page.
        return None if member_id >= HISTORY_ID_START else SENATE + slugify(full_name)
    folded = "".join(c for c in unicodedata.normalize("NFKD", full_name) if not unicodedata.combining(c))
    return ASSEMBLY + "-".join(re.sub(r"[^\w\s-]", "", folded).split())


def load_official_overrides(path: Path) -> dict[str, str | None]:
    """Reviewed fixes: [{member: "senate:401", url: "https://..." or null}]."""
    if not path.exists():
        return {}
    rows = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return {str(row["member"]): row.get("url") for row in rows}


def check_urls(urls: list[tuple[str, str]], client: httpx.Client, pause: float = 1.0,
               sleep: Callable[[float], None] = time.sleep) -> list[tuple[str, str, int | str]]:
    """(name, url, status) for every address that does not answer 200, one request per `pause` seconds."""
    problems: list[tuple[str, str, int | str]] = []
    for name, url in urls:
        try:
            status: int | str = client.head(url, follow_redirects=True).status_code
            if status == 405:
                status = client.get(url, follow_redirects=True).status_code
        except httpx.HTTPError as exc:
            status = type(exc).__name__
        if status != 200:
            problems.append((name, url, status))
        sleep(pause)
    return problems
