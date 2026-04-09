#!/usr/bin/env bash
# =============================================================================
# RedBus — Sync Script
# Rapidly syncs source to redbus-public without building binaries
# Usage: ./sync.sh "Commit message"
# =============================================================================

set -euo pipefail

PRIVATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_DIR="$(dirname "$PRIVATE_DIR")/redbus-public"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${CYAN}[sync]${NC} $1"; }

MESSAGE="${1:-"Update source — $(date '+%Y-%m-%d %H:%M')"}"

[[ ! -d "$PUBLIC_DIR" ]] && { echo -e "${RED}Public repo not found at $PUBLIC_DIR${NC}"; exit 1; }

log "Syncing files..."
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='dist-electron' \
  --exclude='dist-ssr' \
  --exclude='release' \
  --exclude='release-builds' \
  --exclude='build' \
  --exclude='out' \
  --exclude='.vite' \
  --exclude='coverage' \
  --exclude='.redbus' \
  --exclude='*.sqlite' \
  --exclude='*.db' \
  --exclude='*.db-journal' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='bh' \
  --exclude='oc' \
  --exclude='tmp_retry.js' \
  --exclude='eng.traineddata' \
  --exclude='por.traineddata' \
  --delete \
  "$PRIVATE_DIR/" \
  "$PUBLIC_DIR/"

cd "$PUBLIC_DIR"

if git diff --quiet && git diff --staged --quiet && [[ -z "$(git status --short)" ]]; then
  log "${YELLOW}No changes to sync.${NC}"
else
  git add -A
  git commit -m "$MESSAGE"
  log "Pushing to GitHub..."
  git push origin main
  echo -e "${GREEN}✓ Source synced to public repo!${NC}"
fi
