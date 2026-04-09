#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Install RedBus Audio Bridge driver
# Called by: electron-builder postinstall, or manually with sudo
# ─────────────────────────────────────────────────────────────────────────────

DRIVER_NAME="RedBusAudio2ch.driver"
INSTALL_DIR="/Library/Audio/Plug-Ins/HAL"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRIVER_PATH="${SCRIPT_DIR}/../build/${DRIVER_NAME}"

# If called from electron-builder, the driver is in the app resources
if [ ! -d "${DRIVER_PATH}" ]; then
    DRIVER_PATH="${SCRIPT_DIR}/${DRIVER_NAME}"
fi

if [ ! -d "${DRIVER_PATH}" ]; then
    echo "❌ Driver not found at ${DRIVER_PATH}"
    exit 1
fi

echo "📦 Installing ${DRIVER_NAME}..."

# Create HAL directory if needed
mkdir -p "${INSTALL_DIR}"

# Remove old version if exists
if [ -d "${INSTALL_DIR}/${DRIVER_NAME}" ]; then
    echo "   Removing previous version..."
    rm -rf "${INSTALL_DIR}/${DRIVER_NAME}"
fi

# Copy driver
cp -R "${DRIVER_PATH}" "${INSTALL_DIR}/"
chown -R root:wheel "${INSTALL_DIR}/${DRIVER_NAME}"

# Restart CoreAudio daemon to register the new device
killall coreaudiod 2>/dev/null || true

echo "✅ ${DRIVER_NAME} installed to ${INSTALL_DIR}"

