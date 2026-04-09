#!/usr/bin/env bash
# =============================================================================
# RedBus — Publish Script
# Syncs source to redbus-public, builds all platforms, creates GitHub release
# Usage: ./publish.sh [--version 1.2.0] [--message "What changed"]
# =============================================================================

set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────
PRIVATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_DIR="$(dirname "$PRIVATE_DIR")/redbus-public"
GH_BIN="/opt/homebrew/bin/gh"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()     { echo -e "${CYAN}[publish]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Args ─────────────────────────────────────────────────────────────────────
VERSION=""
MESSAGE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --version|-v) VERSION="$2"; shift 2 ;;
    --message|-m) MESSAGE="$2"; shift 2 ;;
    *) error "Unknown argument: $1" ;;
  esac
done

# If no version given, read from package.json
if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
  [[ -z "$VERSION" ]] && error "Could not read version from package.json"
else
  # Update package.json version if provided via arg
  log "Updating package.json to v$VERSION"
  npm version "$VERSION" --no-git-tag-version
fi

# If no message given, generate one
if [[ -z "$MESSAGE" ]]; then
  MESSAGE="Release v$VERSION — $(date '+%Y-%m-%d')"
fi

TAG="v$VERSION"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       RedBus — Dev Publish               ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""
log "Private: $PRIVATE_DIR"
log "Public:  $PUBLIC_DIR"
log "Version: $VERSION  |  Tag: $TAG"
log "Message: $MESSAGE"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────
[[ ! -d "$PUBLIC_DIR" ]] && error "Public repo not found at $PUBLIC_DIR — run initial setup first."
[[ ! -x "$GH_BIN" ]]    && error "gh not found at $GH_BIN. Install with: brew install gh"

$GH_BIN auth status &>/dev/null || error "Not authenticated with gh. Run: gh auth login"

# ── Step 1: Build all platforms ───────────────────────────────────────────────
echo -e "${CYAN}━━━ Step 1/4: Building for all platforms ━━━${NC}"
cd "$PRIVATE_DIR"

log "Running: npm run build (mac + win + linux)"
npm run build:mac  && success "macOS build done"
npm run build:win  && success "Windows build done"
npm run build:linux && success "Linux build done"

# ── Step 2: Sync source to public repo ───────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ Step 2/4: Syncing source to public repo ━━━${NC}"

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

success "Source synced to public repo"

# ── Step 3: Commit & push source ─────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ Step 3/4: Committing to public repo ━━━${NC}"

cd "$PUBLIC_DIR"

# Check if there's anything to commit
if git diff --quiet && git diff --staged --quiet && [[ -z "$(git status --short)" ]]; then
  warn "No source changes detected — skipping commit"
else
  git add -A
  git commit -m "$MESSAGE"
  git push origin main
  success "Pushed to github.com/guilecc/redbus-public"
fi

# ── Step 4: Create GitHub Release with binaries ──────────────────────────────
echo ""
echo -e "${CYAN}━━━ Step 4/4: Creating GitHub Release $TAG ━━━${NC}"

RELEASE_DIR="$PRIVATE_DIR/release"

# Collect release assets (skip unpacked dirs, blockmap, yml debug files)
ASSETS=()
while IFS= read -r -d '' file; do
  ASSETS+=("$file")
done < <(find "$RELEASE_DIR" -maxdepth 1 -type f \
  \( -name "*.exe" -o -name "*.dmg" -o -name "*.zip" -o -name "*.AppImage" -o -name "*.deb" \) \
  -not -name "*.blockmap" \
  -print0)

if [[ ${#ASSETS[@]} -eq 0 ]]; then
  warn "No binary assets found in $RELEASE_DIR — skipping release creation"
else
  log "Assets to upload:"
  for asset in "${ASSETS[@]}"; do
    echo "    • $(basename "$asset")"
  done

  # Delete existing tag/release if it exists (so we can re-release same version)
  if $GH_BIN release view "$TAG" --repo guilecc/redbus-public &>/dev/null; then
    warn "Release $TAG already exists — deleting and recreating"
    $GH_BIN release delete "$TAG" --repo guilecc/redbus-public --yes
    git tag -d "$TAG" 2>/dev/null || true
    git push origin ":refs/tags/$TAG" 2>/dev/null || true
  fi

  # Build asset flags
  ASSET_FLAGS=()
  for asset in "${ASSETS[@]}"; do
    ASSET_FLAGS+=("$asset")
  done

  $GH_BIN release create "$TAG" \
    --repo guilecc/redbus-public \
    --title "RedBus $TAG" \
    --notes "$MESSAGE" \
    "${ASSET_FLAGS[@]}"

  success "GitHub Release $TAG created with ${#ASSETS[@]} assets"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🚀 Published successfully!             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Repo:    https://github.com/guilecc/redbus-public"
echo "  Release: https://github.com/guilecc/redbus-public/releases/tag/$TAG"
echo ""
