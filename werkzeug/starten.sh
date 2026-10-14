#!/usr/bin/env bash
# Nolli Site starten. Baut beim ersten Mal, danach nur noch los.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
exec npm run dev -- --open --port "${PORT:-5177}"
