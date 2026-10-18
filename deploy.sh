#!/bin/bash

set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# Run only after reviewing/pulling the intended revision. Never reset or switch branches.
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Commit or stash reviewed repository changes before deploying.' >&2
  exit 1
fi
docker compose config --quiet
# Recreate even when only bind-mounted source or ignored environment values changed.
docker compose up -d --force-recreate triplink-api
# Batch deployment remains an explicit choice: docker compose up -d --force-recreate triplink-batch
