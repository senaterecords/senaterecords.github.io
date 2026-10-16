"""Command line: python -m nyleg [--data DIR] {sync,process,smoke}."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import sync
from .api import ApiError, AuthError, Client
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


def api_client(requests_per_second: float | None) -> Client:
    """One request per second by default; a faster rate is meant for the one-time backfill."""
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


def cmd_sync(args: argparse.Namespace) -> int:
    store = Store(Path(args.data))
    client = api_client(args.rate)
    now = new_york_now()
    result = sync.SyncResult()
    if args.backfill:
        span = years(args.backfill)
        result.merge(sync.backfill_transcripts(client, store, span))
        result.merge(sync.backfill_hearings(client, store, span))
        for session in sorted({session_year(date(y, 1, 1)) for y in span}):
            result.merge(sync.sync_members(client, store, session))
    result.merge(sync.sync_transcript_updates(client, store, now))
    if args.hearings:
        result.merge(sync.sync_recent_hearings(client, store, now.date()))
    current = session_year(now.date())
    result.merge(sync.sync_members(client, store, current))
    if args.rescan_bills:
        scan = list(store.iter_raw("transcripts"))
    else:
        scan = [p for p in result.changed if "transcripts" in p.parts]
    result.merge(sync.fetch_bills(client, store, sync.wanted_bills(scan), budget=args.bill_budget,
                                  today=now.date(), refresh_session=current))
    print(f"{len(result.changed)} raw files added or updated")
    emit("changed", "true" if result.changed else "false")
    return 0


def cmd_process(args: argparse.Namespace) -> int:
    store = Store(Path(args.data))
    out = Path(args.out)
    if not (store.raw / "transcripts").exists():
        print(f"ERROR: No raw transcripts in {store.raw}; run sync first or check --data", file=sys.stderr)
        return EXIT_GATE
    report = build_all(store, out, new_york_now())
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


def cmd_smoke(args: argparse.Namespace) -> int:
    """Print the shape of each endpoint we depend on; used to verify assumptions with a real key."""
    client = Client(os.environ.get("NYSENATE_API_KEY", ""))
    session = session_year(new_york_now().date())
    checks = {
        "transcripts": ("/transcripts", {"limit": 1, "full": True, "sessionOnly": False}),
        "hearings": ("/hearings", {"limit": 1}),
        "members": (f"/members/{session}/senate", {"limit": 1, "full": True}),
        "bills": (f"/bills/{session}", {"limit": 1}),
    }
    for name, (path, params) in checks.items():
        body = client.get(path, **params)
        items = (body.get("result") or {}).get("items") or []
        first = items[0] if items else {}
        print(f"{name}: total={body.get('total')} offsetStart={body.get('offsetStart')} keys={sorted(first)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nyleg", description="On the Record data pipeline")
    parser.add_argument("--data", default="data", help="the repo's data/ folder")
    commands = parser.add_subparsers(dest="command", required=True)
    s = commands.add_parser("sync", help="download new and changed records")
    s.add_argument("--backfill", metavar="YEAR[-YEAR]", help="also download whole years (resumable)")
    s.add_argument("--hearings", action="store_true", help="re-list this year's public hearings")
    s.add_argument("--rescan-bills", action="store_true", help="look for bill mentions in every stored transcript")
    s.add_argument("--bill-budget", type=int, default=3000, help="max bill requests this run")
    s.add_argument("--rate", type=rate, help="requests per second (default 1; at most 10, for the one-time backfill)")
    p = commands.add_parser("process", help="build data/site from the raw store")
    p.add_argument("--out", default="data/site")
    p.add_argument("--gate-against", help="previous quality.json; exit 5 if quality dropped")
    commands.add_parser("smoke", help="check the live API responses we depend on")
    args = parser.parse_args(argv)
    handlers = {"sync": cmd_sync, "process": cmd_process, "smoke": cmd_smoke}
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
