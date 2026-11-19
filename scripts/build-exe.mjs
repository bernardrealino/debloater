// Builds dist/debloater.exe: one file with Node.js, the server, the web UI and the Lite Launcher APK.
// Uses Node's single executable applications (https://nodejs.org/api/single-executable-applications.html):
//   1. vite builds the UI into web/dist
//   2. esbuild bundles the server into one CommonJS file
//   3. node --experimental-sea-config turns it, plus the UI and APK as assets, into a blob
//   4. a copy of this node binary gets the blob injected with postject
// Run: npm run build      (needs Node 22 or newer; the exe runs on the same OS and CPU as the node that built it)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const UI = path.join(ROOT, 'web', 'dist');
const APK = path.join(ROOT, 'vendor', 'lite-launcher.apk');
const OUT = path.join(DIST, process.platform === 'win32' ? 'debloater.exe' : 'debloater');

const node = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`Node 22 or newer is needed (this is ${process.version}).`);
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

console.log('1/4 Building the web UI');
node([path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn']);

console.log('2/4 Bundling the server');
const main = path.join(BUILD, 'server.cjs');
await build({
  entryPoints: [path.join(ROOT, 'server', 'main.js')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('3/4 Packing the UI and launcher into a blob');
const assets = Object.fromEntries(walk(UI).map((f) => [`ui/${path.relative(UI, f).split(path.sep).join('/')}`, f]));
if (!assets['ui/index.html']) throw new Error('web/dist/index.html is missing after the UI build.');
if (fs.existsSync(APK)) assets['vendor/lite-launcher.apk'] = APK;
else console.warn('   vendor/lite-launcher.apk is missing; the exe will not be able to install the Lite Launcher.');
const blob = path.join(BUILD, 'sea-prep.blob');
const config = path.join(BUILD, 'sea-config.json');
fs.writeFileSync(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2));
node(['--experimental-sea-config', config]);

console.log('4/4 Writing the program');
fs.rmSync(OUT, { force: true });
fs.copyFileSync(process.execPath, OUT);
const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
node([postject, OUT, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])]);
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', OUT], { stdio: 'inherit' });

console.log(`Built ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1048576)} MB, ${Object.keys(assets).length} embedded files)`);
