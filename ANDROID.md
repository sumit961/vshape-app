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

## Using Health Connect
Open the app. It syncs on launch and when you come back to it. The "Sync from Health Connect"
button on the Today tab syncs the last 30 days. Accept the permission prompt the first time.
A silent (launch/background) sync never opens the permission screen on its own — if the plugin
can't confirm permission without prompting, it just skips that sync rather than guessing.

Steps from several sources (phone and watch) are not added together; the biggest single source
for each day is used so nothing is double counted. A step count you typed in or imported from a
file is never silently overwritten by a phone sync; if the phone has a different number for that
day, a "Use phone value" button appears instead.

**Not verified on a real device yet:** whether the installed `capacitor-health-connect` plugin's
permission-check method names match what `app.js` calls (`hcSync` falls back to skipping a silent
sync if it can't find one, rather than guessing or prompting). Confirm this once you can run the
app on a phone.

## Workout notification (Phase 2A)

While a workout session is active or paused, the Android app shows a persistent "ongoing"
notification: workout name, elapsed time, current exercise, sets done vs. planned, a rest
countdown when resting, and Pause/Resume plus Skip Rest action buttons. Tapping the notification
body opens the app. It is a plain `NotificationCompat` notification with a `specialUse` foreground
service (`android/app/src/main/java/app/vshape/tracker/WorkoutForegroundService.java`) — not
`MediaSession` or a `mediaPlayback` foreground service, since this isn't audio/media playback.

**Foreground-service type, corrected in 2A.1:** the first pass of this feature used Android 14's
`"health"` foreground-service type. Checked against Android's own foreground-service-types docs,
that type requires the app to already hold one of `BODY_SENSORS`, `ACTIVITY_RECOGNITION`,
`READ_HEART_RATE`, `READ_SKIN_TEMPERATURE` or `READ_OXYGEN_SATURATION` — raw sensor/health runtime
permissions this app has no legitimate reason to request (it only reads Health Connect data, a
separate permission namespace). Adding one of those permissions purely to satisfy the type would
have been exactly the "add an unrelated permission to bypass a restriction" anti-pattern this
phase was meant to avoid. On a real Android 14+ device the old code would most likely have thrown
when starting the service. It now uses the `"specialUse"` catch-all type instead (with the
required `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` manifest property), which fits a user-visible,
user-initiated status notification with no special data access. One real-world catch: Google Play
Console reviews the declared `specialUse` subtype and its justification before the app can be
published with it — that only matters if/when this is submitted to Play, not for a local debug
build or sideloaded APK.

**Permissions:** `POST_NOTIFICATIONS` (Android 13+ runtime permission — if denied, the workout
still tracks fine inside the app; you can enable it later from Settings), `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_SPECIAL_USE`. No location, microphone, camera, exact-alarm, battery-exemption,
or body-sensor permission is requested.

**Startup failures are now handled, not just hoped against.** Both the plugin's call to
`startForegroundService()` and the service's own call to `startForeground()` are wrapped in
try/catch. A failure (denied notification permission, a background-start restriction, anything
else) is logged, the half-started service is stopped, and the failure is recorded durably
(`ActionQueue.recordError`) so the next time the app polls the native side it surfaces a one-time
toast — it is never a silent exception, and it never crashes the app or leaves the workout
untracked.

**How actions survive the app being killed:** a tap on Pause/Resume/Skip Rest is handled by
`WorkoutActionReceiver`, a manifest-registered `BroadcastReceiver` that runs even if the app
process is dead. It never computes workout state itself — it only appends `{seq, type,
sessionId, ts}` to a durable queue in `SharedPreferences` (`ActionQueue.java`). The app drains
and applies that queue through `core.js`'s `reconcileActions()` (seq-ordered, idempotent, skips
stale/duplicate/wrong-session actions) the next time it's foregrounded or resumed — there is
exactly one place that decides what "pause" means. If you kill the app mid-rest and reopen it
later, the pending action is still applied correctly, and it is only ever applied once (each
action carries a monotonically increasing sequence number; `reconcileActions()` rejects anything
at or below the last one it already applied).

**Immediate feedback on a tap, fixed in 2A.1:** previously, tapping Pause/Resume/Skip Rest only
queued the action — the notification itself didn't change until the app next woke up and
reconciled, which could look stuck for a while if the app was backgrounded. The receiver now also
redraws the notification from its last known state the instant a button is tapped, showing
"Updating…" rather than changing the real status — it never claims the action succeeded before
`core.js` has actually applied it; that's just an honest "we heard you" marker. The queue itself
is only ever cleared for actions that were actually processed (applied *or* intentionally
rejected, e.g. stale/duplicate/wrong-session) — a previous version could leave a genuinely
unrecognized action stuck in the queue forever, periodically retried but never cleared; it is now
always acknowledged once handled, in either direction.

**Elapsed time and rest countdown** are driven by the notification's own native `Chronometer`
(`setUsesChronometer` / `setChronometerCountDown` against a fixed deadline), so Android ticks them
down itself — the notification is only rebuilt on a real state change (new set, pause, resume,
rest starting/ending), never once a second from JS. Fixed in 2A.1: pausing/resuming/skipping rest
from the in-app timer widget (as opposed to the full-screen re-render that most other actions
trigger) used to update only the in-app widget and leave the notification showing a stale
countdown, including a stuck "0:00" once rest actually ended; all three paths now explicitly
refresh the notification too.

**Same-day repeated workouts, fixed in 2A.1:** starting a second, separate workout of a program
day you had already *finished* earlier the same day used to silently reopen and resume logging
into that finished session instead of creating a new one (`startOrGetSession` matched on "the
last session for this date and program day," regardless of its status). It now only ever reuses a
session that is still `active`/`paused`; a finished session is never reused or written to again,
and starting again after finishing always creates a genuinely new session. One session that's
still open elsewhere (a different program day, or an earlier unfinished one) still blocks starting
a second concurrent one, as before.

**Known platform trade-offs (not verified on a device):**
- A stock `NotificationCompat` notification only has one built-in chronometer, so while a rest
  countdown is running it temporarily replaces the workout's elapsed-time display; the elapsed
  time resumes once rest ends or is skipped. Showing both at once would need a custom
  `RemoteViews` layout, which the spec for this phase explicitly said not to combine with the
  rest of this design.
- "Android Live Updates" / ProgressStyle and any Android-17-specific "MetricStyle" enhancement
  were not attempted: Android 17 does not exist as a released version as of this writing, and the
  baseline `NotificationCompat` approach above was the one asked to be treated as the safe
  fallback. Revisit this once a concrete, shipped API is confirmed.
- The notification icon (`res/drawable/ic_notification.xml`) is a placeholder badge shape, not a
  pixel-matched export of the real V-Shape mark.
- Samsung's notification shade sometimes collapses/orders actions differently from Pixel's; this
  has not been checked on a Samsung device.
- Fixed in the 2A.1 verification pass: `hide()` now also clears the service's cached "last known
  state," and the service no longer returns `START_STICKY` anywhere, so (a) a notification tap
  that was already in flight when the workout finished can no longer resurrect a ghost
  notification via the pending-feedback path, and (b) the OS restarting the service after an
  unrelated memory-pressure kill can't show a stale/empty notification with no real data behind
  it. Not confirmed on a real device.
- The Play Console review requirement for the `specialUse` foreground-service subtype (see above)
  has not been exercised — this app is a debug/sideloaded build only, so it hasn't gone through
  that review.

## Real-device checklist

Nothing below has been run on an actual phone from this change — only read through carefully and
reasoned about. Go through this on a Samsung Android phone (and ideally a Pixel too) before
trusting it:

- [ ] Fresh install, grant notification permission when asked, start a workout, lock the phone.
- [ ] Open the notification shade: title, elapsed time (ticking), current exercise, sets done,
      Pause/Resume button all show correctly.
- [ ] Log a set that starts a rest timer: the notification switches to a ticking rest countdown
      and a "Skip rest" button appears.
- [ ] Tap Pause/Resume on the notification while the app is backgrounded: it should show
      "Updating…" immediately, then settle to the correct Paused/Active state within a second or
      two of reopening the app (not stay stuck on the tapped label indefinitely).
- [ ] Tap Skip rest on the notification; confirm the countdown doesn't linger at 0:00 afterwards.
- [ ] Pause/resume/skip rest from the in-app rest-timer widget (not the notification) and confirm
      the notification updates too, not just the in-app widget.
- [ ] Tap the notification body — it opens V-Shape to the right workout.
- [ ] Finish a workout, then start another workout of the *same* program day later the same day —
      confirm it starts a genuinely new, empty session rather than reopening the finished one, and
      that the finished workout's sets are still visible in Progress/history afterwards.
- [ ] Switch to another app (e.g. YouTube Music) and back — the V-Shape notification is still
      correct and YouTube Music's own notification is unaffected.
- [ ] Leave V-Shape in the background for several minutes, then bring it back — elapsed time and
      rest countdown are still accurate (they're deadline-based, not a JS counter that drifts).
- [ ] Kill the app process (not just background it) with an active workout, then reopen it — the
      workout is restored, no sets are lost, and the notification comes back.
- [ ] Deny the notification permission on a fresh install — the workout still logs sets and the
      rest timer still works inside the app; no crash, no repeated permission nagging.
- [ ] Finish a workout (with the confirmation prompt) and confirm the notification clears and the
      foreground service stops.
- [ ] Check that elapsed time and the final set history for that workout look right afterwards.
- [ ] The Health Connect permission screen and sync accuracy against Samsung Health.
- [ ] Phone-plus-watch step totals (make sure they aren't double-counted).
- [ ] The Android 14 Health Connect permission-usage entry (`ViewPermissionUsageActivity`).
- [ ] Backup export: Android WebView doesn't support blob downloads directly, so this uses the
      share sheet / download manager fallback already in the app — confirm it still produces a
      usable file on your device.
- [ ] The minus key on the on-screen keyboard for assisted pull-up weight entry.

## After editing the web files
Run `npm run android` again (or `npm run build && npx cap sync android`) and re-run from Android Studio.
