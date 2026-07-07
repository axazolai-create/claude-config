#!/usr/bin/env bash
# Bootstrap installer for the curated ~/.claude config.
# Fetches the package tarball (no git needed) and runs setup.mjs.
#   curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash
#   curl -fsSL .../bootstrap.sh | bash -s -- --ref v1.0.0        # pin to a release tag
#   curl -fsSL .../bootstrap.sh | bash -s -- --replace-all       # forward flags to setup.mjs
#   env vars (parity with Windows): CLAUDE_CONFIG_REF=<ref>  CLAUDE_SETUP_ARGS="<flags>"
set -euo pipefail

REPO="axazolai-create/claude-config"
REF="${CLAUDE_CONFIG_REF:-${REF:-master}}"
SETUP_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)   REF="${2:?--ref needs a value}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    *)       SETUP_ARGS+=("$1"); shift ;;
  esac
done

# If no flags were passed positionally, fall back to CLAUDE_SETUP_ARGS (parity with bootstrap.ps1).
if [ "${#SETUP_ARGS[@]}" -eq 0 ] && [ -n "${CLAUDE_SETUP_ARGS:-}" ]; then
  read -ra SETUP_ARGS <<< "$CLAUDE_SETUP_ARGS"
fi

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
# shellcheck disable=SC2086  # intentional: unquoted so an empty SETUP_ARGS contributes zero argv words (correct empty-array handling under set -u on bash 3.2)
node "$tmp/setup.mjs" ${SETUP_ARGS+"${SETUP_ARGS[@]}"}

echo "bootstrap: done. Restart Claude Code to load hooks & settings."
