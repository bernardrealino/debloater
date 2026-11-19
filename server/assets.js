import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sea from 'node:sea';

// Files the program needs: the web UI and the Lite Launcher APK.
// Inside debloater.exe they are embedded as single-executable assets; when run with
// `npm start` they are read from the repository (web/dist and vendor/).

export const IS_EXE = sea.isSea();
const ROOT = path.resolve(path.dirname(process.argv[1] || '.'), '..');

/** Where settings and downloaded adb live: %LOCALAPPDATA%\Debloater on Windows. */
export const DATA_DIR = path.join(
  process.env.LOCALAPPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')),
  'Debloater',
);
fs.mkdirSync(DATA_DIR, { recursive: true });

/** The folder that holds debloater.exe (or the repository when run from source). */
export const APP_DIR = IS_EXE ? path.dirname(process.execPath) : ROOT;

/** Read one UI file by its path under web/dist ("index.html", "assets/x.js"). Returns a Buffer or null. */
export function readUi(rel) {
  if (IS_EXE) {
    try {
      return Buffer.from(sea.getAsset(`ui/${rel}`));
    } catch {
      return null;
    }
  }
  const dist = path.join(ROOT, 'web', 'dist');
  const file = path.resolve(dist, rel);
  if (!file.startsWith(dist + path.sep)) return null;
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

const APK_KEY = 'vendor/lite-launcher.apk';

/** Whether the Lite Launcher APK is available to install. */
export function hasLauncherApk() {
  if (!IS_EXE) return fs.existsSync(path.join(ROOT, APK_KEY));
  try {
    sea.getAsset(APK_KEY);
    return true;
  } catch {
    return false;
  }
}

/** A real file path for the Lite Launcher APK, which `adb install` needs. */
export function launcherApkFile() {
  if (!IS_EXE) return path.join(ROOT, APK_KEY);
  const data = Buffer.from(sea.getAsset(APK_KEY));
  const file = path.join(DATA_DIR, 'lite-launcher.apk');
  let same = false;
  try {
    same = fs.readFileSync(file).equals(data);
  } catch {}
  if (!same) fs.writeFileSync(file, data);
  return file;
}
