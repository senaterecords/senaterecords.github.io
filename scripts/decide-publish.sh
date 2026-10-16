#!/usr/bin/env bash
# Decide whether this run publishes: when the raw data or the code that builds the site differs from what was last
# deployed (so a publish that failed, or was cancelled by a newer run, happens on the next one), or when asked to
# rebuild. Prints raw=, code= and publish= lines, for $GITHUB_OUTPUT. Usage: decide-publish.sh [rebuild: true|false]
set -euo pipefail
rebuild="${1:-false}"
raw="$(git rev-parse HEAD:data/raw)"
# What builds the site (its tests and docs don't): one fingerprint of those folders and files as committed.
code="$(for path in pipeline site/src site/public site/scripts site/package.json site/package-lock.json site/astro.config.mjs \
  scripts data/overrides data/rosters; do git rev-parse "HEAD:$path" 2>/dev/null || echo "-"; done | sha1sum | cut -d' ' -f1)"
publish=false
if [ "$rebuild" = "true" ] || [ "$raw" != "$(cat data/deployed-raw.txt 2>/dev/null)" ] \
  || [ "$code" != "$(cat data/deployed-code.txt 2>/dev/null)" ]; then
  publish=true
fi
printf 'raw=%s\ncode=%s\npublish=%s\n' "$raw" "$code" "$publish"
