#!/bin/sh
# Start an always-on Kore host: clone the vault on first run, build the
# index, then serve MCP over HTTP while syncing with the remote.
#
#   KORE_VAULT_REPO   https clone URL of the vault (first run only)
#   KORE_GIT_TOKEN    token that can push to it (GitHub: fine-grained PAT,
#                     Contents read and write, this one repository)
#   KORE_MCP_TOKEN    the secret agents use (openssl rand -hex 32)
#   KORE_PUBLIC_URL   the HTTPS origin agents reach (the tunnel's URL)
#   KORE_VAULT, KORE_LISTEN, KORE_SYNC_EVERY   see the Dockerfile defaults
set -eu

vault="${KORE_VAULT:-/vault}"

if [ -n "${KORE_GIT_TOKEN:-}" ]; then
  # Hand the token to git through a helper, never through the remote URL.
  git config --global credential.helper \
    '!f() { echo username=x-access-token; echo "password=${KORE_GIT_TOKEN}"; }; f'
fi
git config --global --add safe.directory "$vault"

if [ ! -d "$vault/.git" ]; then
  : "${KORE_VAULT_REPO:?set KORE_VAULT_REPO to the vault's clone URL}"
  git clone --quiet "$KORE_VAULT_REPO" "$vault"
fi

kore --graph "$vault" index

set -- mcp --http "${KORE_LISTEN:-0.0.0.0:8765}" --sync --sync-every "${KORE_SYNC_EVERY:-60}"
if [ -n "${KORE_PUBLIC_URL:-}" ]; then
  set -- "$@" --public-url "$KORE_PUBLIC_URL"
fi
exec kore --graph "$vault" "$@"
