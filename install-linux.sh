#!/usr/bin/env bash
# Ludex installer / updater for Linux.
# Usage: curl -fsSL https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/install-linux.sh | bash
set -euo pipefail

REPO="spammail10q1-cloud/ludex"
APP_NAME="Ludex"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ludex"
BIN_LINK="$HOME/.local/bin/ludex"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
DESKTOP_FILE="$DESKTOP_DIR/ludex.desktop"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing dependency: $1" >&2
    exit 1
  }
}
need curl
need python3

echo "==> Fetching latest Ludex release..."
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
ASSET_URL="$(RELEASE_JSON="$RELEASE_JSON" python3 - <<'PY'
import json, os, re
data = json.loads(os.environ["RELEASE_JSON"])
assets = data.get("assets", [])
# Prefer x86_64 AppImage, then any Linux AppImage.
def score(name):
    n = name.lower()
    if "linux" in n and "x86_64" in n and n.endswith(".appimage"):
        return 0
    if "linux" in n and n.endswith(".appimage"):
        return 1
    if n.endswith(".appimage"):
        return 2
    return 99
assets = sorted(assets, key=lambda a: score(a.get("name", "")))
for asset in assets:
    if score(asset.get("name", "")) < 99:
        print(asset["browser_download_url"])
        break
PY
)"

if [ -z "${ASSET_URL:-}" ]; then
  echo "No Linux AppImage was found in the latest Ludex release." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$(dirname "$BIN_LINK")" "$DESKTOP_DIR" "$ICON_DIR"

TMP_FILE="$(mktemp /tmp/ludex-appimage.XXXXXX)"
echo "==> Downloading $(basename "$ASSET_URL")..."
curl -fL --progress-bar "$ASSET_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"
mv -f "$TMP_FILE" "$INSTALL_DIR/Ludex.AppImage"
chmod +x "$INSTALL_DIR/Ludex.AppImage"

ln -sfn "$INSTALL_DIR/Ludex.AppImage" "$BIN_LINK"

ICON_URL="https://raw.githubusercontent.com/$REPO/main/assets/ludex.png"
if curl -fsSL "$ICON_URL" -o "$ICON_DIR/ludex.png" 2>/dev/null; then
  :
else
  # Fall back to the icon Electron embeds in the AppImage.
  "$INSTALL_DIR/Ludex.AppImage" --appimage-extract 'usr/share/icons/hicolor/512x512/apps/*.png' >/dev/null 2>&1 || true
  if [ -f squashfs-root/usr/share/icons/hicolor/512x512/apps/ludex.png ]; then
    cp squashfs-root/usr/share/icons/hicolor/512x512/apps/ludex.png "$ICON_DIR/ludex.png"
  fi
  rm -rf squashfs-root
fi

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Ludex
Comment=Game library and launcher
Exec=$INSTALL_DIR/Ludex.AppImage --no-sandbox %U
Icon=ludex
Terminal=false
Categories=Game;
StartupNotify=true
MimeType=x-scheme-handler/ascendara;
EOF
chmod +x "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" >/dev/null 2>&1 || true
fi

echo ""
echo "Ludex installed."
echo "  App:     $INSTALL_DIR/Ludex.AppImage"
echo "  Command: $BIN_LINK"
echo "  Menu:    $DESKTOP_FILE"
echo ""
echo "Run 'ludex' or open Ludex from your application menu."
