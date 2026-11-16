/**
 * Nexus Mods one-click downloads without an API key.
 *
 * Nexus' sanctioned free-account flow is the nxm:// link created by the
 * "Mod Manager Download" button on the mod page. The link carries a short-lived
 * key/expires pair; download_link.json accepts it without an API key.
 */

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { spawn } = require("child_process");
const { app, ipcMain } = require("electron");
const { getSettingsManager } = require("../core/settings");
const { sanitizeGameName } = require("../core/utils");

const NEXUS_API = "https://api.nexusmods.com/v1";
const NXM_SCHEME = "x-scheme-handler/nxm";

function parseNxmUrl(raw) {
  const value = String(raw || "").trim();
  const match = /^nxm:\/\/([^/]+)\/mods\/(\d+)\/files\/(\d+)(?:\?([^#]*))?$/i.exec(
    value
  );
  if (!match) throw new Error("Invalid nxm:// link");
  const params = new URLSearchParams(match[4] || "");
  return {
    domain: match[1],
    modId: Number(match[2]),
    fileId: Number(match[3]),
    key: params.get("key") || "",
    expires: params.get("expires") || "",
    userId: params.get("user_id") || null,
    raw: value,
  };
}

function findGameDirectory(gameName) {
  const settings = getSettingsManager().getSettings();
  const directories = [
    settings.downloadDirectory,
    ...(settings.additionalDirectories || []),
  ].filter(Boolean);
  const sanitized = sanitizeGameName(gameName);
  for (const directory of directories) {
    for (const name of [gameName, sanitized]) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function resolveDownloadLink(nxm) {
  const url = `${NEXUS_API}/games/${encodeURIComponent(
    nxm.domain
  )}/mods/${nxm.modId}/files/${nxm.fileId}/download_link.json`;
  const response = await axios.get(url, {
    params: {
      ...(nxm.key ? { key: nxm.key } : {}),
      ...(nxm.expires ? { expires: nxm.expires } : {}),
    },
    headers: {
      "Application-Name": "Ludex",
      "Application-Version": "1.0.0",
      "User-Agent": "Ludex",
      Accept: "application/json",
    },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (response.status === 403) {
    throw new Error(
      "Nexus refused the download. Open the mod page, click Mod Manager Download again, and retry."
    );
  }
  if (response.status === 410) {
    throw new Error("The nxm link expired. Click Mod Manager Download again.");
  }
  if (response.status === 400) {
    throw new Error("The nxm link is not valid for this file. Get a fresh link from Nexus.");
  }
  if (response.status !== 200 || !Array.isArray(response.data)) {
    throw new Error(`Nexus returned HTTP ${response.status}`);
  }
  const link = response.data.find(item => item?.URI);
  if (!link) throw new Error("Nexus returned no download URL");
  return { url: link.URI, name: link.name || "mod.zip" };
}

async function extractArchive(archivePath, targetDir) {
  const extension = path.extname(archivePath).toLowerCase();
  if (extension === ".zip") {
    const unzipper = require("unzipper");
    await new Promise((resolve, reject) => {
      fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: targetDir }))
        .on("close", resolve)
        .on("error", reject);
    });
    return;
  }
  const sevenZip = process.platform === "win32" ? "7z.exe" : "7z";
  await new Promise((resolve, reject) => {
    const child = spawn(sevenZip, ["x", "-y", `-o${targetDir}`, archivePath], {
      windowsHide: true,
    });
    child.on("error", error =>
      reject(
        new Error(
          `Could not extract ${extension || "archive"}. Install 7-Zip or use a .zip mod. (${error.message})`
        )
      )
    );
    child.on("close", code =>
      code === 0 ? resolve() : reject(new Error(`7-Zip exited with code ${code}`))
    );
  });
}

async function installNxm(nxmUrl, gameName) {
  const nxm = parseNxmUrl(nxmUrl);
  const gameDir = findGameDirectory(gameName);
  if (!gameDir) throw new Error(`Game directory not found for ${gameName}`);

  const download = await resolveDownloadLink(nxm);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ludex-nxm-"));
  try {
    const extension = path.extname(download.name) || path.extname(new URL(download.url).pathname) || ".zip";
    const archivePath = path.join(tempDir, `mod${extension}`);
    const response = await axios.get(download.url, {
      responseType: "stream",
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { "User-Agent": "Ludex" },
    });
    const { pipeline } = require("stream/promises");
    await pipeline(response.data, fs.createWriteStream(archivePath));
    await extractArchive(archivePath, gameDir);
    return {
      success: true,
      installedTo: gameDir,
      file: download.name,
      domain: nxm.domain,
      modId: nxm.modId,
      fileId: nxm.fileId,
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function linuxDesktopPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "applications", "ludex-nxm.desktop");
}

function registerNxmLinux() {
  const executable = process.env.APPIMAGE || process.execPath;
  const file = linuxDesktopPath();
  fs.ensureDirSync(path.dirname(file));
  fs.writeFileSync(
    file,
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Ludex Nexus Handler",
      "NoDisplay=true",
      `Exec="${executable}" --no-sandbox %u`,
      `MimeType=${NXM_SCHEME};`,
      "Terminal=false",
      "",
    ].join("\n")
  );
  fs.chmodSync(file, 0o755);
  try {
    require("child_process").execFileSync("xdg-mime", [
      "default",
      "ludex-nxm.desktop",
      NXM_SCHEME,
    ]);
  } catch (error) {
    console.warn("[NXM] xdg-mime registration failed:", error.message);
  }
  return { success: true, path: file };
}

function unregisterNxmLinux() {
  const file = linuxDesktopPath();
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
  return { success: true };
}

function registerNxm() {
  if (process.platform === "win32") {
    const ok = app.setAsDefaultProtocolClient("nxm");
    return { success: ok, platform: "win32" };
  }
  if (process.platform === "darwin") {
    return {
      success: false,
      error: "On macOS, register nxm:// in the default mod manager.",
    };
  }
  return registerNxmLinux();
}

function unregisterNxm() {
  if (process.platform === "win32") {
    return { success: app.removeAsDefaultProtocolClient("nxm") };
  }
  return unregisterNxmLinux();
}

function isNxmRegistered() {
  if (process.platform === "win32") {
    return app.isDefaultProtocolClient("nxm");
  }
  try {
    const { execFileSync } = require("child_process");
    const output = execFileSync("xdg-mime", ["query", "default", NXM_SCHEME], {
      encoding: "utf8",
    }).trim();
    return output === "ludex-nxm.desktop";
  } catch {
    return false;
  }
}

function listInstalledGameNames() {
  const settings = getSettingsManager().getSettings();
  const names = new Set();
  for (const directory of [
    settings.downloadDirectory,
    ...(settings.additionalDirectories || []),
  ].filter(Boolean)) {
    try {
      for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue;
        const infoPath = path.join(
          directory,
          dirent.name,
          `${dirent.name}.ascendara.json`
        );
        if (fs.existsSync(infoPath)) {
          try {
            const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
            if (info?.game) names.add(info.game);
          } catch {}
        }
        else names.add(dirent.name);
      }
      const gamesPath = path.join(directory, "games.json");
      if (fs.existsSync(gamesPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(gamesPath, "utf8"));
          for (const game of data.games || []) {
            if (game?.game && !game._isDeleted) names.add(game.game);
          }
        } catch {}
      }
    } catch {}
  }
  return Array.from(names);
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function guessGameForDomain(domain) {
  const target = normalizeName(domain);
  if (!target) return null;
  let best = null;
  for (const name of listInstalledGameNames()) {
    const normalized = normalizeName(name);
    if (!normalized) continue;
    if (normalized === target) return name;
    if (normalized.startsWith(target) || target.startsWith(normalized)) {
      if (!best || normalized.length < normalizeName(best).length) best = name;
    }
  }
  return best;
}

async function handleNxmUrl(nxmUrl) {
  const { BrowserWindow } = require("electron");
  const windows = BrowserWindow.getAllWindows();
  const send = (channel, payload) => {
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };
  try {
    const nxm = parseNxmUrl(nxmUrl);
    const game = guessGameForDomain(nxm.domain);
    if (!game) {
      send("nxm-needs-game", { nxm, url: nxmUrl });
      return { success: false, error: "No matching game found", nxm };
    }
    send("nxm-install-started", { game, nxm });
    const result = await installNxm(nxmUrl, game);
    send("nxm-install-result", { game, nxm, ...result });
    return result;
  } catch (error) {
    console.error("[NXM] Handler failed:", error);
    send("nxm-install-result", { success: false, error: error.message });
    return { success: false, error: error.message };
  }
}

function registerNxmHandlers() {
  ipcMain.handle("nexus-nxm-status", async () => ({
    registered: isNxmRegistered(),
    supported: process.platform !== "darwin",
  }));
  ipcMain.handle("nexus-nxm-register", async () => registerNxm());
  ipcMain.handle("nexus-nxm-unregister", async () => unregisterNxm());
  ipcMain.handle("nexus-nxm-install", async (_, nxmUrl, gameName) => {
    try {
      return await installNxm(nxmUrl, gameName);
    } catch (error) {
      console.error("[NXM] Install failed:", error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle("nexus-nxm-parse", async (_, nxmUrl) => {
    try {
      return { success: true, data: parseNxmUrl(nxmUrl) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerNxmHandlers,
  parseNxmUrl,
  installNxm,
  handleNxmUrl,
  registerNxm,
  unregisterNxm,
  isNxmRegistered,
};
