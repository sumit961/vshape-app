# V-Shape Tracker

A personal fitness tracker: food and macros, steps, water, gym sets with weight/rep
suggestions, weigh-ins, progress photos and weekly check-ins. It is a static web app
(no build step, no backend, all data stays on the device) that is also packaged as an
Android app so it can read steps from Health Connect and show a live workout
notification while you train.

## What is in here

| Path | Purpose |
| --- | --- |
| `core.js` | Pure logic (no DOM): validation, migration, sessions, progression, backup parsing, Health Connect transforms. Loaded in the browser and required directly from the tests. |
| `index.html`, `app.js`, `style.css` | The whole app UI. Vanilla JS, no framework. `app.js` calls into `core.js`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: installable, works offline. |
| `package.json`, `capacitor.config.json` | Capacitor wrapper config (Capacitor 5). |
| `scripts/copy-web.js` | Copies the web files into `www/` for Capacitor. |
| `android/` | Generated Android project: Health Connect permissions, plus the workout-notification plugin/service/receiver under `android/app/src/main/java/app/vshape/tracker/`. |
| `tests/` | `node --test` unit tests for `core.js` and startup smoke tests for `app.js` (see below). |
| `ANDROID.md` | Guide to building and installing the Android app, and the real-device test checklist. |

## Data model (schema 2)

Everything still lives under the single `localStorage` key `vshape-tracker-v1`, now
tagged `schema: 2`. Each day is `{date, food, steps, stepsSource, water, sessions, quarantine}`.
A **session** (not the calendar day) is the unit of a workout: `{id, day, status
('active'|'paused'|'finished'), startedAt, finishedAt, pausedMs, log, rest}`. A date can
hold more than one session, so doing two program days (or re-logging the same exercise,
which several program days share) on the same date no longer overwrites either one.

On first load of old (pre-session) data, each day's existing log becomes one `finished`
session with no invented start time, the previous raw blob is kept under a
`vshape-tracker-v1-pre-migration-backup-<timestamp>` key (and, best-effort, in IndexedDB)
before anything is overwritten, and data tagged with a newer schema than this build knows
is left completely untouched and the app shows a "locked" screen instead of guessing.

## Run in the browser

```
npm run serve        # or: python -m http.server 8080
```

Open http://localhost:8080. Data is stored in the browser (localStorage, photos in
IndexedDB). Use Settings > Export backup now and then.

## Tests

```
npm run check      # node --check on core.js and app.js
npm run test       # node --test tests/   (unit tests for core.js + app.js smoke tests)
npm run validate   # check + test + build
```

No extra dependencies are installed for this — it uses Node's built-in test runner
(`node:test`) and a small hand-written fake DOM/IndexedDB (`tests/env.js`) instead of
jsdom, so the real `app.js` can boot under Node without a browser. That fake DOM is
intentionally minimal: it proves the app boots, migrates old data, and doesn't crash,
but it does not click through the UI. If you want full click-through coverage, run a
real browser test tool (e.g. Playwright) against `npm run serve`.

## Features

- **Today:** greeting and streak, 7-day goal strip, calorie/protein/steps rings,
  carbs and fat, steps entry or sync, activity tiles, water tracker, today's workout, weigh-in.
- **Food:** meal templates, food library, custom foods, copy yesterday.
- **Train:** 5-day program with load and rep suggestions from your history, explicit
  Start/Pause/Resume/Finish workout controls, a durable deadline-based rest timer,
  PR badge when you beat your previous best set.
- **Progress:** weekly check-in with calorie adjustment advice, weight and strength charts,
  14-day steps and calories, progress photos, an optional editable baseline measurement.
- In the Android app, an active workout shows a persistent notification (elapsed time,
  current exercise, sets done, rest countdown, Pause/Resume and Skip Rest) — see
  "Workout notification" in `ANDROID.md`.
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
