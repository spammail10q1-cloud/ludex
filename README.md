# Ludex

Ludex is a local-first game library, downloader, and launcher for Windows and Linux.
It is a rebranded and extended fork of Ascendara with the Ascend account requirement removed.

## Highlights

- **No account required** for the profile, banner, artwork, mods, or trainers.
- **SteamGridDB artwork** — right-click a game in the library and choose **Customize** to pull a new cover, banner, logo, and wide banner automatically.
- **Nexus Mods browser** with optional direct install using a Nexus API key.
- **Download queue**, automatic extraction, integrity verification, and per-game speed limits.
- **Local profile backup** — export/import your profile picture, banner, and emoji.
- **Desktop and Start Menu shortcuts** created directly by the app.
- **Own update channel** through GitHub Releases.

## Install

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/install-linux.sh | bash
```

Then run `ludex` or open **Ludex** from your application menu.

### Windows

```powershell
irm https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/install-windows.ps1 | iex
```

This downloads the portable build, installs it to `%LOCALAPPDATA%\Ludex`, and creates Start Menu and Desktop shortcuts.

## Update

- Linux: `curl -fsSL https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/update-linux.sh | bash`
- Windows: `irm https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/update-windows.ps1 | iex`

User data stays in the legacy `ascendara` config folder, so updates never wipe your library, profile, or artwork.

## Build from source

```bash
npm install --global yarn@1.22.22
yarn install --frozen-lockfile
yarn build
```

For a Linux AppImage:

```bash
yarn dist-linux
```

For a Windows executable (run on Windows):

```powershell
python scripts/build_windows_helpers.py
yarn dist
```

GitHub Actions builds both targets automatically and publishes them as release assets when a `v*` tag is pushed.

## Nexus Mods direct install

Open a game → **Mods** → paste your Nexus Mods API key. Nexus Premium is required by Nexus itself for direct downloads. Without Premium the app still opens the normal Nexus download page.

## License

See `LICENSE`.
