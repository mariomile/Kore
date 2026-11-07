#!/usr/bin/env bash
# Kore, always on, on a fresh Ubuntu VM (tested target: Oracle Cloud Always
# Free, Ampere A1, Ubuntu 24.04). One run installs Docker, builds the
# kore-host image, opens an HTTPS tunnel and starts the server. Run it again
# to update Kore; the vault clone and the keys survive.
#
# Set before running (a GitHub fine-grained token, this one repository):
#   KORE_GIT_TOKEN   Contents: read and write on the vault repository
# Optional:
#   KORE_IMAGE       the prebuilt image (default ghcr.io/mariomile/kore-host:latest);
#                    when it cannot be pulled the script builds from source
#   KORE_SRC_TOKEN   Contents: read on the Kore repository, only for that build
#   CF_TUNNEL_TOKEN  a Cloudflare named tunnel token; without it the script
#                    uses Tailscale Funnel and prints a login link
#   KORE_PUBLIC_URL  the tunnel's https URL (required with CF_TUNNEL_TOKEN)
#   KORE_REPO, KORE_REF, VAULT_REPO
#
# Nothing secret is printed. The MCP token lives in ~/kore-host/secrets.env.
set -euo pipefail

KORE_REPO="${KORE_REPO:-github.com/mariomile/Kore}"
KORE_REF="${KORE_REF:-master}"
VAULT_REPO="${VAULT_REPO:-https://github.com/mariomile/obsidian-sync-marioverse.git}"
BASE="$HOME/kore-host"
KORE_IMAGE="${KORE_IMAGE:-ghcr.io/mariomile/kore-host:latest}"
: "${KORE_GIT_TOKEN:?export KORE_GIT_TOKEN (read and write on the vault repo)}"

mkdir -p "$BASE" && cd "$BASE"
say() { printf '\n== %s\n' "$*"; }

say "1/5 pacchetti"
if ! command -v docker >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker.io git curl openssl jq >/dev/null
  sudo systemctl enable --now docker
fi
DOCKER="docker"; docker ps >/dev/null 2>&1 || DOCKER="sudo docker"

say "2/5 immagine di Kore"
if $DOCKER pull -q "$KORE_IMAGE" >/dev/null 2>&1; then
  $DOCKER tag "$KORE_IMAGE" kore-host
  echo "Immagine pronta scaricata: $KORE_IMAGE"
else
  : "${KORE_SRC_TOKEN:?immagine non scaricabile: export KORE_SRC_TOKEN (lettura sul repo Kore) per costruirla}"
  src_url="https://x-access-token:${KORE_SRC_TOKEN}@${KORE_REPO}.git"
  if [ -d src/.git ]; then
    git -C src fetch -q --depth 1 "$src_url" "$KORE_REF" && git -C src checkout -q --force FETCH_HEAD
  else
    git clone -q --depth 1 --branch "$KORE_REF" "$src_url" src
    git -C src remote set-url origin "https://${KORE_REPO}.git"   # token not kept
  fi
  say "3/5 build dell'immagine (la prima volta 15-25 minuti su ARM)"
  $DOCKER build -q -f src/deploy/always-on/Dockerfile -t kore-host src >/dev/null
fi

[ -f secrets.env ] || { umask 077; echo "KORE_MCP_TOKEN=$(openssl rand -hex 32)" > secrets.env; }
set -a; . ./secrets.env; set +a
mkdir -p keys && sudo chown 1000:1000 keys

say "4/5 tunnel HTTPS"
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  : "${KORE_PUBLIC_URL:?with CF_TUNNEL_TOKEN also export KORE_PUBLIC_URL=https://...}"
  $DOCKER rm -f kore-tunnel >/dev/null 2>&1 || true
  $DOCKER run -d --name kore-tunnel --restart unless-stopped --network host \
    cloudflare/cloudflared:latest tunnel --no-autoupdate run --token "$CF_TUNNEL_TOKEN" >/dev/null
  echo "Nel pannello Cloudflare il tunnel deve puntare a http://localhost:8765"
else
  command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
  if ! sudo tailscale status >/dev/null 2>&1; then
    echo "Apri il link qui sotto e accedi a Tailscale (gratis), poi torna qui:"
    sudo tailscale up --hostname kore
  fi
  echo "Se compare un link per abilitare Funnel, aprilo e approva."
  sudo tailscale funnel --bg 8765
  KORE_PUBLIC_URL="https://$(sudo tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
fi
grep -q '^KORE_PUBLIC_URL=' secrets.env || echo "KORE_PUBLIC_URL=$KORE_PUBLIC_URL" >> secrets.env

say "5/5 avvio di Kore"
$DOCKER rm -f kore >/dev/null 2>&1 || true
$DOCKER run -d --name kore --restart unless-stopped \
  -v kore-vault:/vault -v "$BASE/keys:/keys" \
  -p 127.0.0.1:8765:8765 \
  -e KORE_VAULT_REPO="$VAULT_REPO" -e KORE_GIT_TOKEN \
  -e KORE_MCP_TOKEN -e KORE_PUBLIC_URL="$KORE_PUBLIC_URL" \
  -e KORE_MCP_KEYS_FILE=/keys/mcp-agents.json \
  kore-host >/dev/null

echo "Clono il vault e costruisco l'indice..."
for _ in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:8765/mcp \
    -H "Authorization: Bearer $KORE_MCP_TOKEN" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"graph_info","arguments":{}}}' || true)
  [ "$code" = 200 ] && break; sleep 5
done
if [ "${code:-}" != 200 ]; then
  echo "Il server non risponde ancora. Ultime righe del log:"; $DOCKER logs --tail 30 kore; exit 1
fi

echo
echo "Kore è acceso: $KORE_PUBLIC_URL/mcp"
echo "Prova pubblica: $(curl -s -o /dev/null -w '%{http_code}' "$KORE_PUBLIC_URL/setup.md") (200 = raggiungibile)"
echo "Chiave per un agente:  $DOCKER exec kore kore keys add \"Claude\" --write"
echo "Il token principale è in $BASE/secrets.env (non lo stampo)."
