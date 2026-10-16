import pytest

from nyleg.__main__ import EXIT_AUTH, EXIT_GATE, api_client, emit, main, years
from nyleg.store import Store, read_json, write_json


def test_years():
    assert years("2025") == [2025]
    assert years("1993-1995") == [1993, 1994, 1995]


def test_emit_writes_github_output(tmp_path, monkeypatch, capsys):
    target = tmp_path / "out.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(target))
    emit("changed", "true")
    assert target.read_text() == "changed=true\n"
    assert "changed=true" in capsys.readouterr().out


def test_sync_without_a_key_exits_with_the_auth_code(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("NYSENATE_API_KEY", raising=False)
    assert main(["--data", str(tmp_path), "sync"]) == EXIT_AUTH
    assert "NYSENATE_API_KEY" in capsys.readouterr().err


def make_store(tmp_path):
    store = Store(tmp_path / "data")
    write_json(store.transcript_path("1994-01-05T12:00", "Regular Session"), {
        "dateTime": "1994-01-05T12:00", "sessionType": "Regular Session",
        "text": "         1       Some words with no speakers.\n         2       More words.\n",
    })
    return store


def test_process_writes_site_data_and_quality(tmp_path):
    store = make_store(tmp_path)
    out = tmp_path / "site"
    assert main(["--data", str(store.root), "process", "--out", str(out)]) == 0
    assert (out / "transcripts" / "1994-01-05-regular-session.json").exists()
    assert read_json(out / "quality.json")["attribution"] == 0.0


def test_process_fails_the_gate_when_quality_drops(tmp_path, capsys):
    store = make_store(tmp_path)
    previous = tmp_path / "previous.json"
    write_json(previous, {"attribution": 0.99, "billLinkRate": 1.0})
    code = main(["--data", str(store.root), "process", "--out", str(tmp_path / "site"), "--gate-against", str(previous)])
    assert code == EXIT_GATE
    assert "Text matched to speakers dropped" in capsys.readouterr().err


def test_rate_sets_the_pause_between_requests(monkeypatch):
    monkeypatch.setenv("NYSENATE_API_KEY", "k")
    assert api_client(None).min_interval == 1.0
    assert api_client(5).min_interval == 0.2
    assert api_client(None, parallel=8).min_interval == 0.0  # parallel workers don't pause


def test_parallel_is_capped(tmp_path, capsys):
    with pytest.raises(SystemExit) as exit_info:
        main(["--data", str(tmp_path), "sync", "--parallel", "64"])
    assert exit_info.value.code == 2
    assert "at most 16" in capsys.readouterr().err


def test_rates_above_the_cap_are_refused(tmp_path, capsys):
    with pytest.raises(SystemExit) as exit_info:
        main(["--data", str(tmp_path), "sync", "--rate", "50"])
    assert exit_info.value.code == 2
    assert "at most 10" in capsys.readouterr().err


class SmokeClient:
    def __init__(self, bodies):
        self.bodies = bodies

    def get(self, path, **params):
        return self.bodies[path]


def test_smoke_checks_every_response_shape_the_pipeline_reads():
    from datetime import datetime

    from nyleg.__main__ import smoke

    item = lambda **keys: {"success": True, "total": 1, "offsetStart": 1, "result": {"items": [keys]}}  # noqa: E731
    client = SmokeClient({
        "/transcripts": item(dateTime=1, sessionType=1, dayType=1, text=1),
        "/hearings": item(id=1, filename=1),
        "/members/2025/senate": item(memberId=1, person=1, sessionShortNameMap=1),
        "/members/2025/assembly": item(memberId=900, person=1, chamber="ASSEMBLY"),
        "/bills/2025": item(printNo="S100", basePrintNo="S100"),
        "/transcripts/updates/2025-06-03T12:00:00/2025-06-10T12:00:00": item(transcriptId={"dateTime": 1, "sessionType": 1}),
        "/bills/2025/S100": {"success": True, "result": {"printNo": "S100", "votes": {"items": []}, "sponsor": {}}},
    })
    lines = smoke(client, datetime(2025, 6, 10, 12, 0, 0))
    assert any(l.startswith("updates:") and "transcriptId=['dateTime', 'sessionType']" in l for l in lines)
    assert any(l.startswith("bill detail:") and "'votes'" in l for l in lines)
    assert any(l.startswith("assembly:") and "'chamber'" in l for l in lines)


def test_process_reports_a_refused_output_folder(tmp_path, capsys):
    store = make_store(tmp_path)
    assert main(["--data", str(store.root), "process", "--out", str(store.root)]) == EXIT_GATE
    assert "Refusing to replace" in capsys.readouterr().err


def test_process_refuses_to_build_from_a_missing_data_folder(tmp_path, capsys):
    out = tmp_path / "site"
    assert main(["--data", str(tmp_path / "nope"), "process", "--out", str(out)]) == EXIT_GATE
    assert "No raw transcripts" in capsys.readouterr().err
    assert not out.exists()
