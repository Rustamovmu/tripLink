#!/bin/bash
set -euo pipefail

cd /Users/a1234/Developer/trip-link
git checkout main
git pull --ff-only origin main
docker compose up -d --force-recreate