# Getting steps from your Android phone

A web page cannot read Samsung Health or Google Fit. The Android app build can: it reads
**Health Connect** (Samsung Health, Google Fit and most watches write into it).

Reads: steps, weight, active calories, resting heart rate. Nothing is written back.

## One-time setup (on a PC)
1. Install **Android Studio** (it brings JDK 17 and the Android SDK).
2. In Samsung Health: Settings > Connected services > Health Connect, allow Steps (and the others you want).
   Health Connect is built into Android 14+; on older phones install it from the Play Store.
3. In this folder run:
   ```
   npm install
   npm run android
   ```
   That copies the web app, syncs the Android project and opens it in Android Studio.
4. Plug in your phone (USB debugging on) and press Run. The app is installed as "V-Shape".

## Using it
Open the app. It syncs on launch and when you come back to it. The "Sync from Health Connect"
button on the Today tab syncs the last 30 days. Accept the permission prompt the first time.

Steps from several sources (phone and watch) are not added together; the biggest single source
for each day is used so nothing is double counted.

## After editing the web files
Run `npm run android` again (or `npm run build && npx cap sync android`) and re-run from Android Studio.
