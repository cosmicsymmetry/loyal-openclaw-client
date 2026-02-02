#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required (node not found)." >&2
  exit 1
fi

SCRIPT_URL=${LOYAL_OPENCLAW_CLIENT_URL:-"https://raw.githubusercontent.com/cosmicsymmetry/loyal-openclaw-client/main/loyal-openclaw-setup.js"}

curl -fsSL "$SCRIPT_URL" | node
