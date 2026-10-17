"""Command line: python -m nyleg [--data DIR] {sync,process,smoke}."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
from typing import Any
from pathlib import Path
from zoneinfo import ZoneInfo

from . import sync
from .api import ApiError, AuthError, Client
from .bills import load_bill_fixes
from .quality import gate
from .senators import session_year
from .sitedata import build_all
from .store import Store, read_json, write_json

NEW_YORK = ZoneInfo("America/New_York")
EXIT_AUTH = 3
EXIT_API = 4
EXIT_GATE = 5
MAX_RATE = 10.0  # requests per second; a free public service, so never flood it


def rate(value: str) -> float:
    number = float(value)
    if not 0 < number <= MAX_RATE:
        raise argparse.ArgumentTypeError(f"must be more than 0 and at most {MAX_RATE:g} requests per second")
    return number


MAX_PARALLEL = 16  # bounded bursts of 16 parallel requests ran clean (2026-10-16); never more


def parallel(value: str) -> int:
    number = int(value)
    if not 1 <= number <= MAX_PARALLEL:
        raise argparse.ArgumentTypeError(f"must be between 1 and at most {MAX_PARALLEL}")
    return number


def api_client(requests_per_second: float | None, parallel: int = 1) -> Client:
    """One request per second by default; a faster rate or parallel workers are for the one-time backfill."""
    if parallel > 1:
        interval = 0.0  # each worker waits for its own answer; no extra pause
    else:
        interval = 1.0 / requests_per_second if requests_per_second else 1.0
    return Client(os.environ.get("NYSENATE_API_KEY", ""), min_interval=interval)


def years(spec: str) -> list[int]:
    start, _, end = spec.partition("-")
    return list(range(int(start), int(end or start) + 1))


def emit(name: str, value: str) -> None:
    """Print a result and, inside GitHub Actions, expose it as a step output."""
    print(f"{name}={value}")
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


def new_york_now() -> datetime:
    return datetime.now(NEW_YORK).replace(tzinfo=None)


def bookkeeping(state: dict) -> dict:
    """The sync state worth keeping between runs: everything but the time of the last run."""
    return {key: value for key, value in state.items() if key != "transcripts_synced_at"}


def cmd_sync(args: argparse.Namespace) -> int:
    store = Store(Path(args.data))
    client = api_client(args.rate, args.parallel)
    now = new_york_now()
    before = bookkeeping(store.load_state())
    result = sync.SyncResult()
    if args.backfill:
        span = years(args.backfill)
        result.merge(sync.backfill_transcripts(client, store, span))
        result.merge(sync.backfill_hearings(client, store, span))
        for session in sorted({session_year(date(y, 1, 1)) for y in span}):
            result.merge(sync.sync_members(client, store, session))
    result.merge(sync.sync_transcript_updates(client, store, now))
    # Hearings are re-listed once a day: the morning window holds several runs, and the list doesn't change between
    # them. The day is kept only once the listing is done, so a run the API fails retries it.
    today = now.date().isoformat()
    if args.hearings and store.load_state().get("hearings_listed_on") != today:
        result.merge(sync.sync_recent_hearings(client, store, now.date()))
        state = store.load_state()
        state["hearings_listed_on"] = today
        store.save_state(state)
    current = session_year(now.date())
    result.merge(sync.sync_members(client, store, current))
    result.merge(sync.sync_photos(store))
    scan = sync.bill_scan_paths(store, result.changed, args.rescan_bills)
    fixes = load_bill_fixes(store.root / "overrides" / "bills.yaml")
    result.merge(sync.fetch_bills(client, store, sync.wanted_bills(scan, fixes), budget=args.bill_budget,
                                  today=now.date(), refresh_session=current, workers=args.parallel))
    print(f"{len(result.changed)} raw files added or updated")
    if result.changed:
        # When new records last arrived: what the site's "Updated" says (a rebuild for code alone doesn't move it).
        state = store.load_state()
        state["updated_at"] = now.isoformat(timespec="seconds")
        store.save_state(state)
    emit("changed", "true" if result.changed else "false")
    # Bills checked, missing or pending must be kept even when no raw file changed, or the next run repeats the work.
    emit("state_changed", "true" if bookkeeping(store.load_state()) != before else "false")
    return 0


def cmd_process(args: argparse.Namespace) -> int:
    store = Store(Path(args.data))
    out = Path(args.out)
    if not (store.raw / "transcripts").exists():
        print(f"ERROR: No raw transcripts in {store.raw}; run sync first or check --data", file=sys.stderr)
        return EXIT_GATE
    try:
        report = build_all(store, out, new_york_now())
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return EXIT_GATE
    summary = report.to_dict()
    write_json(out / "quality.json", summary)
    print(json.dumps({k: summary[k] for k in ("floorTranscripts", "hearings", "attribution", "billLinkRate")}))
    if args.gate_against:
        problems = gate(read_json(Path(args.gate_against)), report)
        for problem in problems:
            print(f"QUALITY GATE: {problem}", file=sys.stderr)
        if problems:
            return EXIT_GATE
    return 0


def smoke(client: Any, now: datetime) -> list[str]:
    """One line per API response shape the pipeline reads, so a changed field shows up immediately."""
    session = session_year(now.date())
    week_ago = (now - timedelta(days=7)).replace(microsecond=0).isoformat()
    checks = {
        "transcripts": ("/transcripts", {"limit": 1, "full": True, "sessionOnly": False}),
        "hearings": ("/hearings", {"limit": 1}),
        "members": (f"/members/{session}/senate", {"limit": 1, "full": True}),
        "assembly": (f"/members/{session}/assembly", {"limit": 1, "full": True}),
        "bills": (f"/bills/{session}", {"limit": 1}),
        "updates": (f"/transcripts/updates/{week_ago}/{now.replace(microsecond=0).isoformat()}", {"limit": 1}),
    }
    lines = []
    firsts: dict[str, dict[str, Any]] = {}
    for name, (path, params) in checks.items():
        body = client.get(path, **params)
        items = (body.get("result") or {}).get("items") or []
        firsts[name] = items[0] if items else {}
        line = f"{name}: total={body.get('total')} offsetStart={body.get('offsetStart')} keys={sorted(firsts[name])}"
        if name == "updates" and isinstance(firsts[name].get("transcriptId"), dict):
            line += f" transcriptId={sorted(firsts[name]['transcriptId'])}"
        lines.append(line)
    bill = firsts["bills"].get("basePrintNo") or firsts["bills"].get("printNo")
    if bill:
        detail = client.get(f"/bills/{session}/{bill}", view="no_fulltext").get("result") or {}
        lines.append(f"bill detail: {bill} keys={sorted(detail)}")
    return lines


def cmd_check_official(args: argparse.Namespace) -> int:
    """List official page addresses in the built site data that don't answer 200, for review by hand."""
    import httpx

    from .official import check_urls

    site = Path(args.site)
    urls = [(s["name"], s["officialUrl"]) for s in read_json(site / "senators.json") or [] if s.get("officialUrl")]
    urls += [(m["name"], m["officialUrl"]) for m in (read_json(site / "assembly.json") or {}).values() if m.get("officialUrl")]
    with httpx.Client(timeout=20.0, headers={"User-Agent": "OnTheRecord-check/0.1"}) as client:
        problems = check_urls(urls, client)
    for name, url, status in problems:
        note = "blocked by the site; check by hand" if status == 403 else "fix in data/overrides/official-urls.yaml"
        print(f"{status}\t{name}\t{url}\t{note}")
    print(f"{len(urls) - len(problems)} of {len(urls)} addresses answered 200")
    return 0


def cmd_smoke(args: argparse.Namespace) -> int:
    """Print the shape of each endpoint we depend on; used to verify assumptions with a real key."""
    for line in smoke(Client(os.environ.get("NYSENATE_API_KEY", "")), new_york_now()):
        print(line)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nyleg", description="On the Record data pipeline")
    parser.add_argument("--data", default="data", help="the repo's data/ folder")
    commands = parser.add_subparsers(dest="command", required=True)
    s = commands.add_parser("sync", help="download new and changed records")
    s.add_argument("--backfill", metavar="YEAR[-YEAR]", help="also download whole years (resumable)")
    s.add_argument("--hearings", action="store_true", help="re-list this year's public hearings")
    s.add_argument("--rescan-bills", action="store_true", help="look for bill mentions in every stored transcript and hearing")
    s.add_argument("--bill-budget", type=int, default=3000, help="max bill requests this run")
    s.add_argument("--rate", type=rate, help="requests per second (default 1; at most 10, for the one-time backfill)")
    s.add_argument("--parallel", type=parallel, default=1,
                   help="fetch bills with this many parallel workers, no pause (at most 16; for the one-time backfill)")
    p = commands.add_parser("process", help="build data/site from the raw store")
    p.add_argument("--out", default="data/site")
    p.add_argument("--gate-against", help="previous quality.json; exit 5 if quality dropped")
    commands.add_parser("smoke", help="check the live API responses we depend on")
    c = commands.add_parser("check-official", help="list official page addresses that don't answer")
    c.add_argument("--site", default="data/site")
    args = parser.parse_args(argv)
    handlers = {"sync": cmd_sync, "process": cmd_process, "smoke": cmd_smoke, "check-official": cmd_check_official}
    try:
        return handlers[args.command](args)
    except AuthError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return EXIT_AUTH
    except ApiError as exc:
        print(f"ERROR: NY Senate API unavailable: {exc}", file=sys.stderr)
        return EXIT_API


if __name__ == "__main__":
    sys.exit(main())
