#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Build RedBus Audio Bridge driver (virtual audio loopback, based on BlackHole)
# Compiles with clang directly — no Xcode project needed.
#
# Usage:  ./build.sh
#         npm run build:audio-driver   (from project root)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

# ── Configuration ──
DRIVER_NAME="RedBusAudio"
BUNDLE_ID="com.redbus.audiobridge"
CHANNELS=2
EXECUTABLE="RedBusAudioBridge"
DRIVER_BUNDLE="${DRIVER_NAME}${CHANNELS}ch.driver"
BUILD_DIR="build"
SRC="src/RedBusAudioBridge.c"
PLIST_TEMPLATE="src/Info.plist"

echo "🔨 Building ${DRIVER_BUNDLE}..."

# ── Clean ──
rm -rf "${BUILD_DIR}/${DRIVER_BUNDLE}"

# ── Create bundle structure ──
CONTENTS="${BUILD_DIR}/${DRIVER_BUNDLE}/Contents"
MACOS="${CONTENTS}/MacOS"
mkdir -p "${MACOS}"

# ── Compile for both architectures (universal binary) ──
DEFINES=(
  -DkNumber_Of_Channels=${CHANNELS}
  -DkPlugIn_BundleID="\"${BUNDLE_ID}\""
  -DkDriver_Name="\"${DRIVER_NAME}\""
  -DkManufacturer_Name="\"RedBus\""
  -DkCanBeDefaultDevice=false
  -DkCanBeDefaultSystemDevice=false
)

FRAMEWORKS="-framework CoreAudio -framework CoreFoundation -framework Accelerate"
CFLAGS="-O2 -Wall -bundle -mmacosx-version-min=10.13"

echo "   Compiling arm64..."
clang -arch arm64 ${CFLAGS} "${DEFINES[@]}" ${FRAMEWORKS} \
  -o "${MACOS}/${EXECUTABLE}.arm64" "${SRC}"

echo "   Compiling x86_64..."
clang -arch x86_64 ${CFLAGS} "${DEFINES[@]}" ${FRAMEWORKS} \
  -o "${MACOS}/${EXECUTABLE}.x86_64" "${SRC}"

echo "   Creating universal binary..."
lipo -create \
  "${MACOS}/${EXECUTABLE}.arm64" \
  "${MACOS}/${EXECUTABLE}.x86_64" \
  -output "${MACOS}/${EXECUTABLE}"

rm "${MACOS}/${EXECUTABLE}.arm64" "${MACOS}/${EXECUTABLE}.x86_64"

# ── Generate Info.plist with unique factory UUID ──
UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
sed "s/__FACTORY_UUID__/${UUID}/g" "${PLIST_TEMPLATE}" > "${CONTENTS}/Info.plist"

# ── Build Swift CLI helper ──
echo "   Compiling redbus-audio-helper..."
swiftc -O -suppress-warnings \
  -o "${BUILD_DIR}/redbus-audio-helper" \
  helper/RedBusAudioHelper.swift

echo ""
echo "✅ ${BUILD_DIR}/${DRIVER_BUNDLE}"
echo "✅ ${BUILD_DIR}/redbus-audio-helper"
echo "   Bundle ID:  ${BUNDLE_ID}"
echo "   Channels:   ${CHANNELS}"
echo "   UUID:       ${UUID}"
echo ""
echo "   Install:    sudo ./scripts/install.sh"
echo "   Uninstall:  sudo ./scripts/uninstall.sh"

