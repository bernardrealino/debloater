// Builds the Lite Launcher APK without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.
// Needs a JDK (11 or newer) and the Android SDK with one build-tools and one platform installed.
// Run: npm run build:launcher      Output: vendor/lite-launcher.apk
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'vendor', 'lite-launcher.apk');
const BUILD = path.join(HERE, 'build');
const KEYSTORE = path.join(HERE, 'launcher.keystore');
const VERSION = { code: '3', name: '3.0' };
const EXE = process.platform === 'win32' ? '.exe' : '';

const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), path.join(os.homedir(), 'Android', 'Sdk'), path.join(os.homedir(), 'Library', 'Android', 'sdk')]
  .find((d) => d && fs.existsSync(path.join(d, 'build-tools')));
if (!sdk) throw new Error('Android SDK not found. Set ANDROID_HOME to its folder.');
const newest = (dir, key) => fs.readdirSync(dir).filter((n) => /\d/.test(n)).sort((a, b) => key(a) - key(b)).pop();
const versionKey = (n) => n.split(/\D+/).filter(Boolean).reduce((sum, part) => sum * 1000 + Number(part), 0);
const tools = path.join(sdk, 'build-tools', newest(path.join(sdk, 'build-tools'), versionKey));
const androidJar = path.join(sdk, 'platforms', newest(path.join(sdk, 'platforms'), versionKey), 'android.jar');
const targetSdk = path.basename(path.dirname(androidJar)).replace(/\D+/g, '');

const run = (file, args, cwd) => {
  try {
    return execFileSync(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    throw new Error(`${path.basename(file)} failed:\n${e.stdout || ''}${e.stderr || e.message}`);
  }
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(BUILD, 'classes'), { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// Resources and manifest.
run(path.join(tools, 'aapt2' + EXE), ['compile', '--dir', path.join(HERE, 'res'), '-o', path.join(BUILD, 'res.zip')]);
run(path.join(tools, 'aapt2' + EXE), [
  'link', '-o', path.join(BUILD, 'unsigned.apk'), '-I', androidJar, '--manifest', path.join(HERE, 'AndroidManifest.xml'),
  '--min-sdk-version', '21', '--target-sdk-version', targetSdk, '--version-code', VERSION.code, '--version-name', VERSION.name,
  path.join(BUILD, 'res.zip'),
]);

// Code.
const sources = walk(path.join(HERE, 'src')).filter((f) => f.endsWith('.java'));
run('javac', ['-Xlint:-options', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-classpath', androidJar, '-d', path.join(BUILD, 'classes'), ...sources]);
const classes = walk(path.join(BUILD, 'classes')).filter((f) => f.endsWith('.class'));
run('java', ['-cp', path.join(tools, 'lib', 'd8.jar'), 'com.android.tools.r8.D8', '--release', '--lib', androidJar, '--min-api', '21', '--output', BUILD, ...classes]);
run(path.join(tools, 'aapt' + EXE), ['add', 'unsigned.apk', 'classes.dex'], BUILD);

// Align and sign. The key only has to stay the same between builds so updates install over the old version.
run(path.join(tools, 'zipalign' + EXE), ['-f', '4', path.join(BUILD, 'unsigned.apk'), path.join(BUILD, 'aligned.apk')]);
if (!fs.existsSync(KEYSTORE)) {
  run('keytool', ['-genkeypair', '-keystore', KEYSTORE, '-storepass', 'android', '-keypass', 'android', '-alias', 'launcher', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Lite Launcher']);
}
run('java', ['-jar', path.join(tools, 'lib', 'apksigner.jar'), 'sign', '--ks', KEYSTORE, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'launcher', '--out', OUT, path.join(BUILD, 'aligned.apk')]);
fs.rmSync(OUT + '.idsig', { force: true });
run('java', ['-jar', path.join(tools, 'lib', 'apksigner.jar'), 'verify', OUT]);

console.log(`Built ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB) with ${path.basename(tools)}, target SDK ${targetSdk}`);
