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


def test_rates_above_the_cap_are_refused(tmp_path, capsys):
    with pytest.raises(SystemExit) as exit_info:
        main(["--data", str(tmp_path), "sync", "--rate", "50"])
    assert exit_info.value.code == 2
    assert "at most 10" in capsys.readouterr().err


def test_process_refuses_to_build_from_a_missing_data_folder(tmp_path, capsys):
    out = tmp_path / "site"
    assert main(["--data", str(tmp_path / "nope"), "process", "--out", str(out)]) == EXIT_GATE
    assert "No raw transcripts" in capsys.readouterr().err
    assert not out.exists()
