import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';

/** Find adb: ADB_PATH, the saved setting, the extra folders given, PATH, then the usual SDK folders. */
export function findAdb(saved, extra = []) {
  const env = process.env;
  const candidates = [
    env.ADB_PATH,
    saved,
    ...extra,
    ...(env.PATH || '').split(path.delimiter).map((d) => d && path.join(d, EXE)),
    env.ANDROID_HOME && path.join(env.ANDROID_HOME, 'platform-tools', EXE),
    env.ANDROID_SDK_ROOT && path.join(env.ANDROID_SDK_ROOT, 'platform-tools', EXE),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', EXE),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const found = resolveAdb(c);
    if (found) return found;
  }
  return null;
}

/** Resolve a path (the adb program or the folder holding it) to the adb program, or null. */
export function resolveAdb(p) {
  for (const c of [p, path.join(p, EXE)]) {
    try {
      if (fs.statSync(c).isFile() && /^adb(\.exe)?$/i.test(path.basename(c))) return c;
    } catch {}
  }
  return null;
}

let adbPath = null;
export const setAdbPath = (p) => (adbPath = p);
export const getAdbPath = () => adbPath;

/** Run adb to completion (never through a shell). Resolves with { code, stdout, stderr }. */
export function adb(args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    if (!adbPath) return resolve({ code: -1, stdout: '', stderr: 'adb was not found on this PC.' });
    let child;
    try {
      child = spawn(adbPath, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: e.message });
    }
    const out = [];
    const err = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let stderr = Buffer.concat(err).toString('utf8');
      if (timedOut) stderr += `\nTimed out after ${Math.round(timeout / 1000)} s`;
      resolve({ code: timedOut ? -1 : code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr });
    });
  });
}

/** Run a command in the device shell. */
export const sh = (serial, cmd, opts) => adb(['-s', serial, 'shell', cmd], opts);

/** Parse `adb devices -l`. */
export function parseDevices(text) {
  const list = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|authorizing|connecting|recovery|sideload|no permissions.*?)(\s|$)(.*)$/);
    if (!m) continue;
    const info = {};
    for (const part of m[4].split(/\s+/)) {
      const i = part.indexOf(':');
      if (i > 0) info[part.slice(0, i)] = part.slice(i + 1);
    }
    list.push({ serial: m[1], adbState: m[2], model: (info.model || '').replace(/_/g, ' ') });
  }
  return list;
}
