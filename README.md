# V-Shape Tracker

A personal fitness tracker: food and macros, steps, water, gym sets with weight/rep
suggestions, weigh-ins, progress photos and weekly check-ins. It is a static web app
(no build step, no backend, all data stays on the device) that is also packaged as an
Android app so it can read steps from Health Connect.

## What is in here

| Path | Purpose |
| --- | --- |
| `index.html`, `app.js`, `style.css` | The whole app. Vanilla JS, no framework. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: installable, works offline. |
| `package.json`, `capacitor.config.json` | Capacitor wrapper config (Capacitor 5). |
| `scripts/copy-web.js` | Copies the web files into `www/` for Capacitor. |
| `android/` | Generated Android project (Health Connect permissions added). |
| `ANDROID.md` | Short guide to building and installing the Android app. |

## Run in the browser

```
npm run serve        # or: python -m http.server 8080
```

Open http://localhost:8080. Data is stored in the browser (localStorage, photos in
IndexedDB). Use Settings > Export backup now and then.

## Features

- **Today:** greeting and streak, 7-day goal strip, calorie/protein/steps rings,
  carbs and fat, steps entry or sync, activity tiles, water tracker, today's workout, weigh-in.
- **Food:** meal templates, food library, custom foods, copy yesterday.
- **Train:** 5-day program with load and rep suggestions from your history, rest timer,
  PR badge when you beat your previous best set.
- **Progress:** weekly check-in with calorie adjustment advice, weight and strength charts,
  14-day steps and calories, progress photos.
- Scrollbars are hidden throughout.

## Steps from Android (Health Connect)

A web page cannot read Samsung Health or Google Fit. The Android build can, through
Health Connect (Samsung Health and most watches write into it). Code is in `app.js`
(search `hcSync`), using the `capacitor-health-connect` plugin.

- Reads steps, weight, active calories, resting heart rate. Read-only.
- Several sources for the same day are not summed; the largest single source is used.
- Syncs on launch, when the app is reopened, and from the Today tab button (last 30 days).
- Outside the Android app the sync button is hidden and manual entry / Samsung Health CSV
  import still work.

## Build the Android app

Needs JDK 17 and the Android SDK (Android Studio provides both).

```
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug        # Windows: .\gradlew.bat assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with
`adb install -r <apk>` or copy it to the phone. Grant the Health Connect permissions on
first sync. Gradle needs `JAVA_HOME` to point at a JDK 17 (JDK 25 is too new for this
Gradle version) and `android/local.properties` with `sdk.dir=...` (not committed).

## Notes

- Debug build only; not set up for Play Store release signing.
- Targets Android 8+ (minSdk 26, compileSdk/targetSdk 34), which the Health Connect plugin requires.
- The Health Connect code has not been exercised on a real device yet.
