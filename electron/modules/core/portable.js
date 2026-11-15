/**
 * Portable mode for Ludex.
 *
 * Portable mode keeps settings, profiles, artwork, Proton prefixes, mods and
 * the default game folder next to the portable drive instead of in the user's
 * home directory. It is enabled by:
 *   - LUDEX_PORTABLE_DIR=/path/to/drive (launcher scripts set this)
 *   - PORTABLE_EXECUTABLE_DIR (electron-builder portable target)
 *   - a portable.flag file next to the executable
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function executableDirectory() {
  try {
    return path.dirname(app.getPath("exe"));
  } catch {
    return process.cwd();
  }
}

function resolvePortableRoot() {
  const explicit =
    process.env.LUDEX_PORTABLE_DIR ||
    process.env.PORTABLE_EXECUTABLE_DIR ||
    "";
  if (explicit) return path.resolve(explicit);

  const exeDir = executableDirectory();
  if (
    fs.existsSync(path.join(exeDir, "portable.flag")) ||
    fs.existsSync(path.join(exeDir, "LudexData"))
  ) {
    return exeDir;
  }

  if (process.env.LUDEX_PORTABLE === "1") return exeDir;
  return null;
}

const portableRoot = resolvePortableRoot();
const isPortableMode = Boolean(portableRoot);
const portableDataDir = portableRoot ? path.join(portableRoot, "LudexData") : null;
const portableGamesDir = portableRoot ? path.join(portableRoot, "Games") : null;

module.exports = {
  portableRoot,
  isPortableMode,
  portableDataDir,
  portableGamesDir,
};
