from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_text():
    def load(name: str) -> str:
        return (FIXTURES / "text" / name).read_text(encoding="utf-8", errors="replace")

    return load
