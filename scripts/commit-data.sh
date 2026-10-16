#!/usr/bin/env bash
# Commit changed data (raw API responses, sync state, what was last deployed) back to main. Rebases and retries when
# main moved during the run. Usage: commit-data.sh "message"
set -euo pipefail
# The rebase below replays this commit, so the identity is set for the repository, not just for the commit.
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A data
if git diff --cached --quiet; then echo "No data changes"; exit 0; fi
git commit -q -m "$1"
for attempt in 1 2 3; do
  git push -q origin HEAD:main && exit 0
  echo "main moved; rebasing (attempt $attempt)"
  git pull -q --rebase origin main
done
echo "Could not push data after 3 attempts" >&2
exit 1
