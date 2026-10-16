#!/usr/bin/env bash
# Publish the bills site: one orphan commit force-pushed to the bills repository's gh-pages branch, so its history
# never grows. Needs BILLS_DEPLOY_KEY, an SSH deploy key with write access to the bills repository.
# Usage: publish-bills.sh out/bills
set -euo pipefail
dir="$1"
# Never replace the live bills site with a partial one: it needs its index page and its own assets.
if [ ! -f "$dir/index.html" ] || [ ! -d "$dir/_astro" ]; then
  echo "Not publishing $dir: it has no index.html or _astro folder" >&2
  exit 1
fi
repo="${BILLS_REPO:-git@github.com:senaterecords/bills.git}"
key="$(mktemp)"
trap 'rm -f "$key"' EXIT
printf '%s\n' "$BILLS_DEPLOY_KEY" > "$key"
chmod 600 "$key"
cd "$dir"
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "Publish the bills site"
GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git push -q -f "$repo" gh-pages
