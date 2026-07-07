#!/usr/bin/env bash
# Bootstrap installer for the curated ~/.claude config.
# Fetches the package tarball (no git needed) and runs setup.mjs.
#   curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash
#   curl -fsSL .../bootstrap.sh | bash -s -- --ref v1.0.0        # pin to a release tag
#   curl -fsSL .../bootstrap.sh | bash -s -- --replace-all       # forward flags to setup.mjs
set -euo pipefail

REPO="axazolai-create/claude-config"
REF="${REF:-master}"
SETUP_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)   REF="${2:?--ref needs a value}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    *)       SETUP_ARGS+=("$1"); shift ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "bootstrap: required tool '$1' not found." >&2
  if [ -n "${2:-}" ]; then echo "  $2" >&2; fi
  exit 1
}
need node "Install Node.js (>=18): https://nodejs.org"
need tar
need curl

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="https://github.com/${REPO}/archive/${REF}.tar.gz"
echo "bootstrap: downloading ${REPO}@${REF} ..."
curl -fsSL "$url" | tar -xzf - -C "$tmp" --strip-components=1

if [ ! -f "$tmp/setup.mjs" ]; then
  echo "bootstrap: setup.mjs not found in archive (bad --ref '${REF}'?)." >&2
  exit 1
fi

echo "bootstrap: running setup.mjs ..."
node "$tmp/setup.mjs" ${SETUP_ARGS+"${SETUP_ARGS[@]}"}

echo "bootstrap: done. Restart Claude Code to load hooks & settings."
