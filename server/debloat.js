import { adb, sh } from './adb.js';
import { hasLauncherApk, launcherApkFile } from './assets.js';

// Debloat: switch off or remove preinstalled apps for the main user, and put them back.
// Nothing here deletes a system app for good; every change can be undone with "restore"
// (or a factory reset), because the app's files stay on the system partition.

// The package name stays com.adbdeck.lite so TVs set up with ADB Deck update in place.
export const LAUNCHER = { pkg: 'com.adbdeck.lite', activity: 'com.adbdeck.lite/.MainActivity' };

// level: safe     = bloat on almost every TV, recommended to switch off
//        optional = a real app or feature; switch off if you do not use it
//        caution  = switching it off removes a feature or needs a replacement first
const CATALOG = {
  // Home screens and what feeds them
  'com.google.android.apps.tv.launcherx': ['Google TV Home', 'The stock home screen with recommendations and ads. Switch off only after another launcher is your home screen.', 'caution', 'Home screen'],
  'com.google.android.tvlauncher': ['Android TV Home', 'The stock home screen. Switch off only after another launcher is your home screen.', 'caution', 'Home screen'],
  'com.google.android.leanbacklauncher': ['Leanback Launcher', 'The old stock home screen. Switch off only after another launcher is your home screen.', 'caution', 'Home screen'],
  'com.google.android.tvrecommendations': ['Home screen recommendations', 'Fills the stock home screen with suggested content.', 'safe', 'Home screen'],
  'com.google.android.leanbacklauncher.recommendations': ['Home screen recommendations (old)', 'Fills the old stock home screen with suggested content.', 'safe', 'Home screen'],
  'com.google.android.apps.tv.dreamx': ['Google TV screensaver', 'Ambient mode screensaver with photos and suggestions.', 'optional', 'Home screen'],
  'com.google.android.backdrop': ['Backdrop screensaver', 'Photo screensaver that downloads pictures in the background.', 'optional', 'Home screen'],
  'com.google.android.tungsten.setupwraith': ['Setup wizard and home recovery', 'Switched off together with the stock home screen. Left on, it takes over the Home button and keeps trying to bring the stock home screen back.', 'caution', 'Home screen'],

  // Google services that are not needed to watch TV
  'com.google.android.feedback': ['Google Feedback', 'Sends feedback reports to Google.', 'safe', 'Google extras'],
  'com.google.android.partnersetup': ['Google Partner Setup', 'Partner configuration used during setup.', 'safe', 'Google extras'],
  'com.google.android.syncadapters.calendar': ['Calendar sync', 'Syncs Google Calendar, which a TV has no use for.', 'safe', 'Google extras'],
  'com.google.android.syncadapters.contacts': ['Contacts sync', 'Syncs Google Contacts, which a TV has no use for.', 'safe', 'Google extras'],
  'com.google.android.printservice.recommendation': ['Print service recommendations', 'Suggests printer plugins.', 'safe', 'Google extras'],
  'com.google.android.tv.bugreportsender': ['Bug report sender', 'Sends bug reports to Google.', 'safe', 'Google extras'],
  'com.google.android.play.games': ['Google Play Games', 'Game profiles and achievements.', 'safe', 'Google extras'],
  'com.google.android.videos': ['Google TV app (Play Movies)', 'Shop and library for films and series.', 'optional', 'Google extras'],
  'com.google.android.youtube.tvmusic': ['YouTube Music', 'Music streaming app.', 'optional', 'Google extras'],
  'com.google.android.youtube.tvkids': ['YouTube Kids', 'YouTube for children.', 'optional', 'Google extras'],
  'com.google.android.youtube.tv': ['YouTube', 'The YouTube app.', 'optional', 'Google extras'],
  'com.google.android.marvin.talkback': ['TalkBack', 'Screen reader. Keep it if anyone uses spoken feedback.', 'optional', 'Google extras'],
  'com.google.android.tts': ['Google Text-to-speech', 'Voices for TalkBack and the Assistant.', 'optional', 'Google extras'],
  'com.google.android.katniss': ['Google Assistant and search', 'Voice search and the microphone button stop working without it.', 'caution', 'Google extras'],
  'com.google.android.apps.mediashell': ['Chromecast built-in', 'Casting from a phone stops working without it.', 'caution', 'Google extras'],
  'com.google.android.tv.remote.service': ['Android TV Remote Service', 'Lets the phone app act as a remote.', 'caution', 'Google extras'],
  'com.android.vending': ['Google Play Store', 'Installs and updates apps. Without it nothing updates.', 'caution', 'Google extras'],
  'com.google.android.inputmethod.latin': ['Gboard', 'The on-screen keyboard. Switch off only with another keyboard installed.', 'caution', 'Google extras'],

  'com.android.tv.feedbackconsent': ['Feedback consent', 'Asks permission to send feedback reports.', 'safe', 'Google extras'],
  'com.netflix.tokenmanager': ['Netflix token manager', 'Only used by the Netflix app.', 'optional', 'Preinstalled apps'],

  // Android leftovers that make no sense on a TV
  'com.android.printspooler': ['Print spooler', 'Printing support.', 'safe', 'Android leftovers'],
  'com.android.bips': ['Default print service', 'Printing support.', 'safe', 'Android leftovers'],
  'com.android.printservice.recommendation': ['Print service recommendations', 'Suggests printer plugins.', 'safe', 'Android leftovers'],
  'com.android.egg': ['Android easter egg', 'The hidden game behind the Android version number.', 'safe', 'Android leftovers'],
  'com.android.traceur': ['System tracing', 'Developer tool for recording system traces.', 'safe', 'Android leftovers'],
  'com.android.bookmarkprovider': ['Bookmark provider', 'Bookmarks for a browser that is not there.', 'safe', 'Android leftovers'],
  'com.android.calllogbackup': ['Call log backup', 'Backs up phone calls, which a TV does not make.', 'safe', 'Android leftovers'],
  'com.android.wallpaperbackup': ['Wallpaper backup', 'Backs up a wallpaper a TV does not have.', 'safe', 'Android leftovers'],
  'com.android.wallpaper.livepicker': ['Live wallpaper picker', 'Chooses animated wallpapers.', 'safe', 'Android leftovers'],
  'com.android.dreams.basic': ['Basic screensavers', 'The plain Android screensavers.', 'safe', 'Android leftovers'],
  'com.android.dreams.phototable': ['Photo screensavers', 'Photo table and photo frame screensavers.', 'safe', 'Android leftovers'],
  'com.android.stk': ['SIM toolkit', 'SIM card menu.', 'safe', 'Android leftovers'],
  'com.android.simappdialog': ['SIM app dialog', 'SIM card prompts.', 'safe', 'Android leftovers'],
  'com.android.htmlviewer': ['HTML viewer', 'Opens saved web pages.', 'safe', 'Android leftovers'],
  'com.android.musicfx': ['MusicFX', 'Equaliser panel for music apps.', 'optional', 'Android leftovers'],
  'com.android.email': ['Email', 'The stock email app.', 'safe', 'Android leftovers'],
  'com.android.calendar': ['Calendar', 'The stock calendar app.', 'safe', 'Android leftovers'],
  'com.android.contacts': ['Contacts', 'The stock contacts app.', 'safe', 'Android leftovers'],
  'com.android.deskclock': ['Clock', 'The stock alarm clock app.', 'safe', 'Android leftovers'],
  'com.android.camera2': ['Camera', 'The stock camera app.', 'safe', 'Android leftovers'],
  'com.android.gallery3d': ['Gallery', 'The stock photo gallery.', 'optional', 'Android leftovers'],
  'com.android.music': ['Music', 'The stock music player.', 'optional', 'Android leftovers'],
  'com.android.quicksearchbox': ['Search box', 'The stock search widget.', 'safe', 'Android leftovers'],
  'com.android.browser': ['Browser', 'The stock web browser.', 'optional', 'Android leftovers'],
  'com.android.hotwordenrollment.okgoogle': ['"OK Google" enrolment', 'Voice wake-word training.', 'optional', 'Android leftovers'],
  'com.android.hotwordenrollment.xgoogle': ['"Hey Google" enrolment', 'Voice wake-word training.', 'optional', 'Android leftovers'],
  'com.android.managedprovisioning': ['Work profile setup', 'Sets up company-managed devices.', 'optional', 'Android leftovers'],

  // Preinstalled streaming apps
  'com.netflix.ninja': ['Netflix', 'Streaming app.', 'optional', 'Preinstalled apps'],
  'com.amazon.amazonvideo.livingroom': ['Prime Video', 'Streaming app.', 'optional', 'Preinstalled apps'],
  'com.disney.disneyplus': ['Disney+', 'Streaming app.', 'optional', 'Preinstalled apps'],
  'com.spotify.tv.android': ['Spotify', 'Music streaming app.', 'optional', 'Preinstalled apps'],
  'com.vidio.android.tv': ['Vidio', 'Streaming app.', 'optional', 'Preinstalled apps'],
  'com.iqiyi.i18n.tv': ['iQIYI', 'Streaming app.', 'optional', 'Preinstalled apps'],
  'com.wetv.tv': ['WeTV', 'Streaming app.', 'optional', 'Preinstalled apps'],
  'com.viu.tv': ['Viu', 'Streaming app.', 'optional', 'Preinstalled apps'],
};

// Parts the TV cannot run without, or that would lock you out (settings, adb, installer, network, vendor hardware).
const PROTECTED = new Set([
  'android', 'com.android.systemui', 'com.android.settings', 'com.android.tv.settings', 'com.android.shell',
  'com.android.packageinstaller', 'com.google.android.packageinstaller', 'com.android.permissioncontroller', 'com.google.android.permissioncontroller',
  'com.google.android.gms', 'com.google.android.gsf', 'com.android.webview', 'com.google.android.webview',
  'com.android.bluetooth', 'com.google.android.bluetooth', 'com.android.inputdevices', 'com.android.keychain', 'com.android.certinstaller',
  'com.android.location.fused', 'com.android.externalstorage', 'com.android.se', 'com.android.proxyhandler', 'com.android.vpndialogs',
  'com.android.ext.services', 'com.google.android.ext.services', 'com.android.modulemetadata', 'com.google.android.modulemetadata',
  'com.android.dynsystem', 'com.android.localtransport', 'com.android.server.telecom', 'com.android.tv.frameworkpackagestubs',
  'com.google.android.tv.frameworkpackagestubs', 'com.android.sharedstoragebackup', 'com.android.backupconfirm', 'com.android.mtp',
  'com.android.companiondevicemanager', 'com.android.statementservice', 'com.android.intentresolver',
  // Android system modules (also matched under their com.google.android names).
  'com.android.adservices.api', 'com.android.cameraextensions', 'com.android.devicelockcontroller', 'com.android.federatedcompute.services',
  'com.android.health.connect.backuprestore', 'com.android.healthconnect.controller', 'com.android.hotspot2.osulogin', 'com.android.nearby.halfsheet',
  'com.android.ondevicepersonalization.services', 'com.android.pacprocessor', 'com.android.rkpdapp', 'com.android.sdksandbox',
  'com.android.settings.intelligence', 'com.android.uwb.resources', 'com.android.virtualmachine.res', 'com.android.ext.shared',
  'com.android.safetycenter.resources', 'com.android.tv.mdnsoffloadmanager', 'com.android.tv.globalkeyhandler',
  // Remote control pairing and firmware, sound processing, preinstall configuration.
  'com.google.android.tv.dfuservice', 'com.google.android.tv.googletvremotepairer', 'com.google.android.presetup.bluetoothpair',
  'com.dolby.android.audio.service', 'android.autoinstalls.config.google.gtvpai',
]);
const PROTECTED_PREFIX = [
  'com.android.providers.', 'com.google.android.providers.', 'com.android.networkstack', 'com.google.android.networkstack', 'com.android.wifi.',
  'com.google.android.wifi.', 'com.android.overlay.', 'com.google.android.overlay.', 'com.android.internal.', 'android.auto_generated_rro',
  'com.android.cts.', 'com.android.captiveportallogin', 'com.google.android.captiveportallogin', 'com.android.connectivity.', 'com.google.android.connectivity.',
  // Chip and TV maker services: tuner, HDMI inputs, picture and sound.
  'com.droidlogic.', 'com.amlogic.', 'com.mediatek.', 'com.realtek.', 'com.hisilicon.', 'com.mstar.', 'com.rockchip.',
];
// Apps that answer "Home" but are not a home screen you can live on.
const FALLBACK_HOME = new Set(['com.android.settings', 'com.android.tv.settings', 'com.google.android.tungsten.setupwraith', 'com.android.provision', 'com.google.android.setupwizard']);

// Google TV's setup wizard doubles as "home recovery": with the stock home screen off it grabs the Home button
// (it outranks other launchers) and loops trying to switch the stock one back on. The two go off and on together.
const RECOVERY = 'com.google.android.tungsten.setupwraith';
const STOCK_HOMES = new Set(['com.google.android.apps.tv.launcherx', 'com.google.android.tvlauncher', 'com.google.android.leanbacklauncher']);

const realHome = (pkg) => !FALLBACK_HOME.has(pkg) && !isProtected(pkg);
const VALID = /^[A-Za-z][\w.]*$/;
// Resource overlays only carry settings for other parts; switching them off frees nothing and can break those parts.
const isProtected = (pkg) => {
  const plain = pkg.replace(/^com.google.android./, 'com.android.');
  return PROTECTED.has(pkg) || PROTECTED.has(plain) || /overlay/i.test(pkg) || PROTECTED_PREFIX.some((p) => pkg.startsWith(p) || plain.startsWith(p));
};
const names = (text) => text.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter((l) => VALID.test(l));

async function readDevice(serial) {
  const mark = '=====';
  const cmd = [
    'pm list packages -s -u', 'pm list packages -3 -u', 'pm list packages', 'pm list packages -d',
    'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME',
    'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME',
  ].join(`; echo ${mark}; `);
  const r = await sh(serial, cmd, { timeout: 30000 });
  const parts = r.stdout.split(mark);
  if (r.code !== 0 || parts.length < 6) throw new Error((r.stderr || 'Could not read the app list from the device.').trim());
  const component = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.]+\/[\w.$]+$/.test(l));
  const [system, user, present, disabled] = parts.slice(0, 4).map((p) => new Set(names(p)));
  return { system, user, present, disabled, homes: [...new Set(component(parts[4]).map((c) => c.split('/')[0]))], currentHome: (component(parts[5]).pop() || '').split('/')[0] };
}

function describe(pkg, dev) {
  const known = CATALOG[pkg];
  const system = dev.system.has(pkg);
  const state = !dev.present.has(pkg) ? 'removed' : dev.disabled.has(pkg) ? 'disabled' : 'enabled';
  const base = { pkg, system, state, home: dev.homes.includes(pkg) };
  if (pkg === LAUNCHER.pkg) return { ...base, name: 'Lite Launcher', note: 'The light home screen that comes with Debloater.', level: 'keep', group: 'Home screen' };
  if (isProtected(pkg)) return { ...base, name: known ? known[0] : '', note: 'The TV needs this to work, so it cannot be changed here.', level: 'keep', group: 'System' };
  if (known) return { ...base, name: known[0], note: known[1], level: known[2], group: known[3] };
  if (!system) return { ...base, name: '', note: 'An app that was installed on this TV.', level: 'app', group: 'Installed apps' };
  return { ...base, name: '', note: 'Not in the list of known apps. Look the name up before switching it off.', level: 'unknown', group: 'Other system parts' };
}

async function launcherState(serial, dev) {
  return {
    available: hasLauncherApk(),
    installed: dev.present.has(LAUNCHER.pkg),
    isHome: dev.currentHome === LAUNCHER.pkg,
    currentHome: dev.currentHome,
    homes: dev.homes.filter(realHome),
    // What "switch the stock home screen off" has to switch off: other home screens and the recovery helper.
    stock: [...dev.homes.filter((h) => realHome(h) && h !== LAUNCHER.pkg), ...(dev.present.has(RECOVERY) && !dev.disabled.has(RECOVERY) ? [RECOVERY] : [])],
  };
}

export function debloatRoutes(app, wrap) {
  app.get('/api/devices/:serial/debloat', wrap(async (req, res) => {
    const dev = await readDevice(req.params.serial);
    const all = [...new Set([...dev.system, ...dev.user])].sort();
    res.json({ packages: all.map((p) => describe(p, dev)), launcher: await launcherState(req.params.serial, dev) });
  }));

  app.post('/api/devices/:serial/debloat', wrap(async (req, res) => {
    const serial = req.params.serial;
    const action = req.body.action;
    const packages = Array.isArray(req.body.packages) ? [...new Set(req.body.packages.map(String))] : [];
    if (!['disable', 'remove', 'restore'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    if (!packages.length || packages.some((p) => !VALID.test(p))) return res.status(400).json({ error: 'Choose at least one app.' });

    if (action !== 'restore') {
      const blocked = packages.filter(isProtected);
      if (blocked.length) return res.status(400).json({ error: `The TV needs these to work, so they were left alone: ${blocked.join(', ')}` });
      // Never leave the TV without a home screen.
      const dev = await readDevice(serial);
      const usable = (p) => dev.present.has(p) && !dev.disabled.has(p) && realHome(p);
      const homesNow = dev.homes.filter(usable);
      const homesLeft = homesNow.filter((p) => !packages.includes(p));
      if (homesNow.length && !homesLeft.length) {
        return res.status(400).json({ error: 'That would leave the TV without a home screen. Install the Lite Launcher (or another launcher) first, then switch the stock home screen off.' });
      }
    }

    // Keep the recovery helper in step with the stock home screen.
    if (packages.some((p) => STOCK_HOMES.has(p)) && !packages.includes(RECOVERY)) {
      const dev = await readDevice(serial);
      const off = !dev.present.has(RECOVERY) || dev.disabled.has(RECOVERY);
      if (dev.system.has(RECOVERY) && (action === 'restore' ? off : !off)) packages.push(RECOVERY);
    }

    const results = [];
    for (const pkg of packages) {
      let r;
      if (action === 'disable') r = await sh(serial, `pm disable-user --user 0 ${pkg}`, { timeout: 20000 });
      else if (action === 'remove') r = await sh(serial, `pm uninstall -k --user 0 ${pkg}`, { timeout: 30000 });
      else r = await sh(serial, `cmd package install-existing --user 0 ${pkg} >/dev/null 2>&1; pm enable --user 0 ${pkg}`, { timeout: 30000 });
      const text = (r.stdout + r.stderr).trim();
      const ok = r.code === 0 && (action === 'remove' ? /Success/.test(text) : /new state/.test(text));
      results.push({ pkg, ok, message: ok ? '' : text.split(/\r?\n/).pop().slice(0, 200) || 'No answer from the device.' });
    }
    res.json({ results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
  }));

  app.post('/api/devices/:serial/launcher', wrap(async (req, res) => {
    const serial = req.params.serial;
    const action = req.body.action;
    if (action === 'install') {
      if (!hasLauncherApk()) return res.status(400).json({ error: 'The launcher APK is missing. Run: npm run build:launcher' });
      const r = await adb(['-s', serial, 'install', '-r', launcherApkFile()], { timeout: 120000 });
      const text = (r.stdout + r.stderr).trim();
      if (r.code !== 0 || !/Success/.test(text)) return res.status(400).json({ error: text.split(/\r?\n/).pop() || 'Install failed.' });
      return res.json({ message: 'Lite Launcher is installed.' });
    }
    if (action === 'home') {
      const dev = await readDevice(serial);
      if (!dev.present.has(LAUNCHER.pkg)) return res.status(400).json({ error: 'Install the Lite Launcher first.' });
      const r = await sh(serial, `cmd package set-home-activity --user 0 ${LAUNCHER.activity} || cmd package set-home-activity ${LAUNCHER.activity}; input keyevent 3`, { timeout: 20000 });
      const after = await readDevice(serial);
      if (after.currentHome === LAUNCHER.pkg) return res.json({ message: 'Lite Launcher is now the home screen.', isHome: true });
      return res.json({
        isHome: false,
        message: `The TV kept its own home screen${/Success/i.test(r.stdout) ? '' : ` (${(r.stdout + r.stderr).trim().split(/\r?\n/).pop() || 'no answer'})`}. Switch the stock home screen off in the list below and the Lite Launcher takes over.`,
      });
    }
    if (action === 'open') {
      const r = await sh(serial, `am start -n ${LAUNCHER.activity}`, { timeout: 15000 });
      return r.code === 0 ? res.json({ message: 'Opened.' }) : res.status(400).json({ error: (r.stderr || r.stdout).trim() });
    }
    if (action === 'uninstall') {
      // Bring the stock home screens back first so the TV is never left without one.
      const dev = await readDevice(serial);
      const stock = dev.homes.concat(Object.keys(CATALOG).filter((p) => CATALOG[p][3] === 'Home screen' && CATALOG[p][2] === 'caution' && dev.system.has(p)));
      for (const pkg of new Set(stock)) {
        if (pkg === LAUNCHER.pkg || (!realHome(pkg) && pkg !== RECOVERY)) continue;
        if (!dev.present.has(pkg) || dev.disabled.has(pkg)) await sh(serial, `cmd package install-existing --user 0 ${pkg} >/dev/null 2>&1; pm enable --user 0 ${pkg}`, { timeout: 30000 });
      }
      const after = await readDevice(serial);
      if (!after.homes.some((p) => p !== LAUNCHER.pkg && realHome(p) && !after.disabled.has(p))) {
        return res.status(400).json({ error: 'No other home screen is switched on. Restore the stock home screen in the list below first, then remove the Lite Launcher.' });
      }
      const r = await adb(['-s', serial, 'uninstall', LAUNCHER.pkg], { timeout: 60000 });
      await sh(serial, 'input keyevent 3', { timeout: 10000 });
      return /Success/.test(r.stdout) ? res.json({ message: 'Lite Launcher was removed and the stock home screen is back.' }) : res.status(400).json({ error: (r.stdout + r.stderr).trim() || 'Could not remove it.' });
    }
    res.status(400).json({ error: 'Unknown action.' });
  }));
}
