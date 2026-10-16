#!/usr/bin/env bash
# Record when the Senate's records were last checked, for the site's "Checked 12 min ago": one small file on the
# status branch, replaced on every run as a single commit, so that branch never grows and main's history stays clean.
# The site reads it from raw.githubusercontent.com. On GitHub it needs GITHUB_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail
updated="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("updated_at", ""))' data/state.json 2>/dev/null || true)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '{"checkedAt":"%s","updatedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$updated" > "$work/checked.json"
cd "$work"
git init -q -b status
git add checked.json
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "Checked the Senate's records"
target="${STATUS_REMOTE:-https://github.com/${GITHUB_REPOSITORY:-}.git}"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  auth="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
  git -c http.https://github.com/.extraheader="AUTHORIZATION: basic $auth" push -q -f "$target" status
else
  git push -q -f "$target" status
fi
