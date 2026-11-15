#!/usr/bin/env bash
# Ludex installer for Steam Deck / SteamOS.
# Works in Desktop Mode and adds a Game Mode friendly launcher.
set -euo pipefail

REPO="spammail10q1-cloud/ludex"
APP_DIR="$HOME/.local/share/ludex"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
APP_IMAGE="$APP_DIR/Ludex.AppImage"
WRAPPER="$BIN_DIR/ludex"
EXTRACT_DIR="$HOME/.cache/ludex-appimage"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }
}
need curl
need python3

echo "==> Detecting Steam Deck..."
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "    ${PRETTY_NAME:-SteamOS}"
fi

echo "==> Fetching latest Ludex release..."
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
ASSET_URL="$(RELEASE_JSON="$RELEASE_JSON" python3 - <<'PY'
import json, os
data = json.loads(os.environ["RELEASE_JSON"])
for asset in data.get("assets", []):
    name = asset.get("name", "").lower()
    if "linux" in name and name.endswith(".appimage"):
        print(asset["browser_download_url"])
        break
PY
)"
[ -n "${ASSET_URL:-}" ] || { echo "No Linux AppImage in the latest release." >&2; exit 1; }

mkdir -p "$APP_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
TMP="$(mktemp /tmp/ludex-deck.XXXXXX)"
echo "==> Downloading $(basename "$ASSET_URL")..."
curl -fL --progress-bar "$ASSET_URL" -o "$TMP"
chmod +x "$TMP"
mv -f "$TMP" "$APP_IMAGE"
chmod +x "$APP_IMAGE"

# FUSE is sometimes missing on SteamOS. Prefer the direct AppImage, fall back
# to a persistent extracted copy so Game Mode launches stay fast.
if [ ! -e /dev/fuse ] || ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  echo "==> FUSE/libfuse2 not found; preparing extracted fallback..."
  rm -rf "$EXTRACT_DIR"
  mkdir -p "$EXTRACT_DIR"
  (cd "$EXTRACT_DIR" && "$APP_IMAGE" --appimage-extract >/dev/null)
  mv "$EXTRACT_DIR/squashfs-root"/* "$EXTRACT_DIR"/ 2>/dev/null || true
  rm -rf "$EXTRACT_DIR/squashfs-root"
fi

cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
set -e
APP="$APP_IMAGE"
EXTRACTED="$EXTRACT_DIR/AppRun"
if [ -x "\$EXTRACTED" ] && { [ ! -e /dev/fuse ] || ! ldconfig -p 2>/dev/null | grep -q 'libfuse\\.so\\.2'; }; then
  exec "\$EXTRACTED" --no-sandbox --ozone-platform-hint=auto "\$@"
fi
exec "\$APP" --no-sandbox --ozone-platform-hint=auto "\$@"
EOF
chmod +x "$WRAPPER"

ICON_URL="https://raw.githubusercontent.com/$REPO/main/assets/ludex.png"
curl -fsSL "$ICON_URL" -o "$ICON_DIR/ludex.png" 2>/dev/null || true

cat > "$DESKTOP_DIR/ludex.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Ludex
Comment=Game library and launcher
Exec=$WRAPPER %U
Icon=ludex
Terminal=false
Categories=Game;
StartupNotify=true
MimeType=x-scheme-handler/ascendara;
EOF
chmod +x "$DESKTOP_DIR/ludex.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

cat <<'TXT'

Ludex is installed.

Steam Deck Game Mode:
  1. Open Steam in Desktop Mode.
  2. Add a Non-Steam Game.
  3. Choose "Ludex" (or ~/.local/bin/ludex).
  4. Switch to Game Mode and launch Ludex from your library.

Desktop Mode:
  Run "ludex" or open Ludex from the application menu.

Ludex Stream:
  Install Sunshine on this Deck if you want to stream TO it.
  To stream FROM a stronger PC, run Ludex on that PC and open the invite
  link on the Deck. Moonlight is available in Discover.
TXT
