"""Where raw API responses and sync state live on disk (the repo's data/ folder)."""
from __future__ import annotations

import json
import os
import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_NON_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    folded = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))
    return _NON_SLUG.sub("-", folded.lower()).strip("-")


def write_json(path: Path, data: Any) -> bool:
    """Write stable, diff-friendly JSON. Returns True only if the file was created or changed."""
    text = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return True


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass
class Store:
    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    @property
    def corrections_path(self) -> Path:
        """{raw path relative to raw/: date the stored text last changed} for re-issued transcripts."""
        return self.root / "corrections.json"

    def raw_key(self, path: Path) -> str:
        return path.relative_to(self.raw).as_posix()

    def transcript_path(self, date_time: str, session_type: str) -> Path:
        name = f"{date_time.replace(':', '')}__{slugify(session_type)}.json"
        return self.raw / "transcripts" / date_time[:4] / name

    def hearing_path(self, year: int, key: str) -> Path:
        return self.raw / "hearings" / str(year) / f"{slugify(key)}.json"

    def members_path(self, session: int) -> Path:
        return self.raw / "members" / f"{session}.json"

    def bill_path(self, session: int, base_print_no: str) -> Path:
        return self.raw / "bills" / str(session) / f"{base_print_no}.json"

    def load_state(self) -> dict[str, Any]:
        return read_json(self.state_path, {}) or {}

    def save_state(self, state: dict[str, Any]) -> None:
        write_json(self.state_path, state)

    def iter_raw(self, kind: str) -> Iterator[Path]:
        folder = self.raw / kind
        if not folder.exists():
            return iter(())
        return iter(sorted(folder.rglob("*.json")))
