/**
 * Ludex Stream
 * Local-first game streaming orchestration on top of Sunshine + Moonlight.
 *
 * The host PC runs Sunshine, games are exposed as Sunshine apps, and invite
 * links point clients at a local landing page with the right Moonlight
 * command, quality profile and optional Wake-on-LAN button.
 */

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const dgram = require("dgram");
const { spawn, execSync } = require("child_process");
const { ipcMain, shell } = require("electron");
const { getSettingsManager } = require("../core/settings");
const { sanitizeGameName } = require("../core/utils");

const STREAM_DIR = path.join(os.homedir(), ".ascendara", "stream");
const SETTINGS_FILE = path.join(STREAM_DIR, "settings.json");
const SESSIONS_FILE = path.join(STREAM_DIR, "sessions.json");
const LAUNCHER_DIR = path.join(STREAM_DIR, "launchers");

const DEFAULT_SETTINGS = {
  enabled: true,
  port: 47991,
  bindAddress: "0.0.0.0",
  hostName: os.hostname(),
  wolMac: "",
  defaultProfile: "balanced",
  sessionTtlMinutes: 720,
  lanOnly: true,
  publicHost: "",
  qualityProfiles: [
    { id: "low", name: "Low latency", width: 1280, height: 720, fps: 60, bitrate: 8000 },
    { id: "balanced", name: "Balanced", width: 1920, height: 1080, fps: 60, bitrate: 20000 },
    { id: "quality", name: "High quality", width: 2560, height: 1440, fps: 60, bitrate: 40000 },
    { id: "deck", name: "Steam Deck", width: 1280, height: 800, fps: 60, bitrate: 15000 },
    { id: "esports", name: "High FPS", width: 1920, height: 1080, fps: 120, bitrate: 30000 },
  ],
};

let inviteServer = null;
let inviteServerPort = null;

function ensureDirs() {
  fs.ensureDirSync(STREAM_DIR);
  fs.ensureDirSync(LAUNCHER_DIR);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.ensureDirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function getSettings() {
  ensureDirs();
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...(patch || {}) };
  next.port = Math.min(65535, Math.max(1024, Number(next.port) || 47991));
  next.sessionTtlMinutes = Math.min(
    60 * 24 * 30,
    Math.max(5, Number(next.sessionTtlMinutes) || 720)
  );
  writeJson(SETTINGS_FILE, next);
  return next;
}

/* ------------------------------------------------------------------------- */
/* Sunshine                                                                    */
/* ------------------------------------------------------------------------- */

function findOnPath(binary) {
  try {
    const output = execSync(process.platform === "win32" ? `where ${binary}` : `which ${binary}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function getSunshineInfo() {
  const candidates = [];
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]) {
      if (root) {
        candidates.push(path.join(root, "Sunshine", "sunshine.exe"));
        candidates.push(path.join(root, "LizardByte", "Sunshine", "sunshine.exe"));
      }
    }
  } else {
    candidates.push("/usr/bin/sunshine", "/usr/local/bin/sunshine", path.join(os.homedir(), ".local/bin/sunshine"));
  }
  const fromPath = findOnPath("sunshine");
  if (fromPath) candidates.unshift(fromPath);
  const executable = candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;

  let configDir = null;
  if (executable) {
    const portableConfig = path.join(path.dirname(executable), "config");
    if (fs.existsSync(path.join(portableConfig, "apps.json"))) {
      configDir = portableConfig;
    }
  }
  if (!configDir) {
    if (process.platform === "win32") {
      for (const root of [process.env.ProgramFiles, process.env.LOCALAPPDATA, process.env.APPDATA]) {
        if (!root) continue;
        const candidate = path.join(root, "Sunshine", "config");
        if (fs.existsSync(candidate)) {
          configDir = candidate;
          break;
        }
      }
    } else {
      const candidate = path.join(os.homedir(), ".config", "sunshine");
      if (fs.existsSync(candidate)) configDir = candidate;
    }
  }
  if (!configDir) {
    configDir = process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "Sunshine", "config")
      : path.join(os.homedir(), ".config", "sunshine");
  }

  return {
    installed: !!executable,
    running: isSunshineRunning(),
    executable,
    configDir,
    appsPath: path.join(configDir, "apps.json"),
    webUrl: "https://localhost:47990",
  };
}

function isSunshineRunning() {
  try {
    if (process.platform === "win32") {
      const out = execSync('tasklist /FI "IMAGENAME eq sunshine.exe" /NH', {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return /sunshine\.exe/i.test(out);
    }
    execSync("pgrep -x sunshine", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startSunshine() {
  const info = getSunshineInfo();
  if (!info.installed) throw new Error("Sunshine is not installed");
  if (info.running) return { success: true, alreadyRunning: true };
  const child = spawn(info.executable, [], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { success: true };
}

function stopSunshine() {
  try {
    if (process.platform === "win32") {
      execSync('taskkill /F /IM sunshine.exe', { stdio: "ignore" });
    } else {
      execSync("pkill -x sunshine", { stdio: "ignore" });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/* ------------------------------------------------------------------------- */
/* Games                                                                       */
/* ------------------------------------------------------------------------- */

function listInstalledGames() {
  const settings = getSettingsManager().getSettings();
  const seen = new Set();
  const games = [];

  const push = game => {
    const key = String(game.name || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    games.push(game);
  };

  for (const directory of [
    settings.downloadDirectory,
    ...(settings.additionalDirectories || []),
  ].filter(Boolean)) {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const infoPath = path.join(directory, entry.name, `${entry.name}.ascendara.json`);
        if (!fs.existsSync(infoPath)) continue;
        try {
          const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
          if (info?.executable) {
            push({
              name: info.game || entry.name,
              executable: info.executable,
              directory: path.dirname(info.executable),
              custom: false,
            });
          }
        } catch {}
      }
      const customPath = path.join(directory, "games.json");
      if (fs.existsSync(customPath)) {
        const data = JSON.parse(fs.readFileSync(customPath, "utf8"));
        for (const entry of data.games || []) {
          if (entry?._isDeleted || !entry?.executable) continue;
          push({
            name: entry.game,
            executable: entry.executable,
            directory: path.dirname(entry.executable),
            custom: true,
          });
        }
      }
    } catch {}
  }

  return games.sort((a, b) => a.name.localeCompare(b.name));
}

function findGameImage(directory) {
  for (const file of ["grid.ascendara.jpg", "grid.ascendara.png", "hero.ascendara.jpg", "hero.ascendara.png", "header.ascendara.jpg"]) {
    const candidate = path.join(directory, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function buildLauncher(game) {
  const safeName = sanitizeGameName(game.name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const isWindowsExe = /\.(exe|msi|bat)$/i.test(game.executable);

  if (process.platform === "win32") {
    return {
      cmd: `"${game.executable}"`,
      workingDir: game.directory,
      launcherPath: null,
    };
  }

  if (!isWindowsExe) {
    return {
      cmd: `"${game.executable}"`,
      workingDir: game.directory,
      launcherPath: null,
    };
  }

  // Linux: launch Windows games through the same UMU/Proton handler Ludex uses.
  const proton = require("../compat/proton");
  const { getGameUmuId } = require("../compat/umu-database");
  let gameInfo = null;
  try {
    const infoPath = path.join(game.directory, `${path.basename(game.directory)}.ascendara.json`);
    if (fs.existsSync(infoPath)) gameInfo = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  } catch {}

  const settings = getSettingsManager().getSettings();
  let umuId = gameInfo?.umuId || null;
  if (!umuId) {
    try {
      umuId = await getGameUmuId(game.name);
    } catch {}
  }
  const launchConfig = await proton.buildLaunchConfig(
    game.name,
    game.executable,
    gameInfo?.linuxRunner || null,
    umuId,
    null,
    gameInfo?.onlineFix || null
  );
  if (!launchConfig || launchConfig.error) {
    throw new Error(launchConfig?.error || "Could not build a Linux launch configuration");
  }
  const handler = process.resourcesPath
    ? path.join(process.resourcesPath, "AscendaraGameHandler")
    : path.join(__dirname, "..", "..", "..", "binaries", "AscendaraGameHandler", "target", "release", "AscendaraGameHandler");

  const args = [
    game.executable,
    game.custom ? "1" : "0",
    "--shortcut",
    "--linux-runner-type",
    launchConfig.mode === "umu" ? "umu" : launchConfig.runner.type,
    "--linux-runner-path",
    launchConfig.mode === "umu" ? launchConfig.cmd[0] : launchConfig.runner.path,
    "--linux-compat-data",
    launchConfig.compatDataPath,
    "--linux-steam-path",
    proton.findSteamInstallPath(),
  ];
  if (launchConfig.mode === "umu") {
    args.push(
      "--linux-umu-id",
      launchConfig.env.GAMEID || "umu-default",
      "--linux-proton-path",
      launchConfig.env.PROTONPATH || ""
    );
    if (launchConfig.env.UMU_USE_STEAM === "1") args.push("--linux-umu-use-steam", "1");
  }
  if (launchConfig.env?.WINEDLLOVERRIDES) {
    args.push("--linux-winedlloverrides", launchConfig.env.WINEDLLOVERRIDES);
  }
  if (launchConfig.env?.SteamAppId) args.push("--linux-steamappid", launchConfig.env.SteamAppId);

  const launcherPath = path.join(LAUNCHER_DIR, `${safeName}.sh`);
  const quote = arg => `'${String(arg).replace(/'/g, "'\\''")}'`;
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `exec ${quote(handler)} ${args.map(quote).join(" ")}`,
    "",
  ].join("\n");
  fs.writeFileSync(launcherPath, script, { mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);

  return {
    cmd: `"${launcherPath}"`,
    workingDir: game.directory,
    launcherPath,
  };
}

async function syncSunshineApps() {
  const info = getSunshineInfo();
  if (!info.installed) throw new Error("Sunshine is not installed");

  const games = listInstalledGames();
  const entries = [];
  for (const game of games) {
    try {
      const launcher = await buildLauncher(game);
      entries.push({
        name: game.name,
        cmd: launcher.cmd,
        "working-dir": launcher.workingDir,
        "image-path": findGameImage(game.directory) || "",
        "auto-detach": "true",
        "wait-all": "true",
        "exclude-global-prep-cmd": "false",
        "elevated": "false",
      });
    } catch (error) {
      console.warn(`[Stream] Could not prepare ${game.name}:`, error.message);
    }
  }

  fs.ensureDirSync(path.dirname(info.appsPath));
  if (fs.existsSync(info.appsPath)) {
    fs.copyFileSync(info.appsPath, `${info.appsPath}.ludex-backup`);
  }

  // Preserve apps that were not created by Ludex by merging on name.
  const existing = readJson(info.appsPath, { env: {}, apps: [] });
  const byName = new Map((existing.apps || []).map(app => [app.name, app]));
  for (const entry of entries) byName.set(entry.name, entry);
  const merged = { ...existing, apps: Array.from(byName.values()) };
  writeJson(info.appsPath, merged);
  return { success: true, count: entries.length, appsPath: info.appsPath };
}

/* ------------------------------------------------------------------------- */
/* Sessions + invite server                                                    */
/* ------------------------------------------------------------------------- */

function getSessions() {
  ensureDirs();
  const sessions = readJson(SESSIONS_FILE, []);
  const now = Date.now();
  const active = sessions.filter(session => session.expiresAt > now);
  if (active.length !== sessions.length) writeJson(SESSIONS_FILE, active);
  return active;
}

function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function getQualityProfile(id) {
  const settings = getSettings();
  return (
    settings.qualityProfiles.find(profile => profile.id === id) ||
    settings.qualityProfiles.find(profile => profile.id === settings.defaultProfile) ||
    settings.qualityProfiles[0]
  );
}

function getLanIp() {
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
  } catch {}
  return null;
}

function getPublicHost(settings) {
  if (settings.publicHost) return settings.publicHost;
  return getLanIp() || settings.hostName || os.hostname();
}

function createSession(gameName, options = {}) {
  const settings = getSettings();
  const profile = getQualityProfile(options.profile || settings.defaultProfile);
  const token = crypto.randomBytes(24).toString("hex");
  const session = {
    id: crypto.randomUUID(),
    token,
    game: gameName,
    profile: profile.id,
    profileData: profile,
    createdAt: Date.now(),
    expiresAt:
      Date.now() +
      Math.min(
        60 * 24 * 30,
        Math.max(5, Number(options.ttlMinutes) || settings.sessionTtlMinutes)
      ) *
        60 *
        1000,
    host: getPublicHost(settings),
    port: settings.port,
    allowsWake: !!settings.wolMac,
  };
  const sessions = getSessions();
  sessions.push(session);
  saveSessions(sessions);
  const host = `${getPublicHost(settings)}:${settings.port}`;
  session.url = `http://${host}/stream/${token}`;
  return session;
}

function revokeSession(idOrToken) {
  const sessions = getSessions();
  const next = sessions.filter(
    session => session.id !== idOrToken && session.token !== idOrToken
  );
  saveSessions(next);
  return { success: true, revoked: sessions.length - next.length };
}

function sendWakeOnLan(mac) {
  const normalized = String(mac || "").replace(/[^0-9a-fA-F]/g, "");
  if (normalized.length !== 12) throw new Error("Invalid MAC address");
  const bytes = normalized.match(/.{2}/g).map(hex => parseInt(hex, 16));
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) Buffer.from(bytes).copy(packet, 6 + i * 6);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", error => {
      socket.close();
      reject(error);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, 9, "255.255.255.255", error => {
        socket.close();
        if (error) reject(error);
        else resolve({ success: true });
      });
    });
  });
}

function isPrivateAddress(address) {
  if (!address) return false;
  const value = address.replace(/^::ffff:/, "");
  if (value === "::1" || value === "127.0.0.1") return true;
  if (/^10\./.test(value)) return true;
  if (/^192\.168\./.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (/^169\.254\./.test(value)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(value) || /^fe80:/i.test(value)) return true;
  return false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function invitePage(session, settings) {
  const profile = session.profileData || getQualityProfile(session.profile);
  const command = `moonlight stream ${getPublicHost(settings)} "${session.game}" -width ${profile.width} -height ${profile.height} -fps ${profile.fps} -bitrate ${profile.bitrate}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(session.game)} · Ludex Stream</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#15151c;color:#e8e4d7;display:grid;place-items:center;min-height:100vh;padding:24px}
.card{width:min(680px,100%);border:1px solid #3a3a4d;border-radius:20px;background:linear-gradient(135deg,#1d1d28,#20202e);padding:28px;box-shadow:0 24px 80px #0008}
h1{margin:0 0 4px;font-size:28px}.muted{color:#a8a294}.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#7aa2f7;color:#15151c;font-weight:700;font-size:12px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}.pill{padding:10px 14px;border:1px solid #3a3a4d;border-radius:12px;background:#1a1a24}
code{display:block;white-space:pre-wrap;word-break:break-all;background:#101018;border:1px solid #333349;border-radius:12px;padding:14px;margin-top:12px;color:#95c5bc}
button,a.btn{cursor:pointer;border:0;border-radius:12px;padding:12px 18px;font-weight:700;text-decoration:none;display:inline-block}
.primary{background:#7aa2f7;color:#15151c}.secondary{background:#2d2d39;color:#e8e4d7}
.note{margin-top:20px;padding:14px;border-radius:12px;background:#2a2418;border:1px solid #5c4a23;color:#f0d9a6;font-size:14px}
.hidden{display:none}
</style></head><body><main class="card">
<span class="badge">Ludex Stream</span>
<h1>${escapeHtml(session.game)}</h1>
<p class="muted">Invite from <strong>${escapeHtml(session.host)}</strong> · expires ${new Date(session.expiresAt).toLocaleString()}</p>
<div class="row">
  <span class="pill">${escapeHtml(profile.name)}</span>
  <span class="pill">${profile.width}×${profile.height}</span>
  <span class="pill">${profile.fps} FPS</span>
  <span class="pill">${Math.round(profile.bitrate / 1000)} Mbps</span>
</div>
<h3>Connect with Moonlight</h3>
<p class="muted">Install Moonlight on your device, pair with this host once, then run:</p>
<code id="cmd">${escapeHtml(command)}</code>
<div class="row">
  <button class="primary" onclick="navigator.clipboard.writeText(document.getElementById('cmd').textContent)">Copy command</button>
  <a class="btn secondary" href="https://moonlight-stream.org/" target="_blank" rel="noreferrer">Get Moonlight</a>
  ${session.allowsWake ? '<button class="secondary" id="wake">Wake host</button>' : ""}
</div>
<div class="note">First-time setup: open <strong>https://${escapeHtml(session.host)}:47990</strong> on the host, pair the client with the PIN shown in Sunshine, then start the stream. Ludex never sees your video or input.</div>
<script>
const token=${JSON.stringify(session.token)};
const wake=document.getElementById('wake');
if(wake) wake.onclick=async()=>{wake.disabled=true;wake.textContent='Waking…';try{const r=await fetch('/wake/'+token,{method:'POST'});const j=await r.json();wake.textContent=j.success?'Magic packet sent':'Wake failed';}catch(e){wake.textContent='Wake failed';}setTimeout(()=>{wake.disabled=false;wake.textContent='Wake host';},5000);};
</script>
</main></body></html>`;
}

function startInviteServer() {
  const settings = getSettings();
  if (inviteServer && inviteServerPort === settings.port) return { success: true, port: settings.port };
  if (inviteServer) {
    inviteServer.close();
    inviteServer = null;
  }

  inviteServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const route = parts[0];
    const token = parts[1];

    if (settings.lanOnly && !isPrivateAddress(req.socket.remoteAddress)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("This Ludex Stream invite is LAN-only.");
      return;
    }

    if (route === "health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, app: "Ludex Stream" }));
      return;
    }

    const session = getSessions().find(item => item.token === token);
    if (!session) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>Invite expired or invalid</h1>");
      return;
    }

    if (route === "stream" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(invitePage(session, settings));
      return;
    }
    if (route === "wake" && req.method === "POST") {
      try {
        await sendWakeOnLan(settings.wolMac);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }
    if (route === "api" && parts[1] === "session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(session));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  inviteServer.on("error", error => {
    console.error("[Stream] Invite server error:", error.message);
  });

  return new Promise(resolve => {
    inviteServer.listen(settings.port, settings.bindAddress || "0.0.0.0", () => {
      inviteServerPort = settings.port;
      console.log(`[Stream] Invite server on http://${settings.bindAddress}:${settings.port}`);
      resolve({ success: true, port: settings.port });
    });
  });
}

function stopInviteServer() {
  if (inviteServer) {
    inviteServer.close();
    inviteServer = null;
    inviteServerPort = null;
  }
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* IPC                                                                         */
/* ------------------------------------------------------------------------- */

function registerStreamHandlers() {
  ipcMain.handle("stream-get-status", async () => {
    const settings = getSettings();
    return {
      settings,
      sunshine: getSunshineInfo(),
      sessions: getSessions(),
      server: { running: !!inviteServer, port: inviteServerPort || settings.port },
    };
  });

  ipcMain.handle("stream-save-settings", async (_, patch) => saveSettings(patch));
  ipcMain.handle("stream-start-sunshine", async () => startSunshine());
  ipcMain.handle("stream-stop-sunshine", async () => stopSunshine());
  ipcMain.handle("stream-open-sunshine", async () => {
    const info = getSunshineInfo();
    await shell.openExternal(info.webUrl);
    return { success: true };
  });
  ipcMain.handle("stream-sync-games", async () => syncSunshineApps());
  ipcMain.handle("stream-list-games", async () => listInstalledGames());
  ipcMain.handle("stream-create-session", async (_, gameName, options) =>
    createSession(gameName, options)
  );
  ipcMain.handle("stream-list-sessions", async () => getSessions());
  ipcMain.handle("stream-revoke-session", async (_, idOrToken) => revokeSession(idOrToken));
  ipcMain.handle("stream-wake", async () => sendWakeOnLan(getSettings().wolMac));
  ipcMain.handle("stream-start-server", async () => startInviteServer());
  ipcMain.handle("stream-stop-server", async () => stopInviteServer());
  ipcMain.handle("stream-get-server-url", async () => {
    const settings = getSettings();
    return `http://${settings.publicHost || `${settings.hostName}:${settings.port}`}`;
  });
}

module.exports = {
  getSettings,
  saveSettings,
  getSunshineInfo,
  startSunshine,
  stopSunshine,
  syncSunshineApps,
  listInstalledGames,
  createSession,
  getSessions,
  revokeSession,
  sendWakeOnLan,
  startInviteServer,
  stopInviteServer,
  registerStreamHandlers,
};
