#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Uninstall RedBus Audio Bridge driver
# Called by: electron-builder preremove, or manually with sudo
# ─────────────────────────────────────────────────────────────────────────────

DRIVER_NAME="RedBusAudio2ch.driver"
INSTALL_DIR="/Library/Audio/Plug-Ins/HAL"

if [ -d "${INSTALL_DIR}/${DRIVER_NAME}" ]; then
    echo "🗑️  Removing ${DRIVER_NAME}..."
    rm -rf "${INSTALL_DIR}/${DRIVER_NAME}"
    killall coreaudiod 2>/dev/null || true
    echo "✅ ${DRIVER_NAME} uninstalled"
else
    echo "ℹ️  ${DRIVER_NAME} not found — nothing to remove"
fi

