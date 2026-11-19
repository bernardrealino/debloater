import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { adb, findAdb, resolveAdb, setAdbPath, getAdbPath, parseDevices, sh } from './adb.js';
import { debloatRoutes } from './debloat.js';
import { APP_DIR, DATA_DIR, IS_EXE, readUi } from './assets.js';

const VERSION = '1.0.0';
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8710;
const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';

// ---------- settings (adb path, device names) ----------

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const settings = { adbPath: '', names: {} };
try {
  Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
} catch {}
const save = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

// adb next to the exe, or the copy this program downloaded, are tried before PATH.
const LOCAL_ADB = [path.join(APP_DIR, 'platform-tools', EXE), path.join(DATA_DIR, 'platform-tools', EXE)];
setAdbPath(findAdb(settings.adbPath, LOCAL_ADB));

// ---------- devices ----------

const props = new Map(); // serial -> { model, os, maker }

async function loadProps(serial) {
  if (props.has(serial)) return;
  props.set(serial, null);
  const r = await sh(serial, 'getprop ro.product.model; getprop ro.build.version.release; getprop ro.product.manufacturer', { timeout: 8000 });
  if (r.code !== 0) return props.delete(serial);
  const [model, os, maker] = r.stdout.split(/\r?\n/).map((s) => s.trim());
  props.set(serial, { model, os, maker });
}

async function listDevices() {
  if (!getAdbPath()) return { devices: [], adbError: 'adb was not found on this PC.' };
  const r = await adb(['devices', '-l'], { timeout: 15000 });
  if (r.code !== 0) return { devices: [], adbError: (r.stderr || 'adb did not respond.').trim() };
  const devices = parseDevices(r.stdout).map((d) => {
    const state = d.adbState === 'device' ? 'online' : d.adbState === 'unauthorized' || d.adbState === 'authorizing' ? 'unauthorized' : 'offline';
    if (state === 'online') loadProps(d.serial);
    const p = props.get(d.serial) || {};
    const model = p.model || d.model || '';
    return { serial: d.serial, state, name: settings.names[d.serial] || model || d.serial, model, os: p.os || '', maker: p.maker || '', network: /:\d+$/.test(d.serial) };
  });
  devices.sort((a, b) => a.name.localeCompare(b.name));
  return { devices, adbError: '' };
}

// ---------- downloading adb (Google's SDK Platform-Tools) ----------

const TOOLS_URL = {
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
}[process.platform];

const run = (file, args) => new Promise((resolve) => {
  const child = spawn(file, args, { windowsHide: true });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.on('error', (e) => resolve({ code: -1, err: e.message }));
  child.on('close', (code) => resolve({ code, err }));
});

let downloading = false;
async function downloadAdb() {
  if (!TOOLS_URL) throw new Error('No adb download for this system.');
  const res = await fetch(TOOLS_URL);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const zip = path.join(DATA_DIR, 'platform-tools.zip');
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  fs.rmSync(path.join(DATA_DIR, 'platform-tools'), { recursive: true, force: true });
  // Windows 10 and newer ship bsdtar, which reads zip files; elsewhere use unzip.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
  const r = process.platform === 'win32' ? await run(tar, ['-xf', zip, '-C', DATA_DIR]) : await run(tar, ['-oq', zip, '-d', DATA_DIR]);
  fs.rmSync(zip, { force: true });
  const found = resolveAdb(path.join(DATA_DIR, 'platform-tools'));
  if (r.code !== 0 || !found) throw new Error(`Could not unpack adb. ${r.err.trim()}`);
  return found;
}

// ---------- web server ----------

const app = express();
app.disable('x-powered-by');

// Only answer pages opened as localhost, so other websites cannot reach this server by DNS tricks.
app.use((req, res, next) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return res.status(403).type('text').send('Open Debloater at http://localhost.');
  next();
});
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

app.get('/api/ping', (req, res) => res.json({ app: 'debloater', version: VERSION }));

app.get('/api/state', wrap(async (req, res) => {
  const { devices, adbError } = await listDevices();
  res.json({ devices, adbError, adbPath: getAdbPath(), savedAdbPath: settings.adbPath, canDownload: !!TOOLS_URL, version: VERSION });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const typed = String(req.body.adbPath || '').trim().replace(/^"|"$/g, '');
  const found = typed ? resolveAdb(typed) : findAdb('', LOCAL_ADB);
  if (typed && !found) return res.status(400).json({ error: 'No adb program at that path.' });
  settings.adbPath = typed;
  save();
  setAdbPath(found);
  res.json({ adbPath: getAdbPath() });
}));

app.post('/api/adb/download', wrap(async (req, res) => {
  if (downloading) return res.status(409).json({ error: 'adb is already downloading.' });
  downloading = true;
  try {
    const found = await downloadAdb();
    settings.adbPath = '';
    save();
    setAdbPath(found);
    res.json({ adbPath: found });
  } finally {
    downloading = false;
  }
}));

app.post('/api/connect', wrap(async (req, res) => {
  let target = String(req.body.host || '').trim();
  if (!/^[\w.\-]+(:\d+)?$/.test(target)) return res.status(400).json({ error: 'Enter an IP address or host name, like 192.168.1.41' });
  if (!/:\d+$/.test(target)) target += ':5555';
  const r = await adb(['connect', target], { timeout: 15000 });
  const text = (r.stdout + r.stderr).trim();
  if (r.code !== 0 || /failed|cannot|unable/i.test(text)) return res.status(400).json({ error: text || 'Could not connect.' });
  res.json({ message: text, serial: target });
}));

app.post('/api/devices/:serial/disconnect', wrap(async (req, res) => {
  const r = await adb(['disconnect', req.params.serial], { timeout: 10000 });
  res.json({ message: (r.stdout + r.stderr).trim() });
}));

app.put('/api/devices/:serial/name', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (name) settings.names[req.params.serial] = name;
  else delete settings.names[req.params.serial];
  save();
  res.json({ ok: true });
});

debloatRoutes(app, wrap);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
app.get('*', (req, res) => {
  let rel = decodeURIComponent(req.path).replace(/^\/+/, '');
  let body = rel && !rel.includes('..') ? readUi(rel) : null;
  if (!body) {
    rel = 'index.html';
    body = readUi(rel);
  }
  if (!body) return res.status(503).type('text').send('The web UI is not built yet. Run: npm run build:web');
  res.type(TYPES[path.extname(rel)] || 'application/octet-stream');
  res.setHeader('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
  res.send(body);
});

// ---------- start ----------

function openBrowser(url) {
  if (process.env.NO_BROWSER) return;
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

const server = http.createServer(app);

function started() {
  const url = `http://localhost:${server.address().port}`;
  console.log(`Debloater ${VERSION} is running at ${url}`);
  console.log(getAdbPath() ? `Using adb at ${getAdbPath()}` : 'adb was not found. The page offers to download it.');
  console.log(IS_EXE ? 'Close this window to stop Debloater.' : 'Press Ctrl+C to stop.');
  openBrowser(url);
}

server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE' || server.listening) throw e;
  // Already running? Then just open it again. Otherwise take any free port.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(2000) });
    if ((await r.json()).app === 'debloater') {
      console.log('Debloater is already running. Opening it in the browser.');
      openBrowser(`http://localhost:${PORT}`);
      return setTimeout(() => process.exit(0), 1500);
    }
  } catch {}
  server.listen(0, HOST, started);
});

server.listen(PORT, HOST, started);
