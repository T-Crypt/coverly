#!/usr/bin/env bash
# Publish this checkout to a Docker guest on a remote Proxmox host:
# tar the source, push through the host with pct, build and restart there.
# Connection details come from .deploy.env in the repo root (gitignored)
# or the environment. See .deploy.env.example for the shape.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
[ -f "$REPO/.deploy.env" ] && . "$REPO/.deploy.env"
: "${PVE:?set PVE=user@pve-host in .deploy.env or the environment}"
: "${CT:?set CT=<proxmox guest id> in .deploy.env or the environment}"
: "${DEST:?set DEST=/path/inside/guest in .deploy.env or the environment}"
TARBALL=$(mktemp /tmp/coverly-src.XXXXXX.tgz)
trap 'rm -f "$TARBALL"' EXIT

tar czf "$TARBALL" \
  --exclude=node_modules --exclude=dist --exclude=dev-dist \
  --exclude=test/samples --exclude=test/out \
  -C "$(dirname "$REPO")" "$(basename "$REPO")"

scp -q "$TARBALL" "$PVE:/var/tmp/coverly-src.tgz"
ssh "$PVE" "pct push $CT /var/tmp/coverly-src.tgz /tmp/coverly-src.tgz && \
  rm /var/tmp/coverly-src.tgz && \
  pct exec $CT -- sh -c 'mkdir -p $DEST && \
    tar xzf /tmp/coverly-src.tgz -C $DEST --strip-components=1 && \
    rm /tmp/coverly-src.tgz && cd $DEST && \
    docker compose build && docker compose up -d'"

echo "deployed: ssh $PVE -> CT $CT -> $DEST (docker compose ps to check)"
