# Debloater

One Windows program that switches off or removes the preinstalled apps you do not want on a Google TV / Android TV, puts them back when you change your mind, and installs the Lite Launcher as a lighter home screen. It talks to the TV over adb.

## Use it

1. Download `debloater.exe` from the [latest release](../../releases/latest).
2. On the TV, switch on **Developer options → USB debugging** (and network debugging if you connect by IP).
3. Double-click `debloater.exe`. A console window opens and the page opens in your browser. Close the console window to stop it.
4. If adb is not on the PC, the page offers to download Google's SDK Platform-Tools (about 7 MB) into `%LOCALAPPDATA%\Debloater`. You can also point it at a copy you already have, or put a `platform-tools` folder next to the exe.
5. Plug the TV in by USB or type its IP address and press **Connect**. The first time, the TV asks you to allow this PC.

Windows SmartScreen may warn about the exe because it is not code-signed. Choose **More info → Run anyway**.

## What the labels mean

| Label | Meaning |
|---|---|
| Recommended | Leftovers a TV does not use (printing, feedback senders, phone features). |
| If unused | Real apps and extras, such as streaming apps or the screen reader. |
| Careful | Switching it off removes a feature (voice search, casting, Play Store) or needs a replacement first (home screen, keyboard). |
| Unknown | A system part that is not in the built-in list, usually from the TV maker. Look it up first. |
| Needed | The TV cannot run without it. These are locked. |

**Switch off** runs `pm disable-user`, **Remove** runs `pm uninstall -k --user 0` and **Put back** runs `cmd package install-existing` and `pm enable`. System apps stay on the system partition, so a factory reset also brings everything back.

The program refuses any change that would leave the TV without a home screen, so the stock home screen can only be switched off once another launcher is installed. On Google TV the setup wizard (`com.google.android.tungsten.setupwraith`) also acts as "home recovery" and keeps switching the stock home screen back on, so the two are switched off and put back together.

The built-in list of known packages is in [server/debloat.js](server/debloat.js). Add your TV maker's packages there.

## Lite Launcher

A small home screen: a large clock and date, the network status, a dock of up to five favourites, and an All apps view with the TV inputs and apps as large tiles (sorted A–Z or by most used, with hide, reorder and uninstall). It loads no recommendations or adverts.

Its source is in [launcher/](launcher/) and the built APK is [vendor/lite-launcher.apk](vendor/lite-launcher.apk), which is embedded in the exe. The package name is `com.adbdeck.lite` and it is signed with `launcher/launcher.keystore` (password `android`), so it updates in place on TVs that got it from ADB Deck. To rebuild it you need a JDK and the Android SDK (build-tools and a platform), then run `npm run build:launcher`.

## Build it

Needs Node.js 22 or newer.

```bat
npm install
npm run build
```

This writes `dist\debloater.exe` (about 90 MB, most of it Node.js itself). It uses Node's [single executable applications](https://nodejs.org/api/single-executable-applications.html):

1. Vite builds the React UI in `web/` into `web/dist`.
2. esbuild bundles the server in `server/` into one file.
3. Node packs the server, the UI files and the launcher APK into a blob.
4. postject injects the blob into a copy of `node.exe`.

The exe runs on the same OS and CPU as the Node.js that built it. GitHub Actions builds it on every push and publishes it as the `latest` release from `main`.

For UI work, run `npm start` (the server, from source, on port 8710) and `npm run dev:web` together and open <http://localhost:5173>.

Settings: `PORT` (default 8710), `ADB_PATH` (overrides the adb path), `NO_BROWSER=1` (do not open the browser). Settings and the downloaded adb live in `%LOCALAPPDATA%\Debloater`.

## Security

The server only listens on `127.0.0.1` and only answers requests addressed to `localhost`, so other computers and other websites cannot reach it. Anyone using this PC can control every TV connected to its adb.
