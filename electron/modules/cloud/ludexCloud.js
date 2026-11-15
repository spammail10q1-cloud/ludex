/**
 * Ludex Cloud — zero-cost, bring-your-own-storage sync.
 *
 * There is no Ludex server. A snapshot (profile, preferences, library metadata,
 * mod profiles) is stored in a private GitHub repository owned by the user.
 * GitHub's free plan is enough, so sync costs nothing to run and nothing to host.
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { app, ipcMain } = require("electron");
const { getSettingsManager } = require("../core/settings");

const CONFIG_FILE = () => path.join(app.getPath("userData"), "ludex-cloud.json");
const DEFAULT_PATH = "ludex-cloud/snapshot.json";
const API = "https://api.github.com";

const SECRET_KEYS = new Set([
  "torboxApiKey",
  "realDebridApiKey",
  "realDebridOauthClientId",
  "realDebridOauthClientSecret",
  "realDebridOauthRefreshToken",
  "premiumizeApiKey",
  "allDebridApiKey",
  "debridLinkApiKey",
  "nexusApiKey",
]);

const MACHINE_PATH_KEYS = new Set([
  "downloadDirectory",
  "additionalDirectories",
  "linuxRunner",
  "crackDirectory",
  "wine",
  "proton",
  "macRunner",
  "highballRenderer",
  "highballBottleMode",
  "highballHome",
  "highballBottle",
]);

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  const file = CONFIG_FILE();
  fs.ensureDirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  return config;
}

function publicConfig() {
  const config = readConfig();
  return {
    connected: Boolean(config.token && config.owner && config.repo),
    provider: "github",
    owner: config.owner || "",
    repo: config.repo || "",
    branch: config.branch || "main",
    path: config.path || DEFAULT_PATH,
    lastSync: config.lastSync || null,
    lastError: config.lastError || null,
    lastDirection: config.lastDirection || null,
  };
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Ludex-Cloud",
  };
}

async function githubGet(token, url, options = {}) {
  return axios.get(url.startsWith("http") ? url : `${API}${url}`, {
    headers: authHeaders(token),
    timeout: 30000,
    ...options,
  });
}

async function githubPut(token, url, data) {
  return axios.put(url.startsWith("http") ? url : `${API}${url}`, data, {
    headers: authHeaders(token),
    timeout: 30000,
  });
}

async function githubPost(token, url, data) {
  return axios.post(url.startsWith("http") ? url : `${API}${url}`, data, {
    headers: authHeaders(token),
    timeout: 30000,
  });
}

async function validateToken(token) {
  if (!token || typeof token !== "string") throw new Error("Missing GitHub token");
  const response = await githubGet(token, "/user");
  return {
    login: response.data?.login,
    name: response.data?.name || response.data?.login,
    avatar: response.data?.avatar_url || null,
  };
}

async function createRepo(token, name, owner) {
  const clean = String(name || "ludex-cloud")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 90);
  if (!clean) throw new Error("Invalid repository name");
  const user = await validateToken(token);
  const org = owner && owner !== user.login ? owner : null;
  const url = org ? `/orgs/${encodeURIComponent(org)}/repos` : "/user/repos";
  try {
    await githubPost(token, url, {
      name: clean,
      private: true,
      auto_init: true,
      description: "Ludex Cloud snapshot storage",
    });
  } catch (error) {
    if (error.response?.status !== 422) throw error;
    // 422 usually means the repo already exists; that is fine.
  }
  return { owner: org || user.login, repo: clean, branch: "main" };
}

function sanitizeSettings(settings) {
  const output = {};
  for (const [key, value] of Object.entries(settings || {})) {
    if (SECRET_KEYS.has(key)) continue;
    if (MACHINE_PATH_KEYS.has(key)) continue;
    if (typeof value === "string" && /(token|secret|apikey|api_key|password)/i.test(key)) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function listLibrary() {
  const settings = getSettingsManager().getSettings();
  const games = [];
  const seen = new Set();
  const add = (entry, custom) => {
    const name = entry.game || entry.name;
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    games.push({
      name,
      custom: !!custom,
      version: entry.version || null,
      size: entry.size || null,
      playTime: entry.playTime || 0,
      launchCount: entry.launchCount || 0,
      lastPlayed: entry.lastPlayed || null,
      online: !!entry.online,
      dlc: !!entry.dlc,
      isVr: !!entry.isVr,
      gameID: entry.gameID || null,
    });
  };

  for (const directory of [
    settings.downloadDirectory,
    ...(settings.additionalDirectories || []),
  ].filter(Boolean)) {
    try {
      for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue;
        const infoPath = path.join(directory, dirent.name, `${dirent.name}.ascendara.json`);
        if (!fs.existsSync(infoPath)) continue;
        try {
          add(JSON.parse(fs.readFileSync(infoPath, "utf8")), false);
        } catch {}
      }
      const customPath = path.join(directory, "games.json");
      if (fs.existsSync(customPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(customPath, "utf8"));
          for (const entry of data.games || []) {
            if (!entry?._isDeleted) add(entry, true);
          }
        } catch {}
      }
    } catch {}
  }
  return games;
}

function listModProfiles() {
  const settings = getSettingsManager().getSettings();
  const output = {};
  for (const directory of [
    settings.downloadDirectory,
    ...(settings.additionalDirectories || []),
  ].filter(Boolean)) {
    try {
      for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue;
        const manifestPath = path.join(
          directory,
          dirent.name,
          ".ludex",
          "mods",
          "installed.json"
        );
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          output[dirent.name] = {
            mods: (manifest.mods || []).map(mod => ({
              id: mod.id,
              name: mod.name,
              enabled: !!mod.enabled,
              order: mod.order || 0,
              source: mod.source || null,
              version: mod.version || null,
            })),
            profiles: manifest.profiles || [],
            activeProfile: manifest.activeProfile || null,
          };
        } catch {}
      }
    } catch {}
  }
  return output;
}

async function buildSnapshot(extras = {}) {
  const settings = getSettingsManager().getSettings();
  const profileDir = path.join(app.getPath("userData"), "profile_images");
  const readImage = name => {
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      const file = path.join(profileDir, `${name}.${ext}`);
      if (fs.existsSync(file)) {
        return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs
          .readFileSync(file)
          .toString("base64")}`;
      }
    }
    return null;
  };

  return {
    schema: 1,
    app: "Ludex",
    version: app.getVersion?.() || "12.3.1",
    exportedAt: new Date().toISOString(),
    profile: {
      image: extras.profileImage || readImage("profile"),
      banner: extras.profileBanner || readImage("banner"),
      emoji: extras.selectedEmoji || null,
    },
    settings: sanitizeSettings(settings),
    library: listLibrary(),
    mods: listModProfiles(),
    favorites: Array.isArray(extras.favorites) ? extras.favorites : [],
  };
}

async function getRemoteFile(token, config) {
  const url = `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(
    config.path || DEFAULT_PATH
  )}?ref=${encodeURIComponent(config.branch || "main")}`;
  try {
    const response = await githubGet(token, url);
    return {
      sha: response.data.sha,
      content: Buffer.from(response.data.content || "", "base64").toString("utf8"),
    };
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
}

async function pushSnapshot(extras = {}) {
  const config = readConfig();
  if (!config.token) throw new Error("Connect GitHub first");
  const snapshot = await buildSnapshot(extras);
  const body = JSON.stringify(snapshot, null, 2);
  const encoded = Buffer.from(body, "utf8").toString("base64");
  const existing = await getRemoteFile(config.token, config);
  const payload = {
    message: `Ludex Cloud ${new Date().toISOString()}`,
    content: encoded,
    branch: config.branch || "main",
    ...(existing?.sha ? { sha: existing.sha } : {}),
  };
  await githubPut(
    config.token,
    `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(
      config.path || DEFAULT_PATH
    )}`,
    payload
  );
  const next = {
    ...config,
    lastSync: new Date().toISOString(),
    lastDirection: "push",
    lastError: null,
  };
  writeConfig(next);
  return {
    success: true,
    bytes: Buffer.byteLength(body),
    library: snapshot.library.length,
    exportedAt: snapshot.exportedAt,
    config: publicConfig(),
  };
}

async function pullSnapshot() {
  const config = readConfig();
  if (!config.token) throw new Error("Connect GitHub first");
  const remote = await getRemoteFile(config.token, config);
  if (!remote) throw new Error("No Ludex Cloud snapshot found in that repository");
  const snapshot = JSON.parse(remote.content);
  if (snapshot.app !== "Ludex" || !snapshot.schema) {
    throw new Error("That file is not a Ludex Cloud snapshot");
  }

  const manager = getSettingsManager();
  const appliedSettings = {};
  for (const [key, value] of Object.entries(snapshot.settings || {})) {
    if (MACHINE_PATH_KEYS.has(key) || SECRET_KEYS.has(key)) continue;
    try {
      manager.updateSetting(key, value);
      appliedSettings[key] = value;
    } catch {}
  }

  const profileDir = path.join(app.getPath("userData"), "profile_images");
  fs.ensureDirSync(profileDir);
  const writeImage = (name, dataUrl) => {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
    if (!match) return null;
    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    for (const old of ["png", "jpg", "jpeg", "webp"]) {
      try {
        fs.removeSync(path.join(profileDir, `${name}.${old}`));
      } catch {}
    }
    fs.writeFileSync(path.join(profileDir, `${name}.${ext}`), Buffer.from(match[2], "base64"));
    return ext;
  };
  writeImage("profile", snapshot.profile?.image);
  writeImage("banner", snapshot.profile?.banner);

  const next = {
    ...config,
    lastSync: new Date().toISOString(),
    lastDirection: "pull",
    lastError: null,
  };
  writeConfig(next);

  return {
    success: true,
    snapshot,
    profile: snapshot.profile || {},
    favorites: snapshot.favorites || [],
    libraryCount: (snapshot.library || []).length,
    appliedSettings: Object.keys(appliedSettings).length,
    config: publicConfig(),
  };
}

function registerCloudHandlers() {
  ipcMain.handle("cloud-get-config", async () => publicConfig());

  ipcMain.handle("cloud-save-config", async (_, patch = {}) => {
    const current = readConfig();
    const next = { ...current };
    for (const key of ["owner", "repo", "branch", "path"]) {
      if (patch[key] !== undefined) next[key] = String(patch[key]).trim();
    }
    if (next.path === "") next.path = DEFAULT_PATH;
    if (!next.branch) next.branch = "main";
    writeConfig(next);
    return publicConfig();
  });

  ipcMain.handle("cloud-connect", async (_, { token, owner, repo, branch, path } = {}) => {
    const user = await validateToken(token);
    const current = readConfig();
    const next = {
      ...current,
      token,
      owner: owner || user.login,
      repo: repo || "ludex-cloud",
      branch: branch || "main",
      path: path || DEFAULT_PATH,
      lastError: null,
    };
    writeConfig(next);
    return { ...publicConfig(), login: user.login, avatar: user.avatar };
  });

  ipcMain.handle("cloud-create-repo", async (_, { token, name, owner } = {}) => {
    const config = readConfig();
    const created = await createRepo(token || config.token, name || config.repo, owner);
    const next = { ...config, ...created, token: token || config.token };
    writeConfig(next);
    return publicConfig();
  });

  ipcMain.handle("cloud-push", async (_, extras) => {
    try {
      return await pushSnapshot(extras || {});
    } catch (error) {
      const config = { ...readConfig(), lastError: error.message };
      writeConfig(config);
      throw error;
    }
  });

  ipcMain.handle("cloud-pull", async () => {
    try {
      return await pullSnapshot();
    } catch (error) {
      const config = { ...readConfig(), lastError: error.message };
      writeConfig(config);
      throw error;
    }
  });

  ipcMain.handle("cloud-sign-out", async () => {
    writeConfig({});
    return publicConfig();
  });
}

module.exports = {
  registerCloudHandlers,
  buildSnapshot,
  pushSnapshot,
  pullSnapshot,
};
