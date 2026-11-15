#!/usr/bin/env bash
# Run Ludex fully from this folder (USB stick / external SSD).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LUDEX_PORTABLE_DIR="$ROOT"
export LUDEX_PORTABLE=1
mkdir -p "$ROOT/LudexData" "$ROOT/Games"

APP="$ROOT/Ludex.AppImage"
if [ ! -x "$APP" ]; then
  echo "Ludex.AppImage not found next to this script." >&2
  exit 1
fi

# Prefer FUSE; fall back to a persistent extracted copy on systems without it.
if [ -e /dev/fuse ] && ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  exec "$APP" --no-sandbox "$@"
fi

EXTRACT="$ROOT/.ludex-appimage"
if [ ! -x "$EXTRACT/AppRun" ]; then
  mkdir -p "$EXTRACT"
  (cd "$EXTRACT" && "$APP" --appimage-extract >/dev/null)
  mv "$EXTRACT/squashfs-root"/* "$EXTRACT"/ 2>/dev/null || true
  rm -rf "$EXTRACT/squashfs-root"
fi
exec "$EXTRACT/AppRun" --no-sandbox "$@"
